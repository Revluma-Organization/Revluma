-- Covering indexes for every foreign key the Supabase performance advisor
-- flagged (25 of them, verified against pg_index on 2026-11-04: none of these
-- columns is the prefix of an existing index, so none is redundant).
--
-- Why FK indexes matter here even on small tables:
--   * Postgres needs them for cascade deletes/updates on the referenced row
--     (a missing index turns every parent delete into a full child scan).
--   * The hot access patterns already query several of these columns:
--     notifications per user, alert_queue per business_state (scheduler),
--     conversation history per conversation/user, churn and sensitivity
--     training observations per organization (hourly workers), orders per
--     abandoned_cart (recovery worker), merchant memories per user.
--   * Write cost is one small btree per column on low-frequency analytical
--     tables; the free-tier instance stays within budget.
--
-- All statements are IF NOT EXISTS: idempotent, safe to replay.

CREATE INDEX IF NOT EXISTS "alert_queue_business_state_id_idx" ON "alert_queue"("business_state_id");
CREATE INDEX IF NOT EXISTS "alert_queue_business_state_baselinesId_idx" ON "alert_queue"("business_state_baselinesId");
CREATE INDEX IF NOT EXISTS "notifications_user_id_idx" ON "notifications"("user_id");
CREATE INDEX IF NOT EXISTS "conversation_messages_business_state_id_idx" ON "conversation_messages"("business_state_id");
CREATE INDEX IF NOT EXISTS "conversation_messages_user_id_idx" ON "conversation_messages"("user_id");
CREATE INDEX IF NOT EXISTS "conversations_user_id_idx" ON "conversations"("user_id");
CREATE INDEX IF NOT EXISTS "churn_training_observations_organization_id_idx" ON "churn_training_observations"("organization_id");
CREATE INDEX IF NOT EXISTS "abandoned_carts_customer_id_idx" ON "abandoned_carts"("customer_id");
CREATE INDEX IF NOT EXISTS "abandoned_carts_recovery_sequence_id_idx" ON "abandoned_carts"("recovery_sequence_id");
CREATE INDEX IF NOT EXISTS "orders_attribution_sequence_id_idx" ON "orders"("attribution_sequence_id");
CREATE INDEX IF NOT EXISTS "orders_abandoned_cart_id_idx" ON "orders"("abandoned_cart_id");
CREATE INDEX IF NOT EXISTS "audit_logs_recommendation_id_idx" ON "audit_logs"("recommendation_id");
CREATE INDEX IF NOT EXISTS "audit_logs_user_id_idx" ON "audit_logs"("user_id");
CREATE INDEX IF NOT EXISTS "feature_jobs_event_id_idx" ON "feature_jobs"("event_id");
CREATE INDEX IF NOT EXISTS "merchant_memories_user_id_idx" ON "merchant_memories"("user_id");
CREATE INDEX IF NOT EXISTS "merchant_memories_source_conv_id_idx" ON "merchant_memories"("source_conv_id");
CREATE INDEX IF NOT EXISTS "merchant_memory_embeddings_user_id_idx" ON "merchant_memory_embeddings"("user_id");
CREATE INDEX IF NOT EXISTS "model_feedback_queue_recommendation_outcome_id_idx" ON "model_feedback_queue"("recommendation_outcome_id");
CREATE INDEX IF NOT EXISTS "recommendations_source_state_id_idx" ON "recommendations"("source_state_id");
CREATE INDEX IF NOT EXISTS "recommendations_message_id_idx" ON "recommendations"("message_id");
CREATE INDEX IF NOT EXISTS "recommendations_user_id_idx" ON "recommendations"("user_id");
CREATE INDEX IF NOT EXISTS "sensitivity_training_observations_organization_id_idx" ON "sensitivity_training_observations"("organization_id");
CREATE INDEX IF NOT EXISTS "sensitivity_training_observations_abandoned_cart_id_idx" ON "sensitivity_training_observations"("abandoned_cart_id");
CREATE INDEX IF NOT EXISTS "sequences_store_id_idx" ON "sequences"("store_id");
CREATE INDEX IF NOT EXISTS "strategic_memory_recommendation_id_idx" ON "strategic_memory"("recommendation_id");
