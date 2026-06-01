-- ====================================================================
-- REVLUMA PARTNER ECOSYSTEM (By Luminor Terminal)
-- Enterprise-Grade Recurring First 12 Months Subscription & Affiliate Commission Database Migration
-- Target Platform: PostgreSQL / Supabase Relational Infrastructure
-- ====================================================================

BEGIN;

-- Ensure required extension exists
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ====================================================================
-- 1. ENUM TYPE DECLARATIONS
-- ====================================================================

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payout_status') THEN
        CREATE TYPE payout_status AS ENUM ('pending', 'approved', 'processing', 'completed', 'rejected', 'fraud_hold');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payout_method') THEN
        CREATE TYPE payout_method AS ENUM ('paypal', 'bank_wire', 'stripe_connect', 'wise');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_interval') THEN
        CREATE TYPE billing_interval AS ENUM ('monthly', 'yearly');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'webhook_status') THEN
        CREATE TYPE webhook_status AS ENUM ('received', 'processed', 'failed', 'invalid_signature');
    END IF;
END $$;

-- ====================================================================
-- 2. CORE DATABASE TABLES
-- ====================================================================

-- 2.1 REFERRAL TRACKING (Enriched Referral Attribution)
CREATE TABLE IF NOT EXISTS public.referral_attribution (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    partner_id TEXT REFERENCES public.affiliate_profiles(id) ON DELETE CASCADE,
    referred_user_id TEXT UNIQUE NOT NULL,
    email_masked TEXT NOT NULL,
    affiliate_code TEXT NOT NULL,
    campaign_tag TEXT,
    attribution_window_ends TIMESTAMP WITH TIME ZONE NOT NULL,
    first_seen_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    converted_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2.2 LEMON SQUEEZY SUBSCRIPTIONS (Referred Subscriptions Ledger)
CREATE TABLE IF NOT EXISTS public.customer_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lemon_squeezy_id TEXT UNIQUE NOT NULL,
    referral_id UUID REFERENCES public.referral_attribution(id) ON DELETE SET NULL,
    partner_id TEXT REFERENCES public.affiliate_profiles(id) ON DELETE SET NULL,
    customer_email TEXT NOT NULL,
    plan_name TEXT NOT NULL,
    status TEXT NOT NULL,
    billing_interval billing_interval NOT NULL DEFAULT 'monthly',
    amount_paid_cents INTEGER NOT NULL DEFAULT 0,
    subscription_created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    subscription_ends_at TIMESTAMP WITH TIME ZONE,
    trial_ends_at TIMESTAMP WITH TIME ZONE,
    churn_detected TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2.3 RECURRING FIRST 12 MONTHS COMMISSIONS ENGINE RECORDS
CREATE TABLE IF NOT EXISTS public.partner_commissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    partner_id TEXT REFERENCES public.affiliate_profiles(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES public.customer_subscriptions(id) ON DELETE SET NULL,
    referred_user_id TEXT NOT NULL,
    transaction_id TEXT UNIQUE,
    base_billing_amount_cents INTEGER NOT NULL,
    commission_rate NUMERIC(4,3) NOT NULL,
    commission_earned_cents INTEGER NOT NULL,
    is_recurring BOOLEAN DEFAULT TRUE,
    delay_payout_until TIMESTAMP WITH TIME ZONE NOT NULL,
    payout_status payout_status DEFAULT 'pending'::payout_status,
    ref_flagged BOOLEAN DEFAULT FALSE,
    flagged_reasons TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2.4 PAYOUT SETTLEMENT LEDGER
CREATE TABLE IF NOT EXISTS public.payout_settlements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    partner_id TEXT REFERENCES public.affiliate_profiles(id) ON DELETE CASCADE,
    amount_cents INTEGER NOT NULL,
    payout_gateway payout_method DEFAULT 'paypal'::payout_method,
    payout_recipient_account TEXT NOT NULL,
    status payout_status DEFAULT 'pending'::payout_status,
    cleared_at TIMESTAMP WITH TIME ZONE,
    payout_reference TEXT,
    admin_reviewer_id TEXT REFERENCES public.users(id),
    rejection_details TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2.5 WEBHOOK AUDIT SYSTEM
CREATE TABLE IF NOT EXISTS public.lemon_squeezy_webhooks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id TEXT UNIQUE,
    event_name TEXT NOT NULL,
    payload JSONB NOT NULL,
    status webhook_status DEFAULT 'received'::webhook_status,
    error_log TEXT,
    processed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2.6 ANTI-FRAUD AUDIT TELEMETRY LOGS
CREATE TABLE IF NOT EXISTS public.anti_fraud_audits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    partner_id TEXT REFERENCES public.affiliate_profiles(id),
    referral_id UUID REFERENCES public.referral_attribution(id),
    fraud_risk_score INTEGER NOT NULL DEFAULT 0,
    is_flagged BOOLEAN DEFAULT FALSE,
    reason TEXT NOT NULL,
    ip_geolocation_placeholder TEXT,
    fingerprint_hash_placeholder TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ====================================================================
-- 3. SPEED OPTIMIZED INDEX STRUCTURE
-- ====================================================================

CREATE INDEX IF NOT EXISTS idx_ref_attr_partner ON public.referral_attribution(partner_id);
CREATE INDEX IF NOT EXISTS idx_ref_attr_referred ON public.referral_attribution(referred_user_id);
CREATE INDEX IF NOT EXISTS idx_cust_sub_ls_id ON public.customer_subscriptions(lemon_squeezy_id);
CREATE INDEX IF NOT EXISTS idx_cust_sub_partner ON public.customer_subscriptions(partner_id);
CREATE INDEX IF NOT EXISTS idx_commissions_partner ON public.partner_commissions(partner_id);
CREATE INDEX IF NOT EXISTS idx_commissions_payout_status ON public.partner_commissions(payout_status);
CREATE INDEX IF NOT EXISTS idx_payout_set_partner ON public.payout_settlements(partner_id);
CREATE INDEX IF NOT EXISTS idx_payout_set_status ON public.payout_settlements(status);
CREATE INDEX IF NOT EXISTS idx_webhooks_event_name ON public.lemon_squeezy_webhooks(event_name);
CREATE INDEX IF NOT EXISTS idx_fraud_audits_partner ON public.anti_fraud_audits(partner_id);

-- ====================================================================
-- 4. ROW LEVEL SECURITY (RLS) POLICIES
-- ====================================================================

ALTER TABLE public.referral_attribution ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lemon_squeezy_webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.anti_fraud_audits ENABLE ROW LEVEL SECURITY;

-- 4.1 referral_attribution policies
CREATE POLICY "Users can select own referrals" ON public.referral_attribution
    FOR SELECT USING (auth.uid()::TEXT = partner_id);

CREATE POLICY "Admin full rights referral_attribution" ON public.referral_attribution
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid()::TEXT AND role = 'admin')
    );

