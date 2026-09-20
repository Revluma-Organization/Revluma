ALTER TABLE "abandoned_carts"
  ADD COLUMN IF NOT EXISTS "pss_score" INTEGER,
  ADD COLUMN IF NOT EXISTS "css_score" INTEGER,
  ADD COLUMN IF NOT EXISTS "tss_score" INTEGER,
  ADD COLUMN IF NOT EXISTS "recovery_action" TEXT,
  ADD COLUMN IF NOT EXISTS "sensitivity_model_version" TEXT,
  ADD COLUMN IF NOT EXISTS "sensitivity_scored_at" TIMESTAMPTZ(6);

ALTER TABLE "ml_session_features"
  ADD COLUMN IF NOT EXISTS "cart_item_add_count" INTEGER,
  ADD COLUMN IF NOT EXISTS "cart_item_remove_count" INTEGER,
  ADD COLUMN IF NOT EXISTS "coupon_field_visited" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "failed_payment_count" INTEGER;

CREATE TABLE IF NOT EXISTS "churn_training_observations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "prediction_at" TIMESTAMPTZ(6) NOT NULL,
  "observation_due_at" TIMESTAMPTZ(6) NOT NULL,
  "finalized_at" TIMESTAMPTZ(6),
  "next_completed_order_at" TIMESTAMPTZ(6),
  "observed_churn_tier" TEXT,
  "feature_snapshot" JSONB NOT NULL,
  "label_policy_version" TEXT NOT NULL,
  CONSTRAINT "churn_training_observations_pkey" PRIMARY KEY ("id"),
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE,
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "churn_training_customer_prediction_key"
  ON "churn_training_observations" ("customer_id", "prediction_at");
CREATE INDEX IF NOT EXISTS "churn_training_finalized_tier_idx"
  ON "churn_training_observations" ("finalized_at", "observed_churn_tier");
CREATE INDEX IF NOT EXISTS "churn_training_store_due_idx"
  ON "churn_training_observations" ("store_id", "observation_due_at");

CREATE TABLE IF NOT EXISTS "sensitivity_training_observations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "abandoned_cart_id" UUID,
  "decision_at" TIMESTAMPTZ(6) NOT NULL,
  "observation_due_at" TIMESTAMPTZ(6) NOT NULL,
  "finalized_at" TIMESTAMPTZ(6),
  "pss_label" BOOLEAN,
  "css_label" BOOLEAN,
  "tss_label" BOOLEAN,
  "label_policy_version" TEXT NOT NULL,
  "feature_snapshot" JSONB NOT NULL,
  CONSTRAINT "sensitivity_training_observations_pkey" PRIMARY KEY ("id"),
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE,
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE,
  FOREIGN KEY ("abandoned_cart_id") REFERENCES "abandoned_carts"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "sensitivity_training_customer_decision_key"
  ON "sensitivity_training_observations" ("customer_id", "decision_at");
CREATE INDEX IF NOT EXISTS "sensitivity_training_store_due_idx"
  ON "sensitivity_training_observations" ("store_id", "observation_due_at");
CREATE INDEX IF NOT EXISTS "sensitivity_training_finalized_idx"
  ON "sensitivity_training_observations" ("finalized_at");