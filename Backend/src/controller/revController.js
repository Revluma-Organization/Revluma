const { requireMembership } = require('../utils/organizationContext');
/**
 * Revluma Rev Intelligence Controller
 *
 * Handles all Rev Intelligence conversation endpoints.
 * Python owns intelligence. Node owns application security,
 * request lifecycle, persistence and API behaviour.
 *
 * Security:
 *   - organization_id always from authenticated JWT/DB, never from request body
 *   - Every conversation verified to belong to authenticated org before access
 *   - Tenant isolation enforced at every endpoint
 *   - Input sanitised before reaching Python
 *
 * Persistence:
 *   - User message persisted BEFORE calling Python
 *   - Rev response persisted AFTER successful Python response
 *   - Failed Python requests update message with error state, never lost
 */

const { v4: uuidv4 }   = require('uuid');
const { prisma }        = require('../configs/database');
const mlService         = require('../services/mlService');
const logger            = require('../utils/logger');
const { formatSseFrame } = require('../services/revStream');
const { safePersistedNarrative } = require('../services/revClaimGuardrails');
const { retryabilityForError, investigationOutcomeFromTransportError } = require('../services/revInvestigationOutcomes');
const { withTimeout, TIMEOUT_POLICY_MS, safeId } = require('../services/revFailureContract');
const { validateSubmission, acceptSubmission, replayBody } = require('../services/revSubmission');
const revMetrics = require('../services/revOperationalMetrics');

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getAuthenticatedOrg(userId, organizationId) {
  const member = await requireMembership(prisma, userId, organizationId);
  const org = await prisma.organizations.findUnique({
    where: { id: member.organization_id },
    select: { id: true, company_name: true },
  });
  if (!org) {
    const err = new Error('Organisation not found. Complete onboarding first.');
    err.statusCode = 400;
    throw err;
  }
  return org;
}

async function verifyConversationOwnership(conversationId, organizationId) {
  const rows = await prisma.$queryRaw`
    SELECT id, organization_id, user_id, title, status, message_count, last_activity_at
    FROM conversations
    WHERE id = ${conversationId}::uuid
    LIMIT 1
  `;
  const row = rows[0] || null;
  if (!row) {
    const err = new Error('Conversation not found.');
    err.statusCode = 404;
    throw err;
  }
  if (String(row.organization_id) !== String(organizationId)) {
    logger.warn('rev_cross_tenant_attempt', {
      requestorOrgId:    organizationId,
      conversationOrgId: row.organization_id,
      conversationId,
    });
    const err = new Error('Not authorised to access this conversation.');
    err.statusCode = 403;
    throw err;
  }
  return row;
}

function sanitiseMessage(text) {
  if (typeof text !== 'string') return null;
  return text.replace(/\0/g, '').trim().slice(0, 2000);
}


// Generate a short meaningful title from user message
function _generateTitle(message) {
  const msg = message.trim();
  // Strip common conversational openers
  const stripped = msg
    .replace(/^(hi|hello|hey|good morning|morning|thanks|thank you|ok|okay|can you|could you|i want to|i need|please|can we)\s+/i, '')
    .trim();
  const title = stripped.length > 5 ? stripped : msg;
  // Capitalise first letter, truncate at word boundary
  const words = title.split(' ');
  let out = '';
  for (const w of words) {
    if ((out + ' ' + w).length > 55) break;
    out = out ? out + ' ' + w : w;
  }
  return out.charAt(0).toUpperCase() + out.slice(1);
}

// ── Authenticated Rev evidence retrieval ─────────────────────────────────────
// Tenant identity is resolved exclusively from the verified JWT and membership.
// Query parameters can narrow that scope, never expand it.
exports.getEvidence = async (req, res, next) => {
  try {
    const org = await getAuthenticatedOrg(req.user.id, req.user.tenantId);
    const storeId = req.query?.store_id || null;
    const resourceId = req.query?.resource_id || null;
    const evidenceId = req.params?.id || null;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (storeId && !uuid.test(String(storeId))) return res.status(400).json({ success: false, error: { code: 'INVALID_STORE_REFERENCE' } });
    if (resourceId && !/^[a-z0-9][a-z0-9._-]{0,119}$/i.test(String(resourceId))) return res.status(400).json({ success: false, error: { code: 'INVALID_RESOURCE_REFERENCE' } });
    if (evidenceId && !/^ev-[a-f0-9]{24}$/.test(evidenceId)) return res.status(400).json({ success: false, error: { code: 'INVALID_EVIDENCE_REFERENCE' } });
    const service = require('../services/revEvidenceService');
    // Task 198 — optional reporting period for the computed revenue resource:
    // ?start=&end=&timezone= (half-open [start, end), IANA timezone).
    let period = null;
    const hasPeriodParam = ['start', 'end', 'timezone'].some(key => req.query?.[key] != null && req.query?.[key] !== '');
    if (hasPeriodParam) {
      if (resourceId !== service.REVENUE_RESOURCE_ID) {
        return res.status(400).json({ success: false, error: { code: 'PERIOD_UNSUPPORTED', message: 'Reporting period parameters are only supported for the computed revenue resource.' } });
      }
      try {
        service.resolveRevenuePeriod({ start: req.query?.start ?? null, end: req.query?.end ?? null, timezone: req.query?.timezone ?? null }, { last_synced_at: null }, new Date());
      } catch (error) {
        return res.status(400).json({ success: false, error: { code: error.code || 'EVIDENCE_PERIOD_INVALID', message: error.message } });
      }
      period = { start: String(req.query.start), end: String(req.query.end), timezone: String(req.query.timezone || 'UTC') };
    }
    const abort = new AbortController();
    const cancel = () => abort.abort();
    req.once('aborted', cancel);
    res.once('close', cancel);
    if (evidenceId) {
      try {
        const item = await service.retrieveEvidenceById({ organizationId: org.id, storeId, evidenceId, signal: abort.signal });
        return res.status(200).json({ success: true, read_only: true, evidence: item });
      } catch (lookupError) {
        // Task 201 — integration evidence items live in the canonical
        // integration collection; fall back to it before reporting 404.
        if (lookupError.code !== 'EVIDENCE_NOT_FOUND') throw lookupError;
        const item = await require('../services/revIntegrationEvidenceService')
          .retrieveIntegrationEvidenceById({ organizationId: org.id, storeId, evidenceId, signal: abort.signal });
        return res.status(200).json({ success: true, read_only: true, evidence: item });
      }
    }
    if (resourceId === require('../services/revIntegrationEvidenceService').INTEGRATION_RESOURCE_ID) {
      const integrationService = require('../services/revIntegrationEvidenceService');
      const result = await integrationService.retrieveIntegrationEvidence({ organizationId: org.id, storeId, signal: abort.signal });
      return res.status(200).json({ success: true, read_only: true, ...result });
    }
    const result = await service.retrieveEvidence({ organizationId: org.id, storeId, resourceId, limit: req.query?.limit, period, signal: abort.signal });
    return res.status(200).json({ success: true, read_only: true, ...result });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, error: { code: error.code || 'EVIDENCE_RETRIEVAL_FAILED', message: error.message } });
    return next(error);
  }
};

// ── GET /api/v1/rev/command-center ───────────────────────────────────────────
// Task 216: one authenticated, read-only operational briefing. Organization
// identity is resolved from the verified session; no tenant or metric input is
// accepted from the browser. The response is never shared or cached across
// merchants.
exports.getCommandCenter = async (req, res, next) => {
  try {
    const org = await getAuthenticatedOrg(req.user.id, req.user.tenantId);
    const { getCommandCenter } = require('../services/commandCenterService');
    const data = await getCommandCenter({ prisma, organizationId: org.id });
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json({ success: true, data });
  } catch (error) { return next(error); }
};

// ── POST /api/v1/rev/chat ─────────────────────────────────────────────────────

exports.chat = async (req, res, next) => {
  let correlationId = uuidv4();
  let executionId = uuidv4();
  let requestMetricRecorded = false;
  let persistenceStage = null;
  let activeConvId = null;
  let acceptedOrg = null;
  let reuseUserMessage = false;
  let revSequence = null;
  const startTime     = Date.now();

  try {
    // 1. Validate before persistence. Oversize questions are rejected, never
    // silently truncated, and request_id is the stable idempotency key.
    let validated;
    try { validated = validateSubmission(req.body); }
    catch (error) {
      return res.status(error.statusCode || 400).json({
        success: false,
        error: { code: error.code || 'VALIDATION_ERROR', message: error.message || 'Message is invalid.' },
      });
    }
    const message = validated.message;
    correlationId = validated.requestId;
    executionId = uuidv4();
    const conversationId  = req.body?.conversation_id || null;
    const imageBase64     = req.body?.image_base64     || null;
    const imageMediaType  = req.body?.image_media_type || null;
    reuseUserMessage = req.body?.reuse_user_message === true;

    // Validate image if provided
    const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const MAX_IMAGE_B64_CHARS = 7_000_000; // ~5MB decoded
    if (imageBase64) {
      if (!ALLOWED_IMAGE_TYPES.includes(imageMediaType)) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Unsupported image type.' },
        });
      }
      if (imageBase64.length > MAX_IMAGE_B64_CHARS) {
        return res.status(413).json({
          success: false,
          error: { code: 'PAYLOAD_TOO_LARGE', message: 'Image must be under 5MB.' },
        });
      }
    }

    // 2. Resolve org from JWT — never from body
    const org = await getAuthenticatedOrg(req.user.id, req.user.tenantId);
    acceptedOrg = org;

    // Finding context is always resolved server-side under the authenticated organization.
    let intelligenceMessage = message;
    let selectedFinding = null;
    if (req.body?.finding_id != null) {
      const { resolveFindingChatContext } = require('../services/findingChatContext');
      const findingContext = await resolveFindingChatContext(prisma, org.id, req.body.finding_id, message);
      if (findingContext.status === 'invalid') {
        return res.status(400).json({ success: false, error: { code: 'INVALID_FINDING_ID' } });
      }
      if (findingContext.status === 'not_found') {
        return res.status(404).json({ success: false, error: { code: 'FINDING_NOT_FOUND' } });
      }
      if (findingContext.status !== 'ok') return res.status(409).json({
        success: false, error: { code: 'FINDING_CONTEXT_UNAVAILABLE' },
      });
      selectedFinding = findingContext.selected_finding;
    }

    logger.info('rev_chat_request', {
      correlationId, executionId,
      orgId:          org.id,
      userId:         req.user.id,
      conversationId: conversationId || 'new',
      messageLength:  message.length,
    });

    // 3–5. Persist acceptance before model work. Replaying the same request
    // returns the owned persisted turn (or its in-progress state) without a
    // second user row or investigation.
    activeConvId = conversationId;
    if (!reuseUserMessage) {
      const acceptance = await acceptSubmission({
        prisma, organizationId: org.id, userId: req.user.id,
        message, requestId: correlationId, requestedConversationId: conversationId,
      });
      activeConvId = acceptance.conversationId;
      if (acceptance.duplicate) {
        const replay = replayBody(acceptance.accepted, correlationId);
        if (!replay.completed) return res.status(409).json({
          success: false, conversation_id: replay.conversationId, idempotent_replay: true,
          error: { code: 'REV_TURN_IN_PROGRESS', message: 'This question was already accepted and is still being processed.' },
        });
        if (replay.failed) return res.status(503).json({
          success: false, conversation_id: replay.conversationId, idempotent_replay: true,
          error: { code: replay.errorCode || 'INTELLIGENCE_UNAVAILABLE', message: replay.errorMessage || 'Rev could not complete this response.' },
        });
        return res.status(200).json({
          ...replay.content, success: true, conversation_id: replay.conversationId,
          message_id: replay.messageId, response: replay.content, idempotent_replay: true,
        });
      }
    } else {
      await verifyConversationOwnership(conversationId, org.id);
    }

    const seqResult = await prisma.$queryRaw`
      SELECT COALESCE(MAX(sequence_number), 0)::int as max_seq
      FROM conversation_messages
      WHERE conversation_id = ${activeConvId}::uuid
    `;
    revSequence = (Number(seqResult[0]?.max_seq) || 0) + 1;

    const merchantContext = await require('../services/revMerchantContext').buildMerchantContext(prisma, org.id);
    let conversationContext;
    try {
      conversationContext = await _loadConversationContext(activeConvId, org.id, { correlationId, executionId });
    } catch (restorationError) {
      revMetrics.record('rev_conversation_restoration_failures_total', 1, { stage: 'context_load' });
      logger.warn('rev_conversation_restoration_failed', { correlationId, executionId, errorType: restorationError.name });
      throw restorationError;
    }

    // 6. Call Python via mlService
    // Task 207: JSON and SSE use the same canonical investigation runtime.
    // The legacy /orchestrate conversational path cannot carry investigation
    // outcomes, integration diagnostics or coverage eligibility.
    const invokeInvestigation = imageBase64 ? mlService.orchestrate : mlService.investigate;
    const mlResult = await invokeInvestigation({
      organizationId: org.id,
      userId:         req.user.id,
      message: intelligenceMessage,
      contextPayload: {
        merchant_context: merchantContext,
        conversation_context: conversationContext,
        selected_finding: selectedFinding,
        _node_owns_chat_persistence: true,
      },
      conversationId: activeConvId,
      correlationId,
      executionId,
      ...(imageBase64 ? { imageBase64, imageMediaType } : {}),
    });

    // 7. Handle Python failure — persist failed Rev message so history is intact
    if (!mlResult.success) {
      revMetrics.record('rev_requests_total', 1, { outcome: 'failure' });
      revMetrics.observe('rev_request', Date.now() - startTime);
      requestMetricRecorded = true;
      if (mlResult.error?.failure?.category) {
        revMetrics.record('rev_provider_failures_total', 1, { category: mlResult.error.failure.category });
      }
      if (mlResult.error?.code === 'INVALID_RESPONSE') revMetrics.record('rev_validation_failures_total', 1, { stage: 'response_contract' });
      const failedMsgId = uuidv4();
      const failedContent = JSON.stringify({ error: true, correlation_id: correlationId, execution_id: executionId });
      persistenceStage = 'failed_turn_write';
      await prisma.$executeRaw`
        INSERT INTO conversation_messages (
          id, conversation_id, organization_id, user_id,
          role, content, sequence_number, correlation_id,
          has_error, error_code, error_message
        ) VALUES (
          ${failedMsgId}::uuid, ${activeConvId}::uuid, ${org.id}::uuid, ${req.user.id}::uuid,
          'rev', ${failedContent}::jsonb, ${revSequence}, ${correlationId}::uuid,
          true, ${mlResult.error.code}, ${mlResult.error.message}
        )
      `;
      persistenceStage = 'conversation_update';
      await prisma.$executeRaw`
        UPDATE conversations
        SET last_activity_at = NOW(), message_count = message_count + ${reuseUserMessage ? 0 : 1}, updated_at = NOW()
        WHERE id = ${activeConvId}::uuid
      `;
      persistenceStage = null;

      logger.warn('rev_chat_intelligence_failed', {
        correlationId, orgId: org.id,
        errorCode: mlResult.error.code,
        latencyMs: Date.now() - startTime,
      });

      return res.status(503).json({
        success: false,
        conversation_id: activeConvId,
        error: mlResult.error,
        retryable: typeof mlResult.error.retryable === 'boolean'
          ? mlResult.error.retryable : retryabilityForError(mlResult.error.code),
        investigation_outcome: investigationOutcomeFromTransportError({
          code: mlResult.error.code, organizationId: org.id,
        }),
      });
    }

    logger.info('rev_chat_python_succeeded', { correlationId, orgId: org.id, conversationId: activeConvId, latencyMs: Date.now() - startTime });
    // Flatten the structured response contract for backwards-compatible
    // consumers while preserving the evidence-bearing fields.
    const revData = { ...mlResult.data, ...(mlResult.data?.response || {}) };
    const responseType = revData.response_type || 'analysis';

    // 8. Persist Rev response — structure depends on response type
    const revMsgId = uuidv4();
    let revContent;

    if (responseType !== 'analysis') {
      // Conversational, capability, clarification, error — just text
      revContent = {
        response_type: responseType,
        text: revData.text || '',
        response_mode: revData.response_mode || null,
        mode_reason: revData.mode_reason || null,
        investigation_outcome: revData.investigation_outcome || null,
      };
    } else {
      // Full 6-part analysis
      revContent = {
        response_type: 'analysis',
        situation:      revData.situation,
        insight:        revData.insight,
        implication:    revData.implication,
        recommendation: revData.recommendation,
        confidence: revData.response?.confidence || null,
        sections: revData.response?.sections || [],
        response_profile: revData.response_profile || null,
        actions:     revData.actions     || [],
        agents_used: revData.agents_used || [],
        warnings:    revData.warnings    || [],
        evidence:       mlResult.data?.evidence      || null,
        facts:          mlResult.data?.facts         || [],
        comparison_facts: mlResult.data?.comparison_facts || [],
        hypotheses:     mlResult.data?.hypotheses    || [],
        unknowns:       mlResult.data?.unknowns       || [],
        recommendations: mlResult.data?.recommendations || [],
        investigation:  mlResult.data?.investigation || null,
        investigation_outcome: mlResult.data?.investigation_outcome || null,
        specialists:    mlResult.data?.specialists    || [],
        read_only:      mlResult.data?.read_only     ?? true,
        response_mode:  mlResult.data?.response_mode || null,
        mode_reason:    mlResult.data?.mode_reason   || null,
        understanding:  mlResult.data?.understanding || null,
        question_understanding: mlResult.data?.question_understanding || null,
        orchestration: mlResult.data?.orchestration || null,
        selected_finding: mlResult.data?.selected_finding || null,
        claims: mlResult.data?.claims || [],
        consistency: mlResult.data?.consistency || null,
        reliability: mlResult.data?.reliability || null,
      };
    }

    revContent = {
      ...revContent,
      correlation_id: correlationId,
      execution_id: mlResult.data?.execution_id || executionId,
      execution_metadata: mlResult.data?.execution_metadata || null,
      execution_trace: _sanitizeExecutionTrace(mlResult.data?.execution_trace),
      agent_answer: _sanitizeAgentAnswer(mlResult.data?.agent_answer),
    };
    const revContentStr   = JSON.stringify(revContent);
    const agentNameStr    = (revData.agents_used || []).join(',');
    const confidenceScore = revData.confidence_score ?? null;
    const execution       = _executionPersistenceFields(revContent);

    persistenceStage = 'rev_turn_write';
    await prisma.$executeRaw`
      INSERT INTO conversation_messages (
        id, conversation_id, organization_id, user_id,
        role, content, sequence_number,
        agent_name, model_name, model_provider,
        correlation_id, confidence_score, has_error,
        input_tokens, output_tokens, metadata
      ) VALUES (
        ${revMsgId}::uuid, ${activeConvId}::uuid, ${org.id}::uuid, ${req.user.id}::uuid,
        'rev', ${revContentStr}::jsonb, ${revSequence},
        ${agentNameStr}, ${execution.modelName}, ${execution.modelProvider},
        ${correlationId}::uuid, ${confidenceScore}, false,
        ${execution.inputTokens}, ${execution.outputTokens}, ${execution.metadata}::jsonb
      )
    `;

    persistenceStage = 'finding_context_write';
    await _persistFindingContext(activeConvId, org.id, mlResult.data);

    // Generate intelligent title from first meaningful user message
    const titleHint = _generateTitle(message);
    persistenceStage = 'conversation_update';
    await prisma.$executeRaw`
      UPDATE conversations
      SET
        last_activity_at = NOW(),
        message_count    = message_count + ${reuseUserMessage ? 1 : 2},
        title            = COALESCE(title, ${titleHint}),
        updated_at       = NOW()
      WHERE id = ${activeConvId}::uuid
    `;
    persistenceStage = null;

    const intentName = revData.intent || revData.investigation?.intent || 'unknown';
    const storeIntent = new Set([
      'store_overview', 'revenue_investigation', 'checkout_investigation',
      'customer_retention', 'refund_investigation', 'product_investigation',
      'finding_investigation', 'traffic_investigation', 'data_coverage',
    ]).has(intentName);
    revMetrics.record('rev_requests_total', 1, { outcome: 'success' });
    revMetrics.record(storeIntent ? 'rev_investigations_total' : 'rev_general_questions_total', 1, { outcome: 'success' });
    revMetrics.observe('rev_request', Date.now() - startTime);
    requestMetricRecorded = true;
    const latencyMs = Date.now() - startTime;
    logger.info('rev_chat_complete', {
      correlationId,
      orgId:           org.id,
      conversationId:  activeConvId,
      agentsUsed:      revData.agents_used,
      confidenceScore: revData.confidence_score,
      latencyMs,
    });

    // 9. Return structured response
    return res.status(200).json({
      success:         true,
      conversation_id: activeConvId,
      message_id:      revMsgId,
      response_type:   responseType,
      text:            revData.text || null,
      intent:          revData.intent || revData.investigation?.intent || null,
      response:        revContent,
      evidence:        mlResult.data?.evidence      || null,
      facts:           mlResult.data?.facts         || [],
      comparison_facts: mlResult.data?.comparison_facts || [],
      hypotheses:      mlResult.data?.hypotheses    || [],
      unknowns:        mlResult.data?.unknowns      || [],
      recommendations: mlResult.data?.recommendations || [],
      investigation:   mlResult.data?.investigation || null,
      investigation_outcome: mlResult.data?.investigation_outcome || null,
      specialists:     mlResult.data?.specialists    || [],
      question_understanding: mlResult.data?.question_understanding || null,
      orchestration: mlResult.data?.orchestration || null,
      selected_finding: mlResult.data?.selected_finding || null,
      claims: mlResult.data?.claims || [],
      consistency: mlResult.data?.consistency || null,
      reliability: mlResult.data?.reliability || null,
      read_only:       mlResult.data?.read_only ?? true,
      meta: {
        correlation_id:             correlationId,
        execution_id:               mlResult.data?.execution_id || executionId,
        execution_metadata:         mlResult.data?.execution_metadata || null,
        business_state_age_minutes: revData.business_state_age_minutes,
        agents_used:                revData.agents_used || [],
        latency_ms:                 latencyMs,
      },
    });

  } catch (error) {
    if (!requestMetricRecorded) {
      revMetrics.record('rev_requests_total', 1, { outcome: 'failure' });
      revMetrics.observe('rev_request', Date.now() - startTime);
      requestMetricRecorded = true;
    }
    if (persistenceStage) {
      revMetrics.record('rev_persistence_failures_total', 1, { stage: persistenceStage });
      persistenceStage = null;
    }
    // An accepted turn must have a terminal replay outcome. Without this row a
    // network/client retry would see an eternal in-progress submission.
    if (activeConvId && acceptedOrg && !reuseUserMessage) {
      try {
        persistenceStage = 'failed_turn_write';
        await _insertRevMessage({
          organizationId: acceptedOrg.id, userId: req.user.id, conversationId: activeConvId,
          sequenceNumber: revSequence, correlationId,
          content: { response_type: 'error', error: true, read_only: true, correlation_id: correlationId, execution_id: executionId },
          hasError: true, errorCode: error.code || 'INTELLIGENCE_UNAVAILABLE',
          errorMessage: error.publicMessage || 'Rev could not complete this response. Please retry.',
          latencyMs: Date.now() - startTime,
        });
        persistenceStage = 'conversation_update';
        await _touchConversation(activeConvId, { increment: 2 });
        persistenceStage = null;
      } catch (persistenceError) {
        if (persistenceStage) revMetrics.record('rev_persistence_failures_total', 1, { stage: persistenceStage });
        logger.error('rev_chat_failure_persistence_failed', { correlationId, executionId, errorType: persistenceError.name });
      }
    }
    next(error);
  }
};

