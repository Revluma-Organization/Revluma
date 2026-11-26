'use strict';

/**
 * C2 single-writer: every conversation_messages sequence number is allocated
 * inside the inserting transaction, under a per-conversation advisory lock,
 * from MAX(sequence_number)+1.
 *
 * Before C2, three independent MAX+1 allocations raced with no lock and no
 * unique backstop (user insert in revSubmission, chat rev insert and stream
 * rev insert in revController): 109 tied (conversation, sequence) pairs
 * org-wide, all exactly pairs. The lock serializes cooperating writers; the
 * UNIQUE migration (prepared alongside, NOT applied) backstops the rest; the
 * bounded retry below covers a residual 23505 from a non-cooperating writer
 * (the dormant legacy Python persist path, manual SQL) by re-running the
 * whole allocating transaction.
 *
 * Lock form follows the repo precedent (upsertAbandonedCart /
 * commerceWebhookService): transaction-scoped advisory lock, two-key namespaced.
 */

const LOCK_NAMESPACE = 'rev_conversation_sequence';
const MAX_ALLOCATION_ATTEMPTS = 3;

async function acquireConversationWriteLock(tx, conversationId) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${LOCK_NAMESPACE}), hashtext(${String(conversationId)}))`;
}

function isUniqueViolation(error) {
  if (!error) return false;
  if (error.code === 'P2002' || error.code === '23505') return true;
  const message = String(error.message || '');
  return message.includes('23505') || /duplicate key|unique constraint/i.test(message);
}

async function withSequenceAllocationRetry(operation) {
  let attempt = 0;
  for (;;) {
    try {
      return await operation();
    } catch (error) {
      attempt += 1;
      if (!isUniqueViolation(error) || attempt >= MAX_ALLOCATION_ATTEMPTS) throw error;
    }
  }
}

module.exports = {
  LOCK_NAMESPACE,
  MAX_ALLOCATION_ATTEMPTS,
  acquireConversationWriteLock,
  isUniqueViolation,
  withSequenceAllocationRetry,
};
