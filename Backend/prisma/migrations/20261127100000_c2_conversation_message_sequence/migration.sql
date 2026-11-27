-- C2: exactly one message per (conversation_id, sequence_number).
--
-- PRECONDITION (reviewed and approved separately): run repair.sql from this
-- directory until its verification query reports zero tied groups. Applying
-- this index while ties remain fails.
--
-- This statement is idempotent (IF NOT EXISTS): safe to re-run, and a no-op
-- where the release-candidate bootstrap already created the matching unique
-- constraint from the Prisma schema.
CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_message_sequence
  ON conversation_messages (conversation_id, sequence_number);