// ── GET /api/v1/rev/conversations ─────────────────────────────────────────────

exports.getConversations = async (req, res, next) => {
  let restorationAttempted = false;
  const restoreCorrelationId = safeId(req.get?.('X-Correlation-ID') || req.get?.('X-Request-ID'));
  const restoreExecutionId = uuidv4();
  try {
    const org    = await getAuthenticatedOrg(req.user.id, req.user.tenantId);
    restorationAttempted = true;
    res.setHeader('X-Correlation-ID', restoreCorrelationId);
    res.setHeader('X-Execution-ID', restoreExecutionId);
    const limit  = Math.min(parseInt(req.query.limit  || '20', 10), 50);
    const offset = Math.max(parseInt(req.query.offset || '0',  10), 0);
    // Conversation search is always scoped to the authenticated organization.
    // Wildcards are escaped so a search term cannot broaden the tenant filter.
    const rawSearch = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
    const search = rawSearch ? `%${rawSearch.replace(/([%_\\])/g, '\\$1')}%` : null;

    const conversations = search
      ? await prisma.$queryRaw`
          SELECT c.id, c.title, c.status,
            (SELECT COUNT(*)::int FROM conversation_messages cm_count
             WHERE cm_count.conversation_id = c.id
               AND cm_count.organization_id = c.organization_id) AS message_count,
            c.last_activity_at, c.created_at
          FROM conversations c
          WHERE c.organization_id = ${org.id}::uuid
            AND c.status = 'active'
            AND EXISTS (
              SELECT 1 FROM conversation_messages cm_any
              WHERE cm_any.conversation_id = c.id
                AND cm_any.organization_id = c.organization_id
            )
            AND (
              COALESCE(c.title, '') ILIKE ${search}
              OR EXISTS (
                SELECT 1 FROM conversation_messages cm
                WHERE cm.conversation_id = c.id
                  AND cm.organization_id = ${org.id}::uuid
                  AND cm.content::text ILIKE ${search}
              )
            )
          ORDER BY c.last_activity_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `
      : await prisma.$queryRaw`
          SELECT c.id, c.title, c.status,
            (SELECT COUNT(*)::int FROM conversation_messages cm_count
             WHERE cm_count.conversation_id = c.id
               AND cm_count.organization_id = c.organization_id) AS message_count,
            c.last_activity_at, c.created_at
          FROM conversations c
          WHERE c.organization_id = ${org.id}::uuid
            AND c.status = 'active'
            AND EXISTS (
              SELECT 1 FROM conversation_messages cm
              WHERE cm.conversation_id = c.id
                AND cm.organization_id = c.organization_id
            )
          ORDER BY c.last_activity_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;

    return res.status(200).json({
      success: true,
      data: conversations,
      pagination: { limit, offset },
      search: rawSearch || null,
    });
  } catch (error) {
    if (restorationAttempted) {
      revMetrics.record('rev_conversation_restoration_failures_total', 1, { stage: 'conversation_list' });
      logger.warn('rev_conversation_restoration_failed', {
        correlationId: restoreCorrelationId, executionId: restoreExecutionId, errorType: error.name,
      });
    }
    next(error);
  }
};

// ── GET /api/v1/rev/conversation/:id ─────────────────────────────────────────

exports.getConversation = async (req, res, next) => {
  let restorationAttempted = false;
  const restoreCorrelationId = safeId(req.get?.('X-Correlation-ID') || req.get?.('X-Request-ID'));
  const restoreExecutionId = uuidv4();
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Conversation ID required.' },
      });
    }

    const org  = await getAuthenticatedOrg(req.user.id, req.user.tenantId);
    const conv = await verifyConversationOwnership(id, org.id);
    restorationAttempted = true;
    res.setHeader('X-Correlation-ID', restoreCorrelationId);
    res.setHeader('X-Execution-ID', restoreExecutionId);

    const limit  = Math.min(parseInt(req.query.limit  || '50', 10), 100);
    const offset = Math.max(parseInt(req.query.offset || '0',  10), 0);

    const messages = await prisma.$queryRaw`
      SELECT
        cm.id, cm.role, cm.content, cm.sequence_number,
        cm.agent_name, cm.confidence_score, cm.has_error, cm.error_code, cm.error_message,
        cm.created_at,
        fb.rating AS feedback_rating
      FROM conversation_messages cm
      JOIN conversations cv ON cv.id = cm.conversation_id
      LEFT JOIN conversation_message_feedback fb
        ON fb.message_id = cm.id AND fb.user_id = ${req.user.id}::uuid
      WHERE cm.conversation_id = ${id}::uuid
        AND cv.organization_id = ${org.id}::uuid
      ORDER BY cm.sequence_number ASC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const safeMessages = messages.map((message) => ({
      ...message,
      content: message.role === 'rev' ? safePersistedNarrative(message.content) : message.content,
    }));

    return res.status(200).json({
      success: true,
      data: {
        conversation: conv,
        messages: safeMessages,
        pagination: { limit, offset },
      },
    });
  } catch (error) {
    if (restorationAttempted) {
      revMetrics.record('rev_conversation_restoration_failures_total', 1, { stage: 'conversation_read' });
      logger.warn('rev_conversation_restoration_failed', {
        correlationId: restoreCorrelationId, executionId: restoreExecutionId,
        errorType: error.name,
      });
    }
    next(error);
  }
};

// ── POST /api/v1/rev/message-feedback ─────────────────────────────────────────
// Thumbs up/down on a persisted Rev answer (ChatGPT-UI adoption §5 "action
// dock"). Same security invariants as every rev endpoint: the organisation is
// resolved from the authenticated JWT/DB — never from the request body — and
// the target message is verified to belong to that organisation and to be a
// Rev answer before anything is written. Changing a rating upserts; sending
// rating null deletes the merchant's row (toggle-off), so the table only ever
// holds an explicit current choice.

const FEEDBACK_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_FEEDBACK_RATINGS = ['up', 'down'];

exports.submitMessageFeedback = async (req, res, next) => {
  try {
    const org = await getAuthenticatedOrg(req.user.id, req.user.tenantId);

    const messageId = typeof req.body?.message_id === 'string'
      ? req.body.message_id.trim().toLowerCase()
      : '';
    const rating = req.body?.rating === undefined ? undefined : req.body?.rating;

    if (!FEEDBACK_UUID_PATTERN.test(messageId)
        || (rating !== null && !VALID_FEEDBACK_RATINGS.includes(rating))) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'A valid message_id and rating ("up", "down" or null) are required.',
        },
      });
    }

    const rows = await prisma.$queryRaw`
      SELECT id, organization_id, role
      FROM conversation_messages
      WHERE id = ${messageId}::uuid
      LIMIT 1
    `;
    const row = rows[0] || null;
    if (!row) {
      return res.status(404).json({
        success: false,
        error: { code: 'MESSAGE_NOT_FOUND', message: 'Message not found.' },
      });
    }
    if (String(row.organization_id) !== String(org.id)) {
      logger.warn('rev_cross_tenant_attempt', {
        requestorOrgId: org.id,
        messageOrgId:   row.organization_id,
        messageId,
        endpoint:       'message-feedback',
      });
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Not authorised to rate this message.' },
      });
    }
    if (row.role !== 'rev') {
      return res.status(400).json({
        success: false,
        error: { code: 'NOT_RATEABLE', message: 'Only Rev answers can be rated.' },
      });
    }

    if (rating === null) {
      await prisma.$executeRaw`
        DELETE FROM conversation_message_feedback
        WHERE message_id = ${messageId}::uuid
          AND user_id = ${req.user.id}::uuid
      `;
      return res.status(200).json({
        success: true,
        data: { message_id: messageId, rating: null },
      });
    }

    await prisma.$executeRaw`
      INSERT INTO conversation_message_feedback (organization_id, message_id, user_id, rating)
      VALUES (${org.id}::uuid, ${messageId}::uuid, ${req.user.id}::uuid, ${rating})
      ON CONFLICT (message_id, user_id)
      DO UPDATE SET rating = EXCLUDED.rating, updated_at = NOW()
    `;
    return res.status(200).json({
      success: true,
      data: { message_id: messageId, rating },
    });
  } catch (error) {
    next(error);
  }
};

