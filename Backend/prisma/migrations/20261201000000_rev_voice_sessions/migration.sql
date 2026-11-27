-- Rev live voice calls (Gemini Live). One row per call.
-- Additive-only: one new backend-only table. No existing table, grant or
-- policy is modified. RLS is enabled with NO policies and no grants to
-- anon/authenticated, matching conversation_messages under the Data-API
-- lockdown (20261104170000): only the service role, used by the Node API,
-- can read or write these rows. Every foreign key is covered by an index
-- (Phase 6 invariant: zero uncovered FKs).
--
-- seconds_used drives the per-organization daily voice allowance
-- (REV_VOICE_DAILY_SECONDS). Call audio and transcripts are never stored
-- here; spoken turns are saved as ordinary conversation_messages.

CREATE TABLE IF NOT EXISTS rev_voice_sessions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
    model           text NOT NULL,
    status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
    end_reason      text,
    max_seconds     integer NOT NULL CHECK (max_seconds > 0),
    seconds_used    integer NOT NULL DEFAULT 0 CHECK (seconds_used >= 0),
    turn_count      integer NOT NULL DEFAULT 0 CHECK (turn_count >= 0),
    ask_count       integer NOT NULL DEFAULT 0 CHECK (ask_count >= 0),
    started_at      timestamptz(6) NOT NULL DEFAULT now(),
    last_seen_at    timestamptz(6) NOT NULL DEFAULT now(),
    ended_at        timestamptz(6),
    created_at      timestamptz(6) NOT NULL DEFAULT now()
);

-- Daily allowance scans: SUM(seconds_used) per organization since midnight UTC.
-- Also covers the organization_id FK.
CREATE INDEX IF NOT EXISTS idx_rev_voice_sessions_org_started
    ON rev_voice_sessions (organization_id, started_at DESC);

-- Covers the user_id FK and the one-live-call-per-user check.
CREATE INDEX IF NOT EXISTS idx_rev_voice_sessions_user_status
    ON rev_voice_sessions (user_id, status);

-- Covers the conversation_id FK.
CREATE INDEX IF NOT EXISTS idx_rev_voice_sessions_conversation
    ON rev_voice_sessions (conversation_id);

ALTER TABLE rev_voice_sessions ENABLE ROW LEVEL SECURITY;

-- Defence in depth: the Data API lockdown already removed default grants, but
-- never rely on that. Only roles that exist are touched.
DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE rev_voice_sessions FROM %I', api_role);
    END IF;
  END LOOP;
END $$;
