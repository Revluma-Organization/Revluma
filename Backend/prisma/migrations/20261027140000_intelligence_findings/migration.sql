-- Phase 3: persistent merchant intelligence findings.
-- Apply via Prisma migration deployment; no application-generated findings
-- may be treated as verified without evidence stored alongside the finding.
CREATE TABLE IF NOT EXISTS intelligence_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  type varchar(80) NOT NULL,
  severity varchar(16) NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  status varchar(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved','dismissed')),
  title text NOT NULL,
  description text NOT NULL,
  evidence jsonb NOT NULL,
  action jsonb,
  dedupe_key text NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  dismissed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_intelligence_findings_org_status
  ON intelligence_findings(organization_id, status, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_intelligence_findings_store
  ON intelligence_findings(store_id, detected_at DESC);