// ── POST /api/v1/memory ───────────────────────────────────────────────────────

const ALLOWED_MEMORY_TYPES   = ['preference', 'constraint', 'context', 'seasonal', 'behavioral', 'feedback'];
const ALLOWED_MEMORY_SOURCES = ['explicit', 'inferred'];
const INJECTION_PATTERNS = [
  /ignore (all|previous|your)/i,
  /reveal (system|prompt|instruction)/i,
  /you are now/i,
  /new instruction/i,
  /forget (everything|all|your)/i,
  /disregard/i,
];

function isInjectionAttempt(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return INJECTION_PATTERNS.some(p => p.test(text));
}

exports.createMemory = async (req, res, next) => {
  try {
    const { memory_type, memory_key, memory_value, memory_source, importance } = req.body;

    if (!memory_type || !ALLOWED_MEMORY_TYPES.includes(memory_type)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: `memory_type must be one of: ${ALLOWED_MEMORY_TYPES.join(', ')}` },
      });
    }
    if (!memory_key || typeof memory_key !== 'string' || memory_key.length > 100) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'memory_key must be a string under 100 characters.' },
      });
    }
    if (memory_value === undefined || memory_value === null) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'memory_value is required.' },
      });
    }

    const valueStr = JSON.stringify(memory_value);
    if (valueStr.length > 1000) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'memory_value exceeds maximum size.' },
      });
    }

    if (isInjectionAttempt(memory_value) || isInjectionAttempt(memory_key)) {
      logger.warn('rev_memory_injection_attempt', { userId: req.user.id, key: memory_key });
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Memory content is not valid.' },
      });
    }

    const org          = await getAuthenticatedOrg(req.user.id, req.user.tenantId);
    const source       = ALLOWED_MEMORY_SOURCES.includes(memory_source) ? memory_source : 'explicit';
    const authorityLevel = source === 'explicit' ? 5 : 2;
    const importanceVal  = Math.min(Math.max(parseInt(importance || '3', 10), 1), 5);

    await prisma.$executeRaw`
      INSERT INTO merchant_memories (
        organization_id, user_id, memory_type, memory_key, memory_value,
        memory_source, authority_level, importance, is_active
      ) VALUES (
        ${org.id}::uuid, ${req.user.id}::uuid, ${memory_type}, ${memory_key},
        ${valueStr}::jsonb, ${source}, ${authorityLevel}, ${importanceVal}, true
      )
      ON CONFLICT (organization_id, memory_key)
      DO UPDATE SET
        memory_value    = EXCLUDED.memory_value,
        memory_source   = EXCLUDED.memory_source,
        authority_level = EXCLUDED.authority_level,
        importance      = EXCLUDED.importance,
        is_active       = true,
        updated_at      = NOW()
    `;

    logger.info('rev_memory_created', {
      orgId: org.id, userId: req.user.id,
      key: memory_key, type: memory_type, source, authority: authorityLevel,
    });

    return res.status(201).json({
      success: true,
      data: { memory_key, memory_type, memory_source: source, authority_level: authorityLevel },
    });
  } catch (error) {
    next(error);
  }
};

// ── GET /api/v1/rev/health ────────────────────────────────────────────────────

exports.internalMetrics = async (req, res) => {
  const configured = process.env.ML_INTERNAL_KEY || '';
  const supplied = req.get('X-Internal-Key') || '';
  const crypto = require('crypto');
  const expected = Buffer.from(configured);
  const actual = Buffer.from(supplied);
  if (!configured || expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  }
  return res.status(200).json(revMetrics.snapshot());
};

exports.intelligenceHealth = async (req, res, next) => {
  try {
    const pythonHealth = await mlService.checkPythonHealth();
    return res.status(200).json({
      success: true,
      data: { node: 'healthy', python: pythonHealth },
    });
  } catch (error) {
    next(error);
  }
};

// ── DELETE /api/v1/rev/conversation/:id ──────────────────────────────────────

exports.deleteConversation = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'ID required.' } });

    const org = await getAuthenticatedOrg(req.user.id, req.user.tenantId);
    // Verify ownership
    await verifyConversationOwnership(id, org.id);

    // Soft delete — mark as deleted so history is preserved but hidden
    await prisma.$executeRaw`
      UPDATE conversations
      SET status = 'deleted', summary = NULL, context_window = NULL, updated_at = NOW()
      WHERE id = ${id}::uuid AND organization_id = ${org.id}::uuid
    `;

    logger.info('conversation_deleted', { orgId: org.id, conversationId: id });
    return res.status(200).json({ success: true, data: { id } });
  } catch (error) {
    next(error);
  }
};

// ── PATCH /api/v1/rev/conversation/:id/title ─────────────────────────────────

exports.renameConversation = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title } = req.body;

    if (!id) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'ID required.' } });
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Title is required.' } });
    }
    const cleanTitle = title.trim().slice(0, 100);

    const org = await getAuthenticatedOrg(req.user.id, req.user.tenantId);
    await verifyConversationOwnership(id, org.id);

    await prisma.$executeRaw`
      UPDATE conversations SET title = ${cleanTitle}, updated_at = NOW()
      WHERE id = ${id}::uuid AND organization_id = ${org.id}::uuid
    `;

    logger.info('conversation_renamed', { orgId: org.id, conversationId: id });
    return res.status(200).json({ success: true, data: { id, title: cleanTitle } });
  } catch (error) {
    next(error);
  }
};

// ── GET /api/v1/rev/briefing ──────────────────────────────────────────────────

exports.getMorningBriefing = async (req, res, next) => {
  const correlationId = uuidv4();
  try {
    const org = await getAuthenticatedOrg(req.user.id, req.user.tenantId);

    const briefing = await prisma.morning_briefings.findFirst({
      where: { organization_id: org.id },
      orderBy: { generated_at: 'desc' },
    });
    return res.status(200).json({ success: true, data: briefing || null });
  } catch (error) {
    logger.error('get_morning_briefing_failed', {
      correlationId,
      userId: req.user?.id,
      error:  error.message,
    });
    next(error);
  }
};

// ── POST /api/v1/rev/alerts/check ────────────────────────────────────────────
// Called every 15 minutes by a cron job (or manually) after business state rebuild.
// Checks Python for anomalies and creates notifications for all org users.

exports.checkAndCreateAlerts = async (req, res, next) => {
  try {
    const org = await getAuthenticatedOrg(req.user.id, req.user.tenantId);

    // Get all active users in this org
    const members = await prisma.organization_members.findMany({
      where:  { organization_id: org.id, status: "active" },
      select: { user_id: true },
    });
    const userIds = members.map(m => m.user_id);

    const result = await mlService.checkAlerts({
      organizationId: org.id,
      userIds,
      correlationId: `alerts-${org.id}-${Date.now()}`,
    });
    if (!result.success) {
      return res.status(502).json({ success: false, error: { code: 'ALERTS_UNAVAILABLE', message: 'Alerts could not be checked.' } });
    }

    const { alerts = [] } = result.data || {};
    if (!alerts.length) {
      return res.status(200).json({ success: true, data: { alerts_created: 0 } });
    }

    // Create a notification for each user for each alert
    const { createAnomalyAlert } = require('./notificationController');
    let created = 0;
    for (const userId of userIds) {
      for (const alert of alerts) {
        await createAnomalyAlert({
          userId,
          orgId:     org.id,
          type:      alert.type,
          message:   alert.message,
          actionUrl: alert.action_url,
        });
        created++;
      }
    }

    logger.info('anomaly_alerts_created', { orgId: org.id, count: created });
    return res.status(200).json({ success: true, data: { alerts_created: created, alerts } });
  } catch (error) {
    next(error);
  }
};
/**
 * Read-only Phase 3 findings endpoint. All queries are scoped by the
 * authenticated organization. Revenue/customer findings remain suppressed
 * until historical data completeness is verified by the ingestion pipeline.
 */
exports.getIntelligenceFindings = async (req, res, next) => {
  try {
    const org = await getAuthenticatedOrg(req.user.id, req.user.tenantId);
    const { listFindings } = require('../services/intelligenceFindingsRepository');
    const findings = await listFindings(prisma, org.id, { status: req.query.status, limit: req.query.limit });
    return res.status(200).json({ success: true, data: { findings } });
  } catch (error) { next(error); }
};

exports.refreshIntelligenceFindings = async (req, res, next) => {
  try {
    const org = await getAuthenticatedOrg(req.user.id, req.user.tenantId);
    const { evaluateOrganizationFindings } = require('../services/intelligenceFindingsAggregator');
    const { persistVerifiedFindings } = require('../services/intelligenceFindingsRepository');
    const evaluated = await evaluateOrganizationFindings(prisma, org.id);
    const persisted = await persistVerifiedFindings(prisma, org.id, evaluated.findings);
    return res.status(200).json({ success: true, data: {
      persisted, diagnostics: evaluated.diagnostics, evaluated_at: evaluated.evaluated_at,
    } });
  } catch (error) { next(error); }
};

exports.getIntelligenceFinding = async (req, res, next) => {
  try {
    const org = await getAuthenticatedOrg(req.user.id, req.user.tenantId);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_FINDING_ID' } });
    }
    const finding = await prisma.intelligence_findings.findFirst({
      where: { id: req.params.id, organization_id: org.id },
      select: { id: true, store_id: true, type: true, severity: true, status: true, title: true,
        description: true, evidence: true, action: true, detected_at: true,
        dedupe_key: true, updated_at: true, acknowledged_at: true, resolved_at: true, dismissed_at: true },
    });
    if (!finding) return res.status(404).json({ success: false, error: { code: 'FINDING_NOT_FOUND' } });
    const ownedStore = await prisma.stores.findFirst({ where: { id: finding.store_id, organization_id: org.id }, select: { id: true } });
    if (!ownedStore) return res.status(404).json({ success: false, error: { code: 'FINDING_NOT_FOUND' } });
    let resource = null;
    if (finding.type !== 'integration_failure') {
      const sync = await prisma.store_sync_domain_states.findFirst({
        where: { store_id: finding.store_id, domain: finding.type === 'refund_increase' ? 'refunds' : 'orders' },
        select: { status: true, last_succeeded_at: true, error_code: true },
      });
      const age = sync?.last_succeeded_at ? Date.now() - new Date(sync.last_succeeded_at).getTime() : Number.POSITIVE_INFINITY;
      resource = {
        availability: sync?.status === 'ok' && sync.last_succeeded_at ? 'available' : 'retrieval_failed',
        freshness: age > 3600_000 ? 'stale' : 'fresh',
        reason: sync?.status === 'ok' ? null : 'The latest source synchronization does not support a current claim.',
      };
    }
    const { assessFinding, presentPriorityFinding } = require('../services/priorityFindingService');
    const assessment = assessFinding(finding, { resource });
    const presented = presentPriorityFinding({ finding, assessment, duplicates: [] }, org.id);
    return res.status(200).json({ success: true, data: { finding: {
      ...finding, current_validity: assessment.current_validity,
      confidence: assessment.confidence, evidence_freshness: assessment.freshness,
      limitations: assessment.limitations,
    }, priority_finding: presented } });
  } catch (error) { next(error); }
};

