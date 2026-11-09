-- Task 223: one accepted user/Rev message per request within a conversation.
-- Existing correlations are UUIDs and role-separated; retry attempts use new
-- correlations, while a repeated transport request reuses the original one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_message_submission
ON conversation_messages (organization_id, conversation_id, role, correlation_id);
