-- C2 rollback: drop the sequence backstop.
--
-- The shipped code keeps working without this index: the per-conversation
-- advisory lock still serializes all cooperating writers. Only the
-- non-cooperating-writer backstop (dormant legacy Python path, manual SQL)
-- is lost until the index is re-created with migration.sql.
--
-- The repair is forward-only and is NOT rolled back: renumbered rows keep
-- their repaired numbers, which remain valid with or without this index.
--
-- Both shapes are dropped: production carries a plain unique index (from
-- migration.sql), while schema-bootstrapped databases carry a unique
-- constraint of the same name. Each statement is a no-op where its shape is
-- absent.
ALTER TABLE conversation_messages DROP CONSTRAINT IF EXISTS uq_conversation_message_sequence;
DROP INDEX IF EXISTS uq_conversation_message_sequence;