exports.updateIntelligenceFinding = async (req, res, next) => {
  try {
    const org = await getAuthenticatedOrg(req.user.id, req.user.tenantId);
    const { changeFindingStatus } = require('../services/intelligenceFindingsRepository');
    const result = await changeFindingStatus(prisma, org.id, req.params.id, req.body?.status);
    if (result.invalid) return res.status(400).json({ success: false, error: { code: 'INVALID_FINDING_STATUS' } });
    if (!result.changed) return res.status(404).json({ success: false, error: { code: 'FINDING_NOT_FOUND_OR_CLOSED' } });
    return res.status(200).json({ success: true, data: { status: req.body.status } });
  } catch (error) { next(error); }
};

// ═══════════════════════════════════════════════════════════════════════════
// Rev Intelligence — streaming workspace endpoints
// ═══════════════════════════════════════════════════════════════════════════

const MAX_PERSISTED_EVIDENCE_ITEMS = 60;

function _boundedResultForPersistence(data) {
  const evidence = data?.evidence ? { ...data.evidence } : null;
  if (evidence && Array.isArray(evidence.items)) {
    evidence.items = evidence.items.slice(0, MAX_PERSISTED_EVIDENCE_ITEMS);
  }
  // Previous-period items are cited by comparison facts, so they must travel
  // with the answer for those citations to resolve.
  if (evidence && Array.isArray(evidence.comparison_items)) {
    evidence.comparison_items = evidence.comparison_items.slice(0, MAX_PERSISTED_EVIDENCE_ITEMS);
  }
  return {
    contract_version: data?.contract_version || 'rev-investigation-v1',
    correlation_id: data?.correlation_id || null,
    execution_id: data?.execution_id || null,
    execution_metadata: data?.execution_metadata || null,
    response_type: data?.response_type || 'analysis',
    text: data?.text || '',
    response: data?.response || null,
    evidence,
    facts: Array.isArray(data?.facts) ? data.facts.slice(0, 40) : [],
    comparison_facts: Array.isArray(data?.comparison_facts) ? data.comparison_facts.slice(0, 20) : [],
    // Task 204: the versioned epistemic claim set (rev-claim-v1) and its
    // rollup travel with the answer so the UI can present what is verified,
    // calculated, hypothesised or unknown, and so persisted history keeps
    // the same provenance the live answer showed.
    claims: Array.isArray(data?.claims) ? data.claims.slice(0, 10) : [],
    epistemics: data?.epistemics && typeof data.epistemics === 'object'
      ? data.epistemics : null,
    corrections: data?.corrections && typeof data.corrections === 'object'
      ? data.corrections : null,
    // Task 206: the recorded priority state, the challenge comparison
    // ("why is that more important than X?") and the volume/value
    // decomposition travel with the answer so persisted history and the UI
    // keep the same ranking, basis and calculation the live answer showed.
    priority: data?.priority && typeof data.priority === 'object'
      ? data.priority : null,
    priority_comparison: data?.priority_comparison && typeof data.priority_comparison === 'object'
      ? data.priority_comparison : null,
    priority_change: data?.priority_change && typeof data.priority_change === 'object'
      ? data.priority_change : null,
    contributor_analysis: Array.isArray(data?.contributor_analysis)
      ? data.contributor_analysis.slice(0, 8) : [],
    hypotheses: Array.isArray(data?.hypotheses) ? data.hypotheses.slice(0, 10) : [],
    unknowns: Array.isArray(data?.unknowns) ? data.unknowns.slice(0, 12) : [],
    recommendations: Array.isArray(data?.recommendations) ? data.recommendations.slice(0, 12) : [],
    investigation: data?.investigation || null,
    investigation_outcome: data?.investigation_outcome || null,
    specialists: Array.isArray(data?.specialists) ? data.specialists : [],
    question_understanding: data?.question_understanding || null,
    orchestration: data?.orchestration || null,
    selected_finding: data?.selected_finding || null,
    read_only: data?.read_only !== false,
    warnings: Array.isArray(data?.warnings) ? data.warnings.slice(0, 12) : [],
    // The mode decides how the answer is presented (quiet chat vs verified
    // report). Dropping it forced the UI to guess from an empty evidence
    // shell and mis-rendered greetings as full investigations (GREET-001);
    // persisting it also makes production mode assignment checkable from
    // the database alone.
    response_mode: data?.response_mode || null,
    mode_reason: data?.mode_reason || null,
    // Understanding/gate metadata: the response contract (conversational
    // intelligence upgrade §16) so presentation and audits never infer intent
    // from content shape.
    understanding: data?.understanding || null,
    // Which provider/model actually answered, with token usage, tool calls
    // and stop reason — sanitized, so audits never infer them from prose.
    execution_trace: _sanitizeExecutionTrace(data?.execution_trace),
    agent_answer: _sanitizeAgentAnswer(data?.agent_answer),
  };
}

// Exported for contract tests only.
exports._boundedResultForPersistence = _boundedResultForPersistence;
exports._sanitizeExecutionTrace = _sanitizeExecutionTrace;
exports._executionPersistenceFields = _executionPersistenceFields;

const PROVIDER_NAME = /^[a-z][a-z0-9_-]{0,39}$/;
const MODEL_NAME = /^[A-Za-z0-9._:-]{1,120}$/;
const TRACE_TOKEN = /^[A-Za-z0-9._:-]{1,80}$/;

function _boundedInt(value, max = 10_000_000) {
  return Number.isInteger(value) && value >= 0 && value <= max ? value : null;
}

function _safeToken(value, pattern = TRACE_TOKEN) {
  return typeof value === 'string' && pattern.test(value) ? value : null;
}

/**
 * Privacy-safe projection of the Python execution trace. Only bounded
 * identifiers, counts, timings and classifications survive — never prompts,
 * merchant text, evidence payloads, credentials or raw provider errors.
 */
function _sanitizeExecutionTrace(trace) {
  if (!trace || typeof trace !== 'object') return null;
  const agent = trace.agent && typeof trace.agent === 'object' ? trace.agent : {};
  const usage = trace.token_usage && typeof trace.token_usage === 'object' ? trace.token_usage : {};
  const pick = (entries, keys, limit) => (Array.isArray(entries) ? entries : []).slice(0, limit).map((entry) => {
    const out = {};
    for (const key of keys) {
      const value = entry?.[key];
      if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
      else if (typeof value === 'boolean') out[key] = value;
      else if (typeof value === 'string' && TRACE_TOKEN.test(value)) out[key] = value;
    }
    return out;
  });
  return {
    provider: _safeToken(trace.provider, PROVIDER_NAME),
    model: _safeToken(trace.model, MODEL_NAME),
    model_attribution: _safeToken(trace.model_attribution),
    duration_ms: typeof trace.duration_ms === 'number' ? Math.round(trace.duration_ms) : null,
    provider_duration_ms: typeof trace.provider_duration_ms === 'number' ? Math.round(trace.provider_duration_ms) : null,
    token_usage: {
      input: _boundedInt(usage.input), output: _boundedInt(usage.output), total: _boundedInt(usage.total),
      scope: _safeToken(usage.scope),
    },
    estimated_cost_usd: typeof trace.estimated_cost_usd === 'number' && Number.isFinite(trace.estimated_cost_usd)
      ? Math.round(trace.estimated_cost_usd * 1e6) / 1e6 : null,
    retries: _boundedInt(trace.retries, 100),
    fallback_used: trace.fallback_used === true,
    cancelled: trace.cancelled === true,
    failure_category: _safeToken(trace.failure_category),
    final_status: _safeToken(trace.final_status),
    tool_selection: (Array.isArray(trace.tool_selection) ? trace.tool_selection : [])
      .filter((tool) => typeof tool === 'string' && TRACE_TOKEN.test(tool)).slice(0, 12),
    citations: (Array.isArray(trace.citations) ? trace.citations : [])
      .filter((url) => typeof url === 'string' && /^https:\/\/[^\s]{1,490}$/.test(url)).slice(0, 8),
    agent: {
      contract_version: _safeToken(agent.contract_version),
      mode: _safeToken(agent.mode),
      model_directed: agent.model_directed === true,
      status: _safeToken(agent.status),
      stop_reason: _safeToken(agent.stop_reason),
      iterations: _boundedInt(agent.iterations, 100),
      fallback_mode: _safeToken(agent.fallback_mode),
      duplicate_calls: _boundedInt(agent.duplicate_calls, 100),
      calculations: _boundedInt(agent.calculations, 100),
      web_searches: _boundedInt(agent.web_searches, 100),
      answer_validation: agent.answer_validation && typeof agent.answer_validation === 'object'
        ? { status: _safeToken(agent.answer_validation.status), reason: _safeToken(agent.answer_validation.reason),
            kind: _safeToken(agent.answer_validation.kind) } : null,
      tool_calls: pick(agent.tool_calls, ['tool', 'status', 'source_status', 'iteration', 'duration_ms',
        'item_count', 'failure_category', 'provider', 'model', 'source_count', 'cache_hit', 'source', 'reason'], 16),
      model_turns: pick(agent.model_turns, ['iteration', 'provider', 'model', 'input_tokens', 'output_tokens',
        'duration_ms', 'attempts', 'fallback_used', 'outcome', 'category', 'stop_reason'], 12),
    },
    investigation_id: _safeToken(trace.investigation_id, TRACE_ID),
    knowledge_sources: _sanitizeKnowledgeSources(trace.knowledge_sources),
    telemetry: _sanitizeTelemetry(trace.telemetry, pick),
  };
}

const TRACE_ID = /^[A-Za-z0-9-]{1,128}$/;

function _tokenMap(value, limit = 8) {
  const out = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [key, entry] of Object.entries(value).slice(0, limit)) {
    if (TRACE_TOKEN.test(key) && typeof entry === 'string' && TRACE_TOKEN.test(entry)) out[key] = entry;
  }
  return out;
}

/** Knowledge-source coverage: source names and statuses only, never content. */
function _sanitizeKnowledgeSources(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    manifest: _tokenMap(value.manifest),
    used: (Array.isArray(value.used) ? value.used : [])
      .filter((source) => typeof source === 'string' && TRACE_TOKEN.test(source)).slice(0, 6),
    revluma_docs_cited: _boundedInt(value.revluma_docs_cited, 100),
    private_context_used: value.private_context_used === true,
    coverage_notes: _boundedInt(value.coverage_notes, 20),
    fallback_mode: _safeToken(value.fallback_mode),
  };
}

/**
 * Structured execution telemetry (rev-execution-telemetry-v1): identifiers,
 * routing classifications, per-call provider/model/timing/tokens, tool and
 * cache use, retries, fallback, failure category, cancellation, final status.
 */
function _sanitizeTelemetry(value, pick) {
  if (!value || typeof value !== 'object') return null;
  const identifiers = value.identifiers && typeof value.identifiers === 'object' ? value.identifiers : {};
  const usage = value.token_usage && typeof value.token_usage === 'object' ? value.token_usage : {};
  const routing = value.routing && typeof value.routing === 'object' ? value.routing : {};
  const cache = {};
  if (value.cache && typeof value.cache === 'object') {
    for (const [name, counts] of Object.entries(value.cache).slice(0, 6)) {
      if (!TRACE_TOKEN.test(name) || !counts || typeof counts !== 'object') continue;
      cache[name] = {};
      for (const [outcome, count] of Object.entries(counts).slice(0, 8)) {
        if (TRACE_TOKEN.test(outcome) && _boundedInt(count, 100000) !== null) cache[name][outcome] = count;
      }
    }
  }
  const ids = {};
  for (const key of ['request_id', 'correlation_id', 'execution_id', 'conversation_id', 'investigation_id']) {
    const id = _safeToken(identifiers[key], TRACE_ID);
    if (id) ids[key] = id;
  }
  return {
    telemetry_version: _safeToken(value.telemetry_version),
    identifiers: ids,
    duration_ms: typeof value.duration_ms === 'number' && Number.isFinite(value.duration_ms)
      ? Math.round(value.duration_ms) : null,
    objective: _tokenMap(value.objective),
    routing: {
      ..._tokenMap(routing),
      sources: (Array.isArray(routing.sources) ? routing.sources : [])
        .filter((source) => typeof source === 'string' && TRACE_TOKEN.test(source)).slice(0, 8),
      followup: routing.followup === true,
      private_context_allowed: routing.private_context_allowed === true,
      web_requested: routing.web_requested === true,
    },
    stages: pick(value.stages, ['stage', 'duration_ms', 'outcome'], 40),
    model_calls: pick(value.model_calls, ['purpose', 'provider', 'model', 'duration_ms', 'input_tokens',
      'output_tokens', 'attempt', 'fallback_used', 'outcome', 'failure_category', 'http_status',
      'provider_error_type'], 24),
    token_usage: {
      input: _boundedInt(usage.input), output: _boundedInt(usage.output), total: _boundedInt(usage.total),
      scope: _safeToken(usage.scope), calls_with_usage: _boundedInt(usage.calls_with_usage, 100),
      successful_calls: _boundedInt(usage.successful_calls, 100),
    },
    tools: pick(value.tools, ['tool', 'status', 'duration_ms', 'reused', 'cache', 'failure_category',
      'selected_by'], 32),
    tool_reuse_count: _boundedInt(value.tool_reuse_count, 100),
    knowledge_sources: pick(value.knowledge_sources, ['source', 'status', 'result_count', 'retrieval_mode',
      'duration_ms', 'cache_hit'], 12),
    cache,
    retries: _boundedInt(value.retries, 100),
    fallback_used: value.fallback_used === true,
    failure_category: _safeToken(value.failure_category),
    cancelled: value.cancelled === true,
    final_status: _safeToken(value.final_status),
    outcome: _safeToken(value.outcome),
  };
}

/**
 * Columns describing which provider/model actually produced the answer. A
 * deterministic (no-model) answer records null provider/model rather than a
 * placeholder that would misrepresent the model used.
 */
function _executionPersistenceFields(content) {
  const trace = content?.execution_trace || null;
  const provider = trace?.provider || null;
  const model = trace?.model || null;
  const failed = content?.error === true;
  return {
    modelProvider: provider,
    modelName: model,
    inputTokens: trace?.token_usage?.input ?? null,
    outputTokens: trace?.token_usage?.output ?? null,
    metadata: trace ? JSON.stringify({
      execution_trace_version: 'rev-execution-trace-v1',
      execution_mode: failed ? 'failed'
        : (trace.agent?.model_directed ? 'model_agent' : (provider ? 'model_assisted' : 'deterministic')),
      // Which call the provider/model columns describe: the agent runtime, the
      // answer-composition call, or (failed turns) the attempt that failed.
      model_attribution: failed && provider ? 'failed_attempt' : (trace.model_attribution || null),
      estimated_cost_usd: trace.estimated_cost_usd,
      token_scope: trace.token_usage?.scope || null,
      stop_reason: trace.agent?.stop_reason || null,
      fallback_used: trace.fallback_used,
      retries: trace.retries,
      failure_category: trace.failure_category || null,
      failure_diagnostics: content?.failure_diagnostics || null,
    }) : null,
  };
}

/** Content-free provider failure diagnostics (rev-provider-failure-diagnostics-v1). */
function _sanitizeFailureDiagnostics(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const httpStatus = (status) => (Number.isInteger(status) && status >= 100 && status <= 599 ? status : null);
  return {
    contract_version: _safeToken(value.contract_version),
    provider: _safeToken(value.provider, PROVIDER_NAME),
    model: _safeToken(value.model, MODEL_NAME),
    category: _safeToken(value.category),
    http_status: httpStatus(value.http_status),
    provider_error_type: _safeToken(value.provider_error_type),
    attempts: _boundedInt(value.attempts, 10),
    fallback_used: value.fallback_used === true,
    failed_call_purpose: _safeToken(value.failed_call_purpose),
    attempt_log: (Array.isArray(value.attempt_log) ? value.attempt_log : []).slice(0, 4).map((entry) => ({
      provider: _safeToken(entry?.provider, PROVIDER_NAME),
      model: _safeToken(entry?.model, MODEL_NAME),
      outcome: _safeToken(entry?.outcome),
      category: _safeToken(entry?.category),
      http_status: httpStatus(entry?.http_status),
      provider_error_type: _safeToken(entry?.provider_error_type),
      duration_ms: typeof entry?.duration_ms === 'number' && Number.isFinite(entry.duration_ms)
        ? Math.round(entry.duration_ms) : null,
    })),
  };
}

/**
 * Persisted content for a failed turn. No prose and no provider messages:
 * only bounded diagnostics and the sanitized execution telemetry, so the
 * failure category, provider, model and per-call timings stay observable.
 */
function _failedTurnContent(error) {
  const content = { response_type: 'error', error: true, read_only: true };
  const diagnostics = _sanitizeFailureDiagnostics(error?.diagnostics);
  const telemetry = error?.telemetry && typeof error.telemetry === 'object' && !Array.isArray(error.telemetry)
    ? error.telemetry : null;
  if (!diagnostics && !telemetry) return content;
  content.failure_diagnostics = diagnostics;
  content.execution_trace = _sanitizeExecutionTrace({
    provider: diagnostics?.provider || null,
    model: diagnostics?.model || null,
    failure_category: diagnostics?.category || error?.failure?.category || null,
    final_status: 'failed',
    fallback_used: diagnostics?.fallback_used === true,
    retries: diagnostics?.attempts ? Math.max(0, diagnostics.attempts - 1) : 0,
    token_usage: telemetry?.token_usage || null,
    telemetry,
  });
  return content;
}
exports._failedTurnContent = _failedTurnContent;

/** Bounded, guardrail-filtered agent answer metadata (no prose duplication). */
function _sanitizeAgentAnswer(answer) {
  if (!answer || typeof answer !== 'object') return null;
  const strings = (list, limit, max) => (Array.isArray(list) ? list : [])
    .filter((entry) => typeof entry === 'string').slice(0, limit).map((entry) => entry.slice(0, max));
  return {
    contract_version: _safeToken(answer.contract_version),
    source: _safeToken(answer.source),
    provider: _safeToken(answer.provider, PROVIDER_NAME),
    model: _safeToken(answer.model, MODEL_NAME),
    validation: answer.validation && typeof answer.validation === 'object'
      ? { status: _safeToken(answer.validation.status), reason: _safeToken(answer.validation.reason),
          kind: _safeToken(answer.validation.kind) } : null,
    evidence_sufficiency: _safeToken(answer.evidence_sufficiency),
    cited_evidence_ids: strings(answer.cited_evidence_ids, 40, 120),
    hypotheses_unverified: strings(answer.hypotheses_unverified, 6, 400),
    unknowns: strings(answer.unknowns, 6, 400),
    calculations: (Array.isArray(answer.calculations) ? answer.calculations : []).slice(0, 12).map((calc) => ({
      id: _safeToken(calc?.id), operation: _safeToken(calc?.operation),
      inputs: strings(calc?.inputs, 12, 120), value: typeof calc?.value === 'string' ? calc.value.slice(0, 40) : null,
      unit: _safeToken(calc?.unit), currency: _safeToken(calc?.currency),
      label: typeof calc?.label === 'string' ? calc.label.slice(0, 120) : null,
    })),
    web_sources: (Array.isArray(answer.web_sources) ? answer.web_sources : []).slice(0, 8)
      .filter((source) => typeof source?.url === 'string' && /^https:\/\/[^\s]{1,490}$/.test(source.url))
      .map((source) => ({ id: _safeToken(source.id), url: source.url,
        title: typeof source.title === 'string' ? source.title.slice(0, 200) : null })),
  };
}

async function _insertRevMessage({
  organizationId, userId, conversationId, sequenceNumber, correlationId, content,
  hasError = false, errorCode = null, errorMessage = null, investigation = null,
  agentsUsed = [], confidenceScore = null, latencyMs = null,
}) {
  const messageId = uuidv4();
  const contentStr = JSON.stringify(content);
  const steps = investigation?.steps ? JSON.stringify(investigation.steps).slice(0, 100_000) : null;
  const toolStatuses = investigation?.tools_used
    ? JSON.stringify({ tools_used: investigation.tools_used }).slice(0, 10_000) : null;
  const execution = _executionPersistenceFields(content);
  await prisma.$executeRaw`
    INSERT INTO conversation_messages (
      id, conversation_id, organization_id, user_id, role, content,
      sequence_number, agent_name, model_name, model_provider, correlation_id,
      confidence_score, has_error, error_code, error_message, tool_calls,
      tool_results, latency_ms, orchestrator_mode, confidence_basis,
      input_tokens, output_tokens, metadata
    ) VALUES (
      ${messageId}::uuid, ${conversationId}::uuid, ${organizationId}::uuid,
      ${userId}::uuid, 'rev', ${contentStr}::jsonb, ${sequenceNumber},
      ${(agentsUsed || []).join(',')}, ${execution.modelName}, ${execution.modelProvider},
      ${correlationId}::uuid, ${confidenceScore}, ${hasError}, ${errorCode},
      ${errorMessage}, ${steps}::jsonb, ${toolStatuses}::jsonb, ${latencyMs},
      ${investigation?.intent || null}, ${content?.response?.confidence?.basis || null},
      ${execution.inputTokens}, ${execution.outputTokens}, ${execution.metadata}::jsonb
    )
  `;
  return messageId;
}

async function _persistFindingContext(conversationId, organizationId, data) {
  if (!data || !Object.prototype.hasOwnProperty.call(data, 'selected_finding')) return;
  const selected = data.selected_finding ? {
    finding_id: data.selected_finding.finding_id,
    selection_source: data.selected_finding.selection_source || 'conversation_context',
    selected_at: data.selected_finding.selected_at || new Date().toISOString(),
  } : null;
  const recommendations = (Array.isArray(data.recommendations) ? data.recommendations : [])
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .slice(0, 3)
    .map((item) => ({
      recommendation_id: typeof item.recommendation_id === 'string' ? item.recommendation_id : null,
      finding_id: typeof item.finding_id === 'string' ? item.finding_id : null,
      lifecycle_state: typeof item.lifecycle_state === 'string' ? item.lifecycle_state : 'active',
      title: typeof item.title === 'string' ? item.title.slice(0, 240) : '',
    }));
  // Atomic JSONB updates avoid read/modify/write races with other bounded
  // context fields. Both conversation and organization are authorized here.
  await prisma.$executeRaw`
    UPDATE conversations
    SET context_window = jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                COALESCE(context_window, '{}'::jsonb),
                '{last_selected_finding}', ${JSON.stringify(selected)}::jsonb, true
              ),
              '{last_recommendations}', ${JSON.stringify(recommendations)}::jsonb, true
            ),
            '{last_consistency}', ${JSON.stringify(data.consistency || null)}::jsonb, true
          ),
          '{structured_summary}', ${JSON.stringify(data.structured_summary || null)}::jsonb, true
        ),
        updated_at = NOW()
    WHERE id = ${conversationId}::uuid
      AND organization_id = ${organizationId}::uuid
  `;
}

exports._persistFindingContext = _persistFindingContext;

async function _touchConversation(conversationId, { titleHint, increment = 2 }) {
  await prisma.$executeRaw`
    UPDATE conversations
    SET last_activity_at = NOW(),
        message_count = message_count + ${increment},
        title = COALESCE(title, ${titleHint}),
        updated_at = NOW()
    WHERE id = ${conversationId}::uuid
  `;
}

async function _loadConversationContext(conversationId, organizationId, trace = {}) {
  try {
    const rows = await withTimeout(prisma.$queryRaw`
      SELECT summary, context_window
      FROM conversations
      WHERE id = ${conversationId}::uuid
        AND organization_id = ${organizationId}::uuid
      LIMIT 1
    `, TIMEOUT_POLICY_MS.contextRetrieval, 'context_retrieval');
    const row = rows?.[0] || {};
    let contextWindow = row.context_window ?? null;
    if (typeof contextWindow === 'string') {
      try { contextWindow = JSON.parse(contextWindow); } catch { contextWindow = null; }
    }
    const context = {
      summary: typeof row.summary === 'string' ? row.summary.slice(0, 500) : null,
      context_window: contextWindow && typeof contextWindow === 'object' && !Array.isArray(contextWindow)
        ? contextWindow : null,
    };
    // Leave room for merchant context within the Python 16 KiB request limit.
    if (Buffer.byteLength(JSON.stringify(context), 'utf8') > 8 * 1024) {
      return { summary: context.summary, context_window: null, context_error: 'context_summary_truncated' };
    }
    return context;
  } catch (error) {
    revMetrics.record('rev_conversation_restoration_failures_total', 1, { stage: 'context_load' });
    logger.warn('rev_conversation_context_unavailable', {
      correlationId: trace.correlationId, executionId: trace.executionId, errorType: error.name,
    });
    return { summary: null, context_window: null,
      context_error: error.code === 'REV_TIMEOUT' ? 'context_timeout' : 'context_unavailable' };
  }
}

// A model turn can run tens of seconds without producing a frame. A comment
// frame keeps proxies and the browser's inactivity timer from treating a live
// stream as dead; SSE parsers ignore comment lines by specification.
const SSE_HEARTBEAT_MS = Math.max(5_000, Number(process.env.REV_SSE_HEARTBEAT_MS) || 15_000);

function _sseWriter(res, { heartbeatMs = SSE_HEARTBEAT_MS } = {}) {
  let closed = false;
  let heartbeat = null;
  const stopHeartbeat = () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
  };
  if (heartbeatMs > 0) {
    heartbeat = setInterval(() => {
      if (closed || res.writableEnded) { stopHeartbeat(); return; }
      try { res.write(': keepalive\n\n'); } catch { closed = true; stopHeartbeat(); }
    }, heartbeatMs);
    if (typeof heartbeat.unref === 'function') heartbeat.unref();
    if (typeof res.on === 'function') res.on('close', stopHeartbeat);
  }
  return {
    send(event, data) {
      if (closed || res.writableEnded) return false;
      try {
        res.write(formatSseFrame(event, data));
        return true;
      } catch {
        closed = true;
        stopHeartbeat();
        return false;
      }
    },
    end() {
      stopHeartbeat();
      if (closed) return;
      closed = true;
      try { res.end(); } catch { /* noop */ }
    },
    get closed() { return closed; },
  };
}
exports._sseWriter = _sseWriter;

function _validateChatPayload(body) {
  try { return validateSubmission(body); }
  catch (error) {
    return { error: {
      status: error.statusCode || 400,
      code: error.code || 'VALIDATION_ERROR',
      message: error.message || 'Message is invalid.',
    } };
  }
}

async function _resolveFindingMessage(req, org, message) {
  if (req.body?.finding_id == null) return { message, selected_finding: null };
  const { resolveFindingChatContext } = require('../services/findingChatContext');
  const resolved = await resolveFindingChatContext(prisma, org.id, req.body.finding_id, message);
  if (resolved.status === 'invalid') return { error: { status: 400, code: 'INVALID_FINDING_ID' } };
  if (resolved.status === 'not_found') return { error: { status: 404, code: 'FINDING_NOT_FOUND' } };
  if (resolved.status !== 'ok') return { error: { status: 409, code: 'FINDING_CONTEXT_UNAVAILABLE' } };
  return { message, selected_finding: resolved.selected_finding };
}

