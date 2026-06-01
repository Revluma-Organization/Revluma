-- ====================================================================
-- REVLUMA PARTNER ECOSYSTEM (By Luminor Terminal)
-- Enterprise-Grade Manual Withdrawal Operations Schema Migration
-- Target Platform: PostgreSQL / Supabase
-- ====================================================================

BEGIN;

-- 1. WITHDRAWAL STATUS ENUMS
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'withdrawal_status') THEN
        CREATE TYPE withdrawal_status AS ENUM (
            'Pending Review', 
            'Under Verification', 
            'Approved', 
            'Processing', 
            'Paid', 
            'Rejected', 
            'Cancelled'
        );
    END IF;
END $$;

-- 2. WITHDRAWAL REQUESTS TRANSACTION LEDGER
CREATE TABLE IF NOT EXISTS public.withdrawal_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    partner_id TEXT REFERENCES public.affiliate_profiles(id) ON DELETE CASCADE,
    amount_usd_cents INTEGER NOT NULL CHECK (amount_usd_cents >= 5000), -- enforced $50.00 minimum
    payout_method TEXT NOT NULL, -- 'paypal' | 'bank_transfer'
    payout_email TEXT, -- For PayPal
    legal_name TEXT NOT NULL,
    country TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    
    -- International Banking Coordinates
    bank_name TEXT,
    account_name TEXT,
    account_number TEXT,
    iban TEXT,
    swift_bic TEXT,
    routing_number TEXT,
    branch_name TEXT,
    
    additional_notes TEXT,
    ip_address_logged TEXT,
    status withdrawal_status DEFAULT 'Pending Review'::withdrawal_status,
    admin_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. GLOBAL SYSTEM WITHDRAWAL CONFIGURATION
CREATE TABLE IF NOT EXISTS public.system_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Insert enterprise global config standard thresholds
INSERT INTO public.system_settings (key, value) 
VALUES ('min_withdrawal_usd_cents', '5000'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = '5000'::jsonb;

-- 4. WITHDRAWAL SECURITY AUDIT LOGS
CREATE TABLE IF NOT EXISTS public.withdrawal_audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id UUID REFERENCES public.withdrawal_requests(id) ON DELETE CASCADE,
    actor_id TEXT REFERENCES public.users(id),
    action_taken TEXT NOT NULL, -- e.g. "STATUS_TRANSITION_PAID", "FRAUD_SUSPICION"
    previous_status TEXT,
    new_status TEXT,
    internal_notes TEXT,
    ip_address TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. PERFORMANCE TUNING & SPEED INDEXES
CREATE INDEX IF NOT EXISTS idx_withdrawals_partner ON public.withdrawal_requests(partner_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON public.withdrawal_requests(status);
CREATE INDEX IF NOT EXISTS idx_withdrawal_audit_req ON public.withdrawal_audit_logs(request_id);

-- 6. SECURITY: ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawal_audit_logs ENABLE ROW LEVEL SECURITY;

-- 6.1 Only self-partners can query or insert their requests
CREATE POLICY "Users can insert own manual withdrawal" ON public.withdrawal_requests
    FOR INSERT WITH CHECK (auth.uid()::TEXT = partner_id);

CREATE POLICY "Users can view own withdrawal history" ON public.withdrawal_requests
    FOR SELECT USING (auth.uid()::TEXT = partner_id);

CREATE POLICY "Admin full rights manual withdrawal" ON public.withdrawal_requests
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid()::TEXT AND role = 'admin')
    );

-- 6.2 Audit Logs visibility policies
CREATE POLICY "Admin inspect manual withdrawal audit logs" ON public.withdrawal_audit_logs
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid()::TEXT AND role = 'admin')
    );

COMMIT;
