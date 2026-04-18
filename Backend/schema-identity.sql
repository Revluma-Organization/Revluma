-- ============================================================
-- CUSTOMER IDENTITY & EVENT STORE SCHEMA
-- ============================================================
-- Required for Identity Resolution Engine and Event Store
-- NOTE: Using TEXT for tenant_id to match existing schema (Prisma uses String -> TEXT)

-- ============================================================
-- CUSTOMERS (Unified Profile)
-- ============================================================

CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    external_id VARCHAR(255),
    status VARCHAR(50) DEFAULT 'unknown' CHECK (status IN ('unknown', 'identified', 'verified', 'churned', 'merged')),
    merged_into UUID,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (tenant_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_customers_tenant_status ON customers(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_id ON customers(tenant_id);

-- ============================================================
-- CUSTOMER IDENTITIES (Identity Resolution)
-- ============================================================

CREATE TABLE IF NOT EXISTS customer_identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    customer_id UUID NOT NULL,
    identity_type VARCHAR(50) NOT NULL CHECK (identity_type IN (
        'anonymous_cookie', 'email', 'phone', 'device_fingerprint', 
        'shopify_customer_id', 'klaviyo_profile_id'
    )),
    identity_value TEXT NOT NULL,
    confidence DECIMAL(3,2) DEFAULT 0.5,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (tenant_id, identity_type, identity_value)
);

CREATE INDEX IF NOT EXISTS idx_identities_tenant_customer ON customer_identities(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_identities_customer ON customer_identities(customer_id);

-- ============================================================
-- CUSTOMER EVENTS (Append-only Event Store)
-- ============================================================

CREATE TABLE IF NOT EXISTS customer_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    customer_id UUID,
    event_type VARCHAR(100) NOT NULL,
    event_source VARCHAR(50) DEFAULT 'internal' CHECK (event_source IN (
        'shopify', 'tracking_script', 'klaviyo', 'internal', 'webhook'
    )),
    payload JSONB DEFAULT '{}',
    session_id VARCHAR(255),
    anonymous_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_tenant_type_time ON customer_events(tenant_id, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_tenant_customer_time ON customer_events(tenant_id, customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_customer ON customer_events(customer_id);

-- ============================================================
-- EVENT DEAD LETTER QUEUE
-- ============================================================

CREATE TABLE IF NOT EXISTS event_dlq (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_data JSONB NOT NULL,
    error_message TEXT NOT NULL,
    failed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_dlq_failed_at ON event_dlq(failed_at DESC);

-- ============================================================
-- REVISION HISTORY (Optional - for auditing)
-- ============================================================

-- ALTER TABLE customers ADD COLUMN IF NOT EXISTS revision INTEGER DEFAULT 1;
-- ALTER TABLE customer_identities ADD COLUMN IF NOT EXISTS revision INTEGER DEFAULT 1;
-- ALTER TABLE customer_events ADD COLUMN IF NOT EXISTS revision INTEGER DEFAULT 1;