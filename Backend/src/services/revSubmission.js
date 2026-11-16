const { v4: uuidv4, v5: uuidv5 } = require('uuid');

const MAX_QUESTION_LENGTH = 2000;
const REQUEST_CONVERSATION_NAMESPACE = '6f35db54-8925-4e0f-9ef4-2cf8db85f97b';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function submissionError(status, code, message) {
  const error = new Error(message);
  error.statusCode = status;
  error.code = code;
  return error;
}

/**
 * Validate the transport contract before any persistence or model work. The
 * legacy sanitizer remains for defence in depth, but oversize input is now
 * rejected rather than silently changed into a different merchant question.
 */
function validateSubmission(body) {
  if (typeof body?.message !== 'string') {
    throw submissionError(400, 'VALIDATION_ERROR', 'Message is required.');
  }
  const message = body.message.replace(/\0/g, '').trim();
  if (!message) throw submissionError(400, 'VALIDATION_ERROR', 'Message must not be empty.');
  if (message.length > MAX_QUESTION_LENGTH) {
    throw submissionError(400, 'MESSAGE_TOO_LONG', `Message must be ${MAX_QUESTION_LENGTH} characters or fewer.`);
  }
  if (body?.execute === true) {
    throw submissionError(403, 'READ_ONLY', 'Rev Intelligence is read-only. It cannot execute store changes.');
  }
  const requestId = body?.request_id == null ? uuidv4() : String(body.request_id).trim().toLowerCase();
  if (!UUID.test(requestId)) {
    throw submissionError(400, 'INVALID_REQUEST_ID', 'request_id must be a valid UUID.');
  }
  return { message, requestId };
}

function userText(content) {
  if (content && typeof content === 'object' && !Array.isArray(content) && typeof content.text === 'string') return content.text;
  if (typeof content === 'string') {
    try { return userText(JSON.parse(content)); } catch { return content; }
  }
  return null;
}

async function findAcceptedSubmission(prisma, organizationId, requestId) {
  const rows = await prisma.$queryRaw`
    SELECT u.conversation_id, u.content AS user_content,
           r.id AS rev_id, r.content AS rev_content, r.has_error,
           r.error_code, r.error_message, r.created_at AS rev_created_at
    FROM conversation_messages u
    LEFT JOIN conversation_messages r
      ON r.organization_id = u.organization_id
     AND r.conversation_id = u.conversation_id
     AND r.correlation_id = u.correlation_id
     AND r.role = 'rev'
    WHERE u.organization_id = ${organizationId}::uuid
      AND u.correlation_id = ${requestId}::uuid
      AND u.role = 'user'
    ORDER BY u.created_at DESC, r.created_at DESC NULLS LAST
    LIMIT 1
  `;
  return rows?.[0] || null;
}

function ensureSameSubmission(accepted, message, requestedConversationId) {
  if (userText(accepted.user_content) !== message) {
    throw submissionError(409, 'REQUEST_ID_REUSED', 'This request identifier was already used for a different question.');
  }
  if (requestedConversationId && String(requestedConversationId) !== String(accepted.conversation_id)) {
    throw submissionError(409, 'REQUEST_ID_REUSED', 'This request identifier belongs to a different conversation.');
  }
}

/**
 * Persist acceptance exactly once for an organization/request pair. The unique
 * user-message key is the race-safe acceptance marker: a concurrent loser
 * never starts another investigation. New conversation ids are deterministically
 * derived by the server from the request id, so a retry before the first meta
 * frame cannot create a second empty conversation.
 */
async function acceptSubmission({ prisma, organizationId, userId, message, requestId, requestedConversationId = null }) {
  const existing = await findAcceptedSubmission(prisma, organizationId, requestId);
  if (existing) {
    ensureSameSubmission(existing, message, requestedConversationId);
    return { duplicate: true, accepted: existing, conversationId: existing.conversation_id };
  }

  // The conversation row and its first accepted user message form one unit of
  // persistence. Keeping both writes in the same transaction prevents a failed
  // second write (or a process interruption between writes) from leaving an
  // active, restorable-looking conversation with no messages.
  const { conversationId, inserted } = await prisma.$transaction(async (tx) => {
    let acceptedConversationId = requestedConversationId;
    if (acceptedConversationId) {
      const owned = await tx.$queryRaw`
        SELECT organization_id FROM conversations WHERE id = ${acceptedConversationId}::uuid LIMIT 1
      `;
      if (!owned?.[0]) throw submissionError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found.');
      if (String(owned[0].organization_id) !== String(organizationId)) {
        throw submissionError(403, 'FORBIDDEN', 'Not authorised to access this conversation.');
      }
    } else {
      acceptedConversationId = uuidv5(requestId, REQUEST_CONVERSATION_NAMESPACE);
      await tx.$executeRaw`
        INSERT INTO conversations (id, organization_id, user_id, status, message_count, last_activity_at)
        VALUES (${acceptedConversationId}::uuid, ${organizationId}::uuid, ${userId}::uuid, 'active', 0, NOW())
        ON CONFLICT (id) DO NOTHING
      `;
    }

    const inserted = await tx.$executeRaw`
      INSERT INTO conversation_messages (
        id, conversation_id, organization_id, user_id,
        role, content, sequence_number, correlation_id, has_error
      )
      SELECT ${uuidv4()}::uuid, ${acceptedConversationId}::uuid, ${organizationId}::uuid, ${userId}::uuid,
             'user', ${JSON.stringify({ text: message })}::jsonb,
             COALESCE(MAX(sequence_number), 0) + 1, ${requestId}::uuid, false
      FROM conversation_messages
      WHERE conversation_id = ${acceptedConversationId}::uuid
      ON CONFLICT (organization_id, conversation_id, role, correlation_id) DO NOTHING
    `;
    return { conversationId: acceptedConversationId, inserted };
  });
  if (Number(inserted) === 0) {
    const accepted = await findAcceptedSubmission(prisma, organizationId, requestId);
    if (!accepted) throw submissionError(409, 'SUBMISSION_NOT_ACCEPTED', 'The question was not accepted. Please retry.');
    ensureSameSubmission(accepted, message, requestedConversationId);
    return { duplicate: true, accepted, conversationId: accepted.conversation_id };
  }
  return { duplicate: false, accepted: null, conversationId };
}

function replayBody(accepted, requestId) {
  const content = accepted.rev_content && typeof accepted.rev_content === 'object' && !Array.isArray(accepted.rev_content)
    ? accepted.rev_content : {};
  return {
    conversationId: accepted.conversation_id,
    requestId,
    messageId: accepted.rev_id || null,
    completed: Boolean(accepted.rev_id),
    failed: Boolean(accepted.rev_id && accepted.has_error),
    content,
    errorCode: accepted.error_code || null,
    errorMessage: accepted.error_message || null,
  };
}

module.exports = {
  MAX_QUESTION_LENGTH,
  REQUEST_CONVERSATION_NAMESPACE,
  validateSubmission,
  findAcceptedSubmission,
  acceptSubmission,
  replayBody,
  submissionError,
};