// ── POST /api/v1/rev/stream ───────────────────────────────────────────────────
exports.chatStream = async (req, res, next) => {
  let correlationId = uuidv4();
  let executionId = uuidv4();
  const startedAt = Date.now();
  let sse = null;
  let activeConvId = null;
  let sequenceNumber = null;
  let finished = false;
  let requestMetricRecorded = false;
  let persistenceStage = null;
  let org = null;
  let validated = null;
  let reuseUserMessage = false;

  try {
    validated = _validateChatPayload(req.body);
    if (validated.error) {
      return res.status(validated.error.status).json({
        success: false, error: { code: validated.error.code, message: validated.error.message },
      });
    }
    org = await getAuthenticatedOrg(req.user.id, req.user.tenantId);
    const finding = await _resolveFindingMessage(req, org, validated.message);
    if (finding.error) {
      return res.status(finding.error.status).json({ success: false, error: finding.error });
    }
    const intelligenceMessage = finding.message;

    correlationId = validated.requestId;
    executionId = uuidv4();
    const requestedConversationId = req.body?.conversation_id || null;
    reuseUserMessage = req.body?.reuse_user_message === true;
    if (!reuseUserMessage) {
      const acceptance = await acceptSubmission({
        prisma, organizationId: org.id, userId: req.user.id,
        message: validated.message, requestId: correlationId,
        requestedConversationId,
      });
      activeConvId = acceptance.conversationId;
      if (acceptance.duplicate) {
        const replay = replayBody(acceptance.accepted, correlationId);
        if (!replay.completed) return res.status(409).json({
          success: false, conversation_id: replay.conversationId, idempotent_replay: true,
          error: { code: 'REV_TURN_IN_PROGRESS', message: 'This question was already accepted and is still being processed.' },
        });
        res.status(200);
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        if (typeof res.flushHeaders === 'function') res.flushHeaders();
        sse = _sseWriter(res);
        finished = true;
        sse.send('meta', { conversation_id: replay.conversationId, correlation_id: replay.requestId, execution_id: replay.content.execution_id || executionId, read_only: true, idempotent_replay: true });
        if (replay.failed) {
          sse.send('error', {
            conversation_id: replay.conversationId, code: replay.errorCode || 'INTELLIGENCE_UNAVAILABLE',
            message: replay.errorMessage || 'Rev could not complete this response.',
            retryable: true, idempotent_replay: true,
          });
        } else {
          sse.send('final', {
            ...replay.content, success: true, conversation_id: replay.conversationId,
            message_id: replay.messageId, read_only: true, idempotent_replay: true,
          });
        }
        sse.end();
        return undefined;
      }
    } else {
      await verifyConversationOwnership(requestedConversationId, org.id);
      activeConvId = requestedConversationId;
    }

    const seqResult = await prisma.$queryRaw`
      SELECT COALESCE(MAX(sequence_number), 0)::int AS max_seq
      FROM conversation_messages
      WHERE conversation_id = ${activeConvId}::uuid
    `;
    const revSequence = (Number(seqResult[0]?.max_seq) || 0) + 1;
    sequenceNumber = revSequence;

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    sse = _sseWriter(res);

    const controller = new AbortController();
    res.on('close', () => {
      if (!finished) controller.abort();
    });

    sse.send('meta', {
      conversation_id: activeConvId,
      correlation_id: correlationId,
      execution_id: executionId,
      read_only: true,
      started_at: new Date().toISOString(),
    });

    const merchantContext = await require('../services/revMerchantContext')
      .buildMerchantContext(prisma, org.id);
    let conversationContext;
    try {
      conversationContext = await _loadConversationContext(activeConvId, org.id, { correlationId, executionId });
    } catch (restorationError) {
      revMetrics.record('rev_conversation_restoration_failures_total', 1, { stage: 'context_load' });
      logger.warn('rev_conversation_restoration_failed', {
        correlationId, executionId, errorType: restorationError.name,
      });
      throw restorationError;
    }

    const streamed = await mlService.streamInvestigation({
      organizationId: org.id,
      userId: req.user.id,
      message: intelligenceMessage,
      conversationId: activeConvId,
      correlationId,
      executionId,
      contextPayload: {
        merchant_context: merchantContext,
        selected_finding: finding.selected_finding,
        _node_owns_chat_persistence: true,
        conversation_context: conversationContext,
      },
      signal: controller.signal,
      onEvent: (event, payload) => {
        if (event === 'meta' || event === 'final' || event === 'error') return;
        sse.send(event, {
          ...((payload && typeof payload === 'object') ? payload : { value: payload }),
          conversation_id: activeConvId,
        });
      },
    });

    if (streamed.success) {
      const data = streamed.data;
      const intent = data?.investigation?.intent || 'unknown';
      const storeIntent = new Set([
        'store_overview', 'revenue_investigation', 'checkout_investigation',
        'customer_retention', 'refund_investigation', 'product_investigation',
        'finding_investigation', 'traffic_investigation', 'data_coverage',
      ]).has(intent);
      const content = _boundedResultForPersistence(data);
      persistenceStage = 'rev_turn_write';
      const messageId = await _insertRevMessage({
        organizationId: org.id,
        userId: req.user.id,
        conversationId: activeConvId,
        sequenceNumber: revSequence,
        correlationId,
        content,
        investigation: data.investigation,
        agentsUsed: data.investigation?.tools_used || [],
        confidenceScore: data.response?.confidence?.score ?? null,
        latencyMs: Date.now() - startedAt,
      });
      persistenceStage = 'conversation_update';
      await _touchConversation(activeConvId, {
        titleHint: _generateTitle(validated.message),
        increment: reuseUserMessage ? 1 : 2,
      });
      persistenceStage = 'finding_context_write';
      await _persistFindingContext(activeConvId, org.id, data);
      persistenceStage = null;
      revMetrics.record('rev_requests_total', 1, { outcome: 'success' });
      revMetrics.record(storeIntent ? 'rev_investigations_total' : 'rev_general_questions_total', 1, { outcome: 'success' });
      revMetrics.observe('rev_request', Date.now() - startedAt);
      requestMetricRecorded = true;
      finished = true;
      sse.send('final', {
        success: true,
        conversation_id: activeConvId,
        message_id: messageId,
        read_only: true,
        ...content,
      });
      sse.end();
      logger.info('rev_stream_complete', {
        correlationId, executionId, orgId: org.id, conversationId: activeConvId,
        intent: data.investigation?.intent, latencyMs: Date.now() - startedAt,
      });
      return undefined;
    }

    if (streamed.error?.code === 'CANCELLED') {
      await _insertRevMessage({
        organizationId: org.id, userId: req.user.id, conversationId: activeConvId,
        sequenceNumber: revSequence, correlationId,
        content: { response_type: 'cancelled', text: '', cancelled: true, read_only: true },
        hasError: true, errorCode: 'CANCELLED',
        errorMessage: 'Generation stopped by the merchant.',
        latencyMs: Date.now() - startedAt,
      });
      await _touchConversation(activeConvId, {
        titleHint: _generateTitle(validated.message), increment: reuseUserMessage ? 1 : 2,
      });
      finished = true;
      sse.send('cancelled', { conversation_id: activeConvId, message_id: null });
      sse.end();
      return undefined;
    }

    const error = streamed.error || { code: 'INTELLIGENCE_UNAVAILABLE', message: 'Rev is unavailable.' };
    revMetrics.record('rev_requests_total', 1, { outcome: 'failure' });
    revMetrics.observe('rev_request', Date.now() - startedAt);
    requestMetricRecorded = true;
    if (error.failure?.category && ['provider_unavailable', 'connection_failed', 'rate_limited', 'timeout'].includes(error.failure.category)) {
      revMetrics.record('rev_provider_failures_total', 1, { category: error.failure.category });
    }
    if (error.code === 'INVALID_RESPONSE') revMetrics.record('rev_validation_failures_total', 1, { stage: 'response_contract' });
    persistenceStage = 'failed_turn_write';
    await _insertRevMessage({
      organizationId: org.id, userId: req.user.id, conversationId: activeConvId,
      sequenceNumber: revSequence, correlationId,
      content: _failedTurnContent(error),
      hasError: true, errorCode: error.code, errorMessage: error.message,
      latencyMs: Date.now() - startedAt,
    });
    persistenceStage = 'conversation_update';
    await _touchConversation(activeConvId, {
      titleHint: _generateTitle(validated.message), increment: reuseUserMessage ? 1 : 2,
    });
    persistenceStage = null;
    finished = true;
    sse.send('error', {
      conversation_id: activeConvId,
      correlation_id: correlationId,
      execution_id: executionId,
      code: error.code,
      message: error.message,
      failure: error.failure || null,
      retryable: typeof error.retryable === 'boolean' ? error.retryable : retryabilityForError(error.code),
      investigation_outcome: investigationOutcomeFromTransportError({
        code: error.code, organizationId: org.id,
      }),
    });
    sse.end();
    logger.warn('rev_stream_failed', {
      correlationId, orgId: org.id, errorCode: error.code,
      latencyMs: Date.now() - startedAt,
    });
    return undefined;
  } catch (error) {
    if (!requestMetricRecorded) {
      revMetrics.record('rev_requests_total', 1, { outcome: 'failure' });
      revMetrics.observe('rev_request', Date.now() - startedAt);
      requestMetricRecorded = true;
    }
    if (persistenceStage) {
      revMetrics.record('rev_persistence_failures_total', 1, { stage: persistenceStage });
      persistenceStage = null;
    }
    if (org && activeConvId && sequenceNumber) {
      try {
        await _insertRevMessage({
          organizationId: org.id, userId: req.user.id, conversationId: activeConvId,
          sequenceNumber, correlationId,
          content: { response_type: 'error', error: true, read_only: true },
          hasError: true, errorCode: error.code || 'STREAM_FAILED',
          errorMessage: 'Rev could not complete this response. Please retry.',
          latencyMs: Date.now() - startedAt,
        });
        await _touchConversation(activeConvId, {
          titleHint: _generateTitle(validated.message), increment: reuseUserMessage ? 1 : 2,
        });
      } catch (persistenceError) {
        revMetrics.record('rev_persistence_failures_total', 1, { stage: 'failed_turn_write' });
        logger.error('rev_stream_failure_persistence_failed', { correlationId, executionId, errorType: persistenceError.name });
      }
    }
    if (sse) {
      finished = true;
      sse.send('error', {
        conversation_id: activeConvId,
        correlation_id: correlationId,
        execution_id: executionId,
        code: 'STREAM_FAILED',
        message: 'Rev could not complete this response. Please retry.',
        retryable: true,
      });
      sse.end();
      logger.error('rev_stream_unhandled', {
        correlationId, executionId, errorType: error.name, statusCode: error.statusCode,
      });
      return undefined;
    }
    return next(error);
  }
};

// ── GET /api/v1/rev/tools ─────────────────────────────────────────────────────
let toolCatalogCache = { data: null, expiresAt: 0 };
exports.getToolCatalog = async (req, res, next) => {
  try {
    await getAuthenticatedOrg(req.user.id, req.user.tenantId);
    if (toolCatalogCache.data && toolCatalogCache.expiresAt > Date.now()) {
      return res.status(200).json({ success: true, data: toolCatalogCache.data });
    }
    const result = await mlService.getToolCatalog({ correlationId: uuidv4() });
    if (!result.success) {
      return res.status(503).json({
        success: false,
        error: { code: 'TOOL_CATALOG_UNAVAILABLE', message: 'Tool catalog is unavailable.' },
      });
    }
    const payload = { ...result.data, read_only: true };
    toolCatalogCache = { data: payload, expiresAt: Date.now() + 5 * 60 * 1000 };
    return res.status(200).json({ success: true, data: payload });
  } catch (error) {
    next(error);
  }
};

// ── POST /api/v1/rev/conversation/:id/retry ──────────────────────────────────
exports.retryConversation = async (req, res, next) => {
  try {
    const { id } = req.params;
    const org = await getAuthenticatedOrg(req.user.id, req.user.tenantId);
    await verifyConversationOwnership(id, org.id);

    const lastUser = await prisma.$queryRaw`
      SELECT id, content, sequence_number
      FROM conversation_messages
      WHERE conversation_id = ${id}::uuid
        AND organization_id = ${org.id}::uuid
        AND role = 'user'
      ORDER BY sequence_number DESC
      LIMIT 1
    `;
    if (!lastUser.length) {
      return res.status(409).json({ success: false, error: { code: 'NOTHING_TO_RETRY' } });
    }
    const content = lastUser[0].content;
    const text = typeof content === 'object' && content !== null ? content.text : null;
    if (!text) {
      return res.status(409).json({ success: false, error: { code: 'NOTHING_TO_RETRY' } });
    }
    const latestRev = await prisma.$queryRaw`
      SELECT has_error, error_code
      FROM conversation_messages
      WHERE conversation_id = ${id}::uuid
        AND organization_id = ${org.id}::uuid
        AND role = 'rev' AND sequence_number > ${lastUser[0].sequence_number}
      ORDER BY sequence_number DESC LIMIT 1
    `;
    if (latestRev.length && latestRev[0].has_error !== true) {
      return res.status(409).json({ success: false, error: { code: 'RETRY_ALREADY_COMPLETED' } });
    }
    if (latestRev.length && !retryabilityForError(latestRev[0].error_code)) {
      return res.status(409).json({
        success: false,
        error: { code: 'RETRY_NOT_ELIGIBLE', message: 'This failure needs a configuration, authorization or request change before retrying.' },
        retryable: false,
      });
    }
    // Remove failed assistant attempts after the user message so a retry does
    // not leave duplicate error turns in the merchant's history.
    await prisma.$executeRaw`
      DELETE FROM conversation_messages
      WHERE conversation_id = ${id}::uuid
        AND organization_id = ${org.id}::uuid
        AND role = 'rev'
        AND has_error = true
        AND sequence_number > ${lastUser[0].sequence_number}
    `;
    req.body = {
      ...req.body,
      message: text,
      conversation_id: id,
      reuse_user_message: true,
      finding_id: undefined,
    };
    return exports.chat(req, res, next);
  } catch (error) {
    next(error);
  }
};