-- 4.2 customer_subscriptions policies
CREATE POLICY "Users can select referred subscriptions" ON public.customer_subscriptions
    FOR SELECT USING (auth.uid()::TEXT = partner_id);

CREATE POLICY "Admin full rights customer_subscriptions" ON public.customer_subscriptions
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid()::TEXT AND role = 'admin')
    );

-- 4.3 partner_commissions policies
CREATE POLICY "Users can view own ledger balances" ON public.partner_commissions
    FOR SELECT USING (auth.uid()::TEXT = partner_id);

CREATE POLICY "Admin full rights partner_commissions" ON public.partner_commissions
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid()::TEXT AND role = 'admin')
    );

-- 4.4 payout_settlements policies
CREATE POLICY "Users can verify own payouts history" ON public.payout_settlements
    FOR SELECT USING (auth.uid()::TEXT = partner_id);

CREATE POLICY "Users can insert payout request" ON public.payout_settlements
    FOR INSERT WITH CHECK (auth.uid()::TEXT = partner_id);

CREATE POLICY "Admin full rights payout_settlements" ON public.payout_settlements
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid()::TEXT AND role = 'admin')
    );

-- 4.5 lemon_squeezy_webhooks policies
CREATE POLICY "Admin inspect webhooks history" ON public.lemon_squeezy_webhooks
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid()::TEXT AND role = 'admin')
    );

-- 4.6 anti_fraud_audits policies
CREATE POLICY "Admin inspect fraud incidents" ON public.anti_fraud_audits
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid()::TEXT AND role = 'admin')
    );

-- ====================================================================
-- 5. ENGINE TRIGGERS / BUSINESS RULE AUTOMATION
-- ====================================================================

-- 5.1 Trigger to automatically recalculate and elevate partner level tiers
CREATE OR REPLACE FUNCTION public.recalculate_partner_growth_tier()
RETURNS TRIGGER AS $$
DECLARE
    total_accrued_recurring_revenue INTEGER;
    current_partner_id TEXT;
    target_tier TEXT;
    target_rate NUMERIC(4,2);
BEGIN
    current_partner_id := NEW.partner_id;

    SELECT COALESCE(SUM(amount_paid_cents), 0) INTO total_accrued_recurring_revenue
    FROM public.customer_subscriptions
    WHERE partner_id = current_partner_id AND status = 'active';

    IF total_accrued_recurring_revenue >= 1500000 THEN
        target_tier := 'FOUNDING_AMBASSADOR';
        target_rate := 0.35;
    ELSIF total_accrued_recurring_revenue >= 500000 THEN
        target_tier := 'ELITE';
        target_rate := 0.30;
    ELSIF total_accrued_recurring_revenue >= 100000 THEN
        target_tier := 'GROWTH';
        target_rate := 0.25;
    ELSE
        target_tier := 'AFFILIATE';
        target_rate := 0.20;
    END IF;

    UPDATE public.affiliate_profiles
    SET tier = target_tier,
        commission_rate = target_rate,
        updated_at = NOW()
    WHERE id = current_partner_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_customer_subscription_changed
    AFTER INSERT OR UPDATE ON public.customer_subscriptions
    FOR EACH ROW EXECUTE PROCEDURE public.recalculate_partner_growth_tier();

COMMIT;
