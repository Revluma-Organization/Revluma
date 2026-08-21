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

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getAuthenticatedOrg(userId) {
  const org = await prisma.organizations.findFirst({
    where:  { owner_id: userId },
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
    const conversationId = req.body?.conversation_id || null;

    // 2. Resolve org from JWT — never from body
    const org = await getAuthenticatedOrg(req.user.id);

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

    // 5. Persist user message BEFORE calling Python — message is never lost
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

    // 6. Call Python via mlService
    const mlResult = await mlService.orchestrate({
      organizationId: org.id,
      userId:         req.user.id,
      message,
      conversationId: activeConvId,
      correlationId,
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
          'rev', ${failedContent}::jsonb, ${nextSeq + 1}, ${correlationId}::uuid,
          true, ${mlResult.error.code}, ${mlResult.error.message}
        )
      `;
      await prisma.$executeRaw`
        UPDATE conversations
        SET last_activity_at = NOW(), message_count = message_count + 1, updated_at = NOW()
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

    const revData = mlResult.data;
    const responseType = revData.response_type || 'analysis';

    // 8. Persist Rev response — structure depends on response type
    const revMsgId = uuidv4();
    let revContent;

    if (responseType !== 'analysis') {
      // Conversational, capability, clarification, error — just text
      revContent = {
        response_type: responseType,
        text: revData.text || '',
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
        'rev', ${revContentStr}::jsonb, ${nextSeq + 1},
        ${agentNameStr}, 'claude-sonnet-4-6', 'anthropic',
        ${correlationId}::uuid, ${confidenceScore}, false
      )
    `;

    // Update conversation with title + activity
    const titleHint = message.slice(0, 80) + (message.length > 80 ? '…' : '');
    await prisma.$executeRaw`
      UPDATE conversations
      SET
        last_activity_at = NOW(),
        message_count    = message_count + 2,
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
      response:        revContent,
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
    const org    = await getAuthenticatedOrg(req.user.id);
    const limit  = Math.min(parseInt(req.query.limit  || '20', 10), 50);
    const offset = Math.max(parseInt(req.query.offset || '0',  10), 0);

    const conversations = await prisma.$queryRaw`
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

    const org  = await getAuthenticatedOrg(req.user.id);
    const conv = await verifyConversationOwnership(id, org.id);

    const limit  = Math.min(parseInt(req.query.limit  || '50', 10), 100);
    const offset = Math.max(parseInt(req.query.offset || '0',  10), 0);

    const messages = await prisma.$queryRaw`
      SELECT
        id, role, content, sequence_number,
        agent_name, confidence_score, has_error, error_code, error_message,
        created_at
      FROM conversation_messages
      WHERE conversation_id = ${id}::uuid
      ORDER BY sequence_number ASC
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

    const org          = await getAuthenticatedOrg(req.user.id);
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