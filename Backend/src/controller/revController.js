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

// ── POST /api/v1/rev/chat ─────────────────────────────────────────────────────

exports.chat = async (req, res, next) => {
  const correlationId = uuidv4();
  const startTime     = Date.now();

  try {
    // 1. Validate input
    const rawMessage = req.body?.message;
    if (!rawMessage) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Message is required.' },
      });
    }
    const message = sanitiseMessage(rawMessage);
    if (!message || message.length < 1) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Message must not be empty.' },
      });
    }
    if (req.body?.execute === true) {
      return res.status(403).json({
        success: false,
        error: { code: 'READ_ONLY', message: 'Rev Intelligence is read-only. It cannot execute store changes.' },
      });
    }
    const conversationId  = req.body?.conversation_id || null;
    const imageBase64     = req.body?.image_base64     || null;
    const imageMediaType  = req.body?.image_media_type || null;
    const reuseUserMessage = req.body?.reuse_user_message === true;

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

    // Finding context is always resolved server-side under the authenticated organization.
    let intelligenceMessage = message;
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
        success: false, error: { code: 'FINDING_EVIDENCE_UNVERIFIED' },
      });
      intelligenceMessage = findingContext.context;
    }

    logger.info('rev_chat_request', {
      correlationId,
      orgId:          org.id,
      userId:         req.user.id,
      conversationId: conversationId || 'new',
      messageLength:  message.length,
    });

    // 3. Verify or create conversation
    let activeConvId = conversationId;
    if (conversationId) {
      await verifyConversationOwnership(conversationId, org.id);
    } else {
      const newConvId = uuidv4();
      await prisma.$executeRaw`
        INSERT INTO conversations (id, organization_id, user_id, status, message_count, last_activity_at)
        VALUES (${newConvId}::uuid, ${org.id}::uuid, ${req.user.id}::uuid, 'active', 0, NOW())
      `;
      activeConvId = newConvId;
    }

    // 4. Get next sequence number
    const seqResult = await prisma.$queryRaw`
      SELECT COALESCE(MAX(sequence_number), 0)::int as max_seq
      FROM conversation_messages
      WHERE conversation_id = ${activeConvId}::uuid
    `;
    const nextSeq = (Number(seqResult[0]?.max_seq) || 0) + 1;

    // 5. Persist user message BEFORE calling Python — message is never lost.
    // A retry reuses the existing user message instead of duplicating the turn.
    if (!reuseUserMessage) {
      const userMsgId     = uuidv4();
      const userContent   = JSON.stringify({ text: message });
      await prisma.$executeRaw`
        INSERT INTO conversation_messages (
          id, conversation_id, organization_id, user_id,
          role, content, sequence_number, correlation_id, has_error
        ) VALUES (
          ${userMsgId}::uuid, ${activeConvId}::uuid, ${org.id}::uuid, ${req.user.id}::uuid,
          'user', ${userContent}::jsonb, ${nextSeq}, ${correlationId}::uuid, false
        )
      `;
    }
    const revSequence = reuseUserMessage ? nextSeq : nextSeq + 1;

    const merchantContext = await require('../services/revMerchantContext').buildMerchantContext(prisma, org.id);
    const conversationContext = await _loadConversationContext(activeConvId, org.id);

    // 6. Call Python via mlService
    const mlResult = await mlService.orchestrate({
      organizationId: org.id,
      userId:         req.user.id,
      message: intelligenceMessage,
      contextPayload: {
        merchant_context: merchantContext,
        conversation_context: conversationContext,
        _node_owns_chat_persistence: true,
      },
      conversationId: activeConvId,
      correlationId,
      imageBase64,
      imageMediaType,
    });

    // 7. Handle Python failure — persist failed Rev message so history is intact
    if (!mlResult.success) {
      const failedMsgId = uuidv4();
      const failedContent = JSON.stringify({ error: true });
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
      await prisma.$executeRaw`
        UPDATE conversations
        SET last_activity_at = NOW(), message_count = message_count + ${reuseUserMessage ? 0 : 1}, updated_at = NOW()
        WHERE id = ${activeConvId}::uuid
      `;

      logger.warn('rev_chat_intelligence_failed', {
        correlationId, orgId: org.id,
        errorCode: mlResult.error.code,
        latencyMs: Date.now() - startTime,
      });

      return res.status(503).json({
        success: false,
        conversation_id: activeConvId,
        error: mlResult.error,
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
      };
    } else {
      // Full 6-part analysis
      revContent = {
        response_type: 'analysis',
        situation:      revData.situation,
        insight:        revData.insight,
        implication:    revData.implication,
        recommendation: revData.recommendation,
        confidence: {
          score: revData.confidence_score ?? 0.7,
          basis: revData.confidence_basis || '',
        },
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
        specialists:    mlResult.data?.specialists    || [],
        read_only:      mlResult.data?.read_only     ?? true,
        response_mode:  mlResult.data?.response_mode || null,
        mode_reason:    mlResult.data?.mode_reason   || null,
        understanding:  mlResult.data?.understanding || null,
      };
    }

    const revContentStr   = JSON.stringify(revContent);
    const agentNameStr    = (revData.agents_used || []).join(',');
    const confidenceScore = revData.confidence_score ?? null;

    await prisma.$executeRaw`
      INSERT INTO conversation_messages (
        id, conversation_id, organization_id, user_id,
        role, content, sequence_number,
        agent_name, model_name, model_provider,
        correlation_id, confidence_score, has_error
      ) VALUES (
        ${revMsgId}::uuid, ${activeConvId}::uuid, ${org.id}::uuid, ${req.user.id}::uuid,
        'rev', ${revContentStr}::jsonb, ${revSequence},
        ${agentNameStr}, 'claude-sonnet-4-6', 'anthropic',
        ${correlationId}::uuid, ${confidenceScore}, false
      )
    `;

    // Generate intelligent title from first meaningful user message
    const titleHint = _generateTitle(message);
    await prisma.$executeRaw`
      UPDATE conversations
      SET
        last_activity_at = NOW(),
        message_count    = message_count + ${reuseUserMessage ? 1 : 2},
        title            = COALESCE(title, ${titleHint}),
        updated_at       = NOW()
      WHERE id = ${activeConvId}::uuid
    `;

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
      specialists:     mlResult.data?.specialists    || [],
      read_only:       mlResult.data?.read_only ?? true,
      meta: {
        correlation_id:             correlationId,
        business_state_age_minutes: revData.business_state_age_minutes,
        agents_used:                revData.agents_used || [],
        latency_ms:                 latencyMs,
      },
    });

  } catch (error) {
    next(error);
  }
};

