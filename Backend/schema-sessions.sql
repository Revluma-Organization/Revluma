-- ============================================================
-- SESSION MANAGEMENT SCHEMA
-- ============================================================
-- Required for session-based authentication
-- Uses camelCase to match existing Prisma schema

CREATE TABLE IF NOT EXISTS user_sessions (
  id VARCHAR(255) PRIMARY KEY,
  "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(255) UNIQUE NOT NULL,
  "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for session lookup
CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON user_sessions("userId");
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON user_sessions("expiresAt");