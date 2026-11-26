-- Sign in with Apple and USD-only billing.
-- Idempotent: one new nullable column, one unique index, new column defaults,
-- and a one-off tidy of open naira billing rows. Completed payments are never
-- rewritten, so billing history stays truthful.

-- Apple's stable user identifier ("sub" claim). Mirrors users_google_id_key.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "apple_id" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "users_apple_id_key" ON "users" ("apple_id");

-- Every plan is charged in US dollars. These tables were created outside the
-- migration history, so only touch them where they exist.
DO $$
BEGIN
  IF to_regclass('public.subscriptions') IS NOT NULL THEN
    ALTER TABLE "subscriptions" ALTER COLUMN "currency" SET DEFAULT 'USD';
    -- No money has moved on a trial or an unpaid subscription, so its currency
    -- is only a label. Relabel it so a later paid plan is billed in dollars.
    UPDATE "subscriptions" SET "currency" = 'USD'
     WHERE "currency" = 'NGN' AND "status" IN ('trialing', 'pending');
  END IF;
  IF to_regclass('public.payment_transactions') IS NOT NULL THEN
    ALTER TABLE "payment_transactions" ALTER COLUMN "currency" SET DEFAULT 'USD';
    -- Paystack no longer charges in naira, so an open naira checkout can never
    -- complete (verification would reject it on currency anyway). Close it
    -- rather than relabel it: its amount was never a dollar amount.
    UPDATE "payment_transactions"
       SET "status" = 'failed', "paystack_event" = 'superseded_ngn_checkout'
     WHERE "currency" = 'NGN' AND "status" = 'pending';
  END IF;
END $$;