// ── GET /api/v1/rev/conversations ─────────────────────────────────────────────

exports.getConversations = async (req, res, next) => {
  try {
    const org    = await getAuthenticatedOrg(req.user.id, req.user.tenantId);
    const limit  = Math.min(parseInt(req.query.limit  || '20', 10), 50);
    const offset = Math.max(parseInt(req.query.offset || '0',  10), 0);
    // Conversation search is always scoped to the authenticated organization.
    // Wildcards are escaped so a search term cannot broaden the tenant filter.
    const rawSearch = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
    const search = rawSearch ? `%${rawSearch.replace(/([%_\\])/g, '\\$1')}%` : null;

    const conversations = search
      ? await prisma.$queryRaw`
          SELECT id, title, status, message_count, last_activity_at, created_at
          FROM conversations c
          WHERE organization_id = ${org.id}::uuid
            AND status = 'active'
            AND (
              COALESCE(title, '') ILIKE ${search}
              OR EXISTS (
                SELECT 1 FROM conversation_messages cm
                WHERE cm.conversation_id = c.id
                  AND cm.organization_id = ${org.id}::uuid
                  AND cm.content::text ILIKE ${search}
              )
            )
          ORDER BY last_activity_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `
      : await prisma.$queryRaw`
          SELECT id, title, status, message_count, last_activity_at, created_at
          FROM conversations
          WHERE organization_id = ${org.id}::uuid
            AND status = 'active'
          ORDER BY last_activity_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;

    return res.status(200).json({
      success: true,
      data: conversations,
      pagination: { limit, offset },
      search: rawSearch || null,
    });
  } catch (error) {
    next(error);
  }
};

// ── GET /api/v1/rev/conversation/:id ─────────────────────────────────────────

exports.getConversation = async (req, res, next) => {
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

    return res.status(200).json({
      success: true,
      data: {
        conversation: conv,
        messages,
        pagination: { limit, offset },
      },
    });
  } catch (error) {
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
      UPDATE conversations SET status = 'deleted', updated_at = NOW()
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
      select: { id: true, type: true, severity: true, status: true, title: true,
        description: true, evidence: true, action: true, detected_at: true },
    });
    if (!finding) return res.status(404).json({ success: false, error: { code: 'FINDING_NOT_FOUND' } });
    return res.status(200).json({ success: true, data: { finding } });
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
    response_type: data?.response_type || 'analysis',
    text: data?.text || '',
    response: data?.response || null,
    evidence,
    facts: Array.isArray(data?.facts) ? data.facts.slice(0, 40) : [],
    comparison_facts: Array.isArray(data?.comparison_facts) ? data.comparison_facts.slice(0, 20) : [],
    hypotheses: Array.isArray(data?.hypotheses) ? data.hypotheses.slice(0, 10) : [],
    unknowns: Array.isArray(data?.unknowns) ? data.unknowns.slice(0, 12) : [],
    recommendations: Array.isArray(data?.recommendations) ? data.recommendations.slice(0, 12) : [],
    investigation: data?.investigation || null,
    specialists: Array.isArray(data?.specialists) ? data.specialists : [],
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
  };
}

// Exported for contract tests only.
exports._boundedResultForPersistence = _boundedResultForPersistence;

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
  await prisma.$executeRaw`
    INSERT INTO conversation_messages (
      id, conversation_id, organization_id, user_id, role, content,
      sequence_number, agent_name, model_name, model_provider, correlation_id,
      confidence_score, has_error, error_code, error_message, tool_calls,
      tool_results, latency_ms, orchestrator_mode, confidence_basis
    ) VALUES (
      ${messageId}::uuid, ${conversationId}::uuid, ${organizationId}::uuid,
      ${userId}::uuid, 'rev', ${contentStr}::jsonb, ${sequenceNumber},
      ${(agentsUsed || []).join(',')}, 'claude-sonnet-4-6', 'anthropic',
      ${correlationId}::uuid, ${confidenceScore}, ${hasError}, ${errorCode},
      ${errorMessage}, ${steps}::jsonb, ${toolStatuses}::jsonb, ${latencyMs},
      ${investigation?.intent || null}, ${content?.response?.confidence?.basis || null}
    )
  `;
  return messageId;
}

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

async function _loadConversationContext(conversationId, organizationId) {
  try {
    const rows = await prisma.$queryRaw`
      SELECT summary, context_window
      FROM conversations
      WHERE id = ${conversationId}::uuid
        AND organization_id = ${organizationId}::uuid
      LIMIT 1
    `;
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
      return { summary: context.summary, context_window: null };
    }
    return context;
  } catch (error) {
    logger.warn('rev_conversation_context_unavailable', { errorType: error.name });
    return { summary: null, context_window: null };
  }
}

function _sseWriter(res) {
  let closed = false;
  return {
    send(event, data) {
      if (closed || res.writableEnded) return false;
      try {
        res.write(formatSseFrame(event, data));
        return true;
      } catch {
        closed = true;
        return false;
      }
    },
    end() {
      if (closed) return;
      closed = true;
      try { res.end(); } catch { /* noop */ }
    },
    get closed() { return closed; },
  };
}

function _validateChatPayload(body) {
  const rawMessage = body?.message;
  if (!rawMessage) {
    return { error: { status: 400, code: 'VALIDATION_ERROR', message: 'Message is required.' } };
  }
  const message = sanitiseMessage(rawMessage);
  if (!message) {
    return { error: { status: 400, code: 'VALIDATION_ERROR', message: 'Message must not be empty.' } };
  }
  if (body?.execute === true) {
    return {
      error: {
        status: 403, code: 'READ_ONLY',
        message: 'Rev Intelligence is read-only. It cannot execute store changes.',
      },
    };
  }
  return { message };
}

async function _resolveFindingMessage(req, org, message) {
  if (req.body?.finding_id == null) return { message };
  const { resolveFindingChatContext } = require('../services/findingChatContext');
  const resolved = await resolveFindingChatContext(prisma, org.id, req.body.finding_id, message);
  if (resolved.status === 'invalid') return { error: { status: 400, code: 'INVALID_FINDING_ID' } };
  if (resolved.status === 'not_found') return { error: { status: 404, code: 'FINDING_NOT_FOUND' } };
  if (resolved.status !== 'ok') return { error: { status: 409, code: 'FINDING_EVIDENCE_UNVERIFIED' } };
  return { message: resolved.context };
}

// ── POST /api/v1/rev/stream ───────────────────────────────────────────────────
exports.chatStream = async (req, res, next) => {
  const correlationId = uuidv4();
  const startedAt = Date.now();
  let sse = null;
  let activeConvId = null;
  let sequenceNumber = null;
  let finished = false;

  try {
    const validated = _validateChatPayload(req.body);
    if (validated.error) {
      return res.status(validated.error.status).json({
        success: false, error: { code: validated.error.code, message: validated.error.message },
      });
    }
    const org = await getAuthenticatedOrg(req.user.id, req.user.tenantId);
    const finding = await _resolveFindingMessage(req, org, validated.message);
    if (finding.error) {
      return res.status(finding.error.status).json({ success: false, error: finding.error });
    }
    const intelligenceMessage = finding.message;

    const requestedConversationId = req.body?.conversation_id || null;
    const reuseUserMessage = req.body?.reuse_user_message === true;
    if (requestedConversationId) {
      await verifyConversationOwnership(requestedConversationId, org.id);
      activeConvId = requestedConversationId;
    } else {
      activeConvId = uuidv4();
      await prisma.$executeRaw`
        INSERT INTO conversations (id, organization_id, user_id, status, message_count, last_activity_at)
        VALUES (${activeConvId}::uuid, ${org.id}::uuid, ${req.user.id}::uuid, 'active', 0, NOW())
      `;
    }

    const seqResult = await prisma.$queryRaw`
      SELECT COALESCE(MAX(sequence_number), 0)::int AS max_seq
      FROM conversation_messages
      WHERE conversation_id = ${activeConvId}::uuid
    `;
    const nextSeq = (Number(seqResult[0]?.max_seq) || 0) + 1;
    sequenceNumber = nextSeq;

    if (!reuseUserMessage) {
      await prisma.$executeRaw`
        INSERT INTO conversation_messages (
          id, conversation_id, organization_id, user_id,
          role, content, sequence_number, correlation_id, has_error
        ) VALUES (
          ${uuidv4()}::uuid, ${activeConvId}::uuid, ${org.id}::uuid, ${req.user.id}::uuid,
          'user', ${JSON.stringify({ text: validated.message })}::jsonb, ${nextSeq},
          ${correlationId}::uuid, false
        )
      `;
    }
    const revSequence = reuseUserMessage ? nextSeq : nextSeq + 1;

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
      read_only: true,
      started_at: new Date().toISOString(),
    });

    const merchantContext = await require('../services/revMerchantContext')
      .buildMerchantContext(prisma, org.id);
    const conversationContext = await _loadConversationContext(activeConvId, org.id);

    const streamed = await mlService.streamInvestigation({
      organizationId: org.id,
      userId: req.user.id,
      message: intelligenceMessage,
      conversationId: activeConvId,
      correlationId,
      contextPayload: {
        merchant_context: merchantContext,
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
      const content = _boundedResultForPersistence(data);
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
      await _touchConversation(activeConvId, {
        titleHint: _generateTitle(validated.message),
        increment: reuseUserMessage ? 1 : 2,
      });
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
        correlationId, orgId: org.id, conversationId: activeConvId,
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
    await _insertRevMessage({
      organizationId: org.id, userId: req.user.id, conversationId: activeConvId,
      sequenceNumber: revSequence, correlationId,
      content: { response_type: 'error', error: true, read_only: true },
      hasError: true, errorCode: error.code, errorMessage: error.message,
      latencyMs: Date.now() - startedAt,
    });
    await _touchConversation(activeConvId, {
      titleHint: _generateTitle(validated.message), increment: reuseUserMessage ? 1 : 2,
    });
    finished = true;
    sse.send('error', {
      conversation_id: activeConvId,
      code: error.code,
      message: error.message,
      retryable: true,
    });
    sse.end();
    logger.warn('rev_stream_failed', {
      correlationId, orgId: org.id, errorCode: error.code,
      latencyMs: Date.now() - startedAt,
    });
    return undefined;
  } catch (error) {
    if (sse) {
      finished = true;
      sse.send('error', {
        conversation_id: activeConvId,
        code: 'STREAM_FAILED',
        message: 'Rev could not complete this response. Please retry.',
        retryable: true,
      });
      sse.end();
      logger.error('rev_stream_unhandled', {
        correlationId, errorType: error.name, statusCode: error.statusCode,
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
