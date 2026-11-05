-- Per-answer thumbs up/down on Rev answers (ChatGPT-UI adoption).
-- Additive-only: one new backend-only table. No existing table, grant or
-- policy is modified. RLS is enabled with NO policies and no grants to
-- anon/authenticated, matching conversation_messages under the Data-API
-- lockdown (20261104170000): only the service role, used by the Node API,
-- can read or write these rows. Every foreign key is covered by an index
-- (Phase 6 invariant: zero uncovered FKs).

CREATE TABLE IF NOT EXISTS conversation_message_feedback (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    message_id      uuid NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating          text NOT NULL CHECK (rating IN ('up', 'down')),
    created_at      timestamptz(6) NOT NULL DEFAULT now(),
    updated_at      timestamptz(6) NOT NULL DEFAULT now()
);

-- Upsert target: one rating per (message, user). Also covers the message_id FK.
CREATE UNIQUE INDEX IF NOT EXISTS conversation_message_feedback_message_id_user_id_key
    ON conversation_message_feedback (message_id, user_id);

-- Covers the organization_id FK and org-scoped analytics scans.
CREATE INDEX IF NOT EXISTS idx_msg_feedback_org_created
    ON conversation_message_feedback (organization_id, created_at DESC);

-- Covers the user_id FK.
CREATE INDEX IF NOT EXISTS idx_msg_feedback_user
    ON conversation_message_feedback (user_id);

ALTER TABLE conversation_message_feedback ENABLE ROW LEVEL SECURITY;
