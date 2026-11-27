'use strict';

/**
 * Rev live voice calls: session bookkeeping and the daily allowance.
 *
 * Audio never touches this server. The browser streams to Gemini Live with a
 * short-lived token; Node only decides whether a call may start, how long it
 * may last, and how much of the organization's daily allowance it used.
 *
 * Time is measured by the server's clock, never reported by the browser:
 * seconds_used = min(now - started_at, max_seconds). A tab that disappears
 * without hanging up stops heartbeating and is reaped after STALE_AFTER_MS,
 * charged up to its last heartbeat.
 *
 * One live call per user. Starting a new call (another tab, a reload) ends
 * the previous one with reason 'replaced'; its next heartbeat sees that and
 * the old tab hangs up.
 */

const DEFAULT_DAILY_SECONDS = 1800;          // 30 minutes per organization per UTC day
const MAX_CALL_SECONDS = 3600;               // token ceiling enforced by python too
const MIN_START_SECONDS = 20;                // not worth opening a call with less
const HEARTBEAT_INTERVAL_MS = 15_000;
const STALE_AFTER_MS = 45_000;
const END_REASONS = new Set([
  'hangup', 'assistant', 'limit', 'error', 'replaced', 'stale', 'unavailable', 'unload',
]);

function voiceError(status, code, message, extra = {}) {
  const error = new Error(message);
  error.statusCode = status;
  error.code = code;
  error.publicMessage = message;
  Object.assign(error, extra);
  return error;
}

function dailyLimitSeconds(env = process.env) {
  const raw = Number.parseInt(env.REV_VOICE_DAILY_SECONDS ?? '', 10);
  if (!Number.isFinite(raw) || raw < 0) return DEFAULT_DAILY_SECONDS;
  return Math.min(raw, 24 * 3600);
}

function utcDayStart(now) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function nextUtcDayStart(now) {
  return new Date(utcDayStart(now).getTime() + 24 * 3600 * 1000);
}

function clampInt(value, min, max) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

// Seconds a session has used at `at`, by the server clock.
function elapsedSeconds(startedAt, at, maxSeconds) {
  const ms = new Date(at).getTime() - new Date(startedAt).getTime();
  return clampInt(Math.round(ms / 1000), 0, Math.max(0, Number(maxSeconds) || 0));
}

/** End calls whose tab stopped heartbeating, charging up to the last beat. */
async function reapStaleSessions(prisma, { userId = null, organizationId = null }, now = new Date()) {
  const cutoff = new Date(now.getTime() - STALE_AFTER_MS);
  return prisma.$executeRaw`
    UPDATE rev_voice_sessions
    SET status = 'ended',
        end_reason = 'stale',
        ended_at = last_seen_at,
        seconds_used = LEAST(
          max_seconds,
          GREATEST(seconds_used, CEIL(EXTRACT(EPOCH FROM (last_seen_at - started_at)))::int)
        )
    WHERE status = 'active'
      AND last_seen_at < ${cutoff}::timestamptz
      AND (${userId}::uuid IS NULL OR user_id = ${userId}::uuid)
      AND (${organizationId}::uuid IS NULL OR organization_id = ${organizationId}::uuid)
  `;
}

/** Seconds of voice the organization has used since midnight UTC. Live calls count to now. */
async function secondsUsedToday(prisma, organizationId, now = new Date()) {
  const rows = await prisma.$queryRaw`
    SELECT COALESCE(SUM(
      CASE WHEN status = 'active'
        THEN LEAST(max_seconds, GREATEST(seconds_used,
          CEIL(EXTRACT(EPOCH FROM (${now}::timestamptz - started_at)))::int))
        ELSE seconds_used
      END
    ), 0)::int AS used
    FROM rev_voice_sessions
    WHERE organization_id = ${organizationId}::uuid
      AND started_at >= ${utcDayStart(now)}::timestamptz
  `;
  return clampInt(rows?.[0]?.used ?? 0, 0, Number.MAX_SAFE_INTEGER);
}

async function getAllowance(prisma, organizationId, { now = new Date(), env = process.env } = {}) {
  const limit = dailyLimitSeconds(env);
  const used = await secondsUsedToday(prisma, organizationId, now);
  return {
    limit_seconds: limit,
    used_seconds: Math.min(used, limit),
    remaining_seconds: Math.max(0, limit - used),
    resets_at: nextUtcDayStart(now).toISOString(),
  };
}

/**
 * Reserve a call. Ends this user's previous live call (if any), checks the
 * organization allowance and inserts the session row. Throws 429
 * VOICE_LIMIT_REACHED when there is not enough allowance left.
 */
async function startSession(prisma, {
  organizationId, userId, conversationId = null, model, now = new Date(), env = process.env,
}) {
  await reapStaleSessions(prisma, { userId }, now);
  await prisma.$executeRaw`
    UPDATE rev_voice_sessions
    SET status = 'ended',
        end_reason = 'replaced',
        ended_at = ${now}::timestamptz,
        seconds_used = LEAST(max_seconds, GREATEST(seconds_used,
          CEIL(EXTRACT(EPOCH FROM (${now}::timestamptz - started_at)))::int))
    WHERE user_id = ${userId}::uuid AND status = 'active'
  `;

  const allowance = await getAllowance(prisma, organizationId, { now, env });
  if (allowance.remaining_seconds < MIN_START_SECONDS) {
    throw voiceError(429, 'VOICE_LIMIT_REACHED',
      "You've used today's voice time with Rev. It resets at midnight UTC.",
      { allowance });
  }
  const maxSeconds = Math.min(allowance.remaining_seconds, MAX_CALL_SECONDS);
  const rows = await prisma.$queryRaw`
    INSERT INTO rev_voice_sessions (
      organization_id, user_id, conversation_id, model, status, max_seconds,
      started_at, last_seen_at, created_at
    ) VALUES (
      ${organizationId}::uuid, ${userId}::uuid, ${conversationId}::uuid, ${String(model || 'unknown').slice(0, 80)},
      'active', ${maxSeconds}, ${now}::timestamptz, ${now}::timestamptz, ${now}::timestamptz
    )
    RETURNING id, max_seconds, started_at
  `;
  const row = rows?.[0];
  if (!row) throw voiceError(503, 'VOICE_UNAVAILABLE', 'Voice calls are unavailable right now.');
  return {
    sessionId: row.id,
    maxSeconds: Number(row.max_seconds),
    startedAt: new Date(row.started_at),
    allowance,
  };
}

async function loadOwnedSession(prisma, { sessionId, organizationId, userId }) {
  const rows = await prisma.$queryRaw`
    SELECT id, organization_id, user_id, conversation_id, status, end_reason,
           max_seconds, seconds_used, turn_count, ask_count, started_at, last_seen_at
    FROM rev_voice_sessions
    WHERE id = ${sessionId}::uuid
    LIMIT 1
  `;
  const row = rows?.[0];
  if (!row || String(row.organization_id) !== String(organizationId) || String(row.user_id) !== String(userId)) {
    throw voiceError(404, 'VOICE_SESSION_NOT_FOUND', 'Voice call not found.');
  }
  return row;
}

function sessionView(row, now, secondsUsed) {
  const maxSeconds = Number(row.max_seconds);
  return {
    session_id: row.id,
    status: row.status,
    end_reason: row.end_reason || null,
    seconds_used: secondsUsed,
    remaining_seconds: Math.max(0, maxSeconds - secondsUsed),
    max_seconds: maxSeconds,
    ends_at: new Date(new Date(row.started_at).getTime() + maxSeconds * 1000).toISOString(),
    server_time: now.toISOString(),
  };
}

/**
 * Keep a call alive and charge it to now. Counters from the browser are
 * monotonic and clamped; time always comes from the server clock. When the
 * allowance is spent the session is ended with reason 'limit'.
 */
async function heartbeat(prisma, {
  sessionId, organizationId, userId, turnCount = 0, askCount = 0, conversationId = null, now = new Date(),
}) {
  const row = await loadOwnedSession(prisma, { sessionId, organizationId, userId });
  if (row.status !== 'active') {
    return sessionView(row, now, Number(row.seconds_used));
  }
  const used = elapsedSeconds(row.started_at, now, row.max_seconds);
  const overLimit = used >= Number(row.max_seconds);
  const turns = clampInt(turnCount, 0, 100_000);
  const asks = clampInt(askCount, 0, 10_000);
  await prisma.$executeRaw`
    UPDATE rev_voice_sessions
    SET last_seen_at = ${now}::timestamptz,
        seconds_used = GREATEST(seconds_used, ${used}),
        turn_count = GREATEST(turn_count, ${turns}),
        ask_count = GREATEST(ask_count, ${asks}),
        conversation_id = COALESCE(conversation_id, ${conversationId}::uuid),
        status = CASE WHEN ${overLimit}::boolean THEN 'ended' ELSE status END,
        end_reason = CASE WHEN ${overLimit}::boolean THEN 'limit' ELSE end_reason END,
        ended_at = CASE WHEN ${overLimit}::boolean THEN ${now}::timestamptz ELSE ended_at END
    WHERE id = ${sessionId}::uuid AND status = 'active'
  `;
  return sessionView(
    { ...row, status: overLimit ? 'ended' : 'active', end_reason: overLimit ? 'limit' : null },
    now, Math.max(Number(row.seconds_used) || 0, used),
  );
}

/** Hang up. Idempotent: ending an ended call returns its final state. */
async function endSession(prisma, {
  sessionId, organizationId, userId, reason = 'hangup', turnCount = 0, askCount = 0, conversationId = null,
  now = new Date(),
}) {
  const row = await loadOwnedSession(prisma, { sessionId, organizationId, userId });
  if (row.status !== 'active') return sessionView(row, now, Number(row.seconds_used));
  const endReason = END_REASONS.has(reason) ? reason : 'hangup';
  const used = Math.max(Number(row.seconds_used) || 0, elapsedSeconds(row.started_at, now, row.max_seconds));
  await prisma.$executeRaw`
    UPDATE rev_voice_sessions
    SET status = 'ended',
        end_reason = ${endReason},
        ended_at = ${now}::timestamptz,
        last_seen_at = ${now}::timestamptz,
        seconds_used = GREATEST(seconds_used, ${used}),
        turn_count = GREATEST(turn_count, ${clampInt(turnCount, 0, 100_000)}),
        ask_count = GREATEST(ask_count, ${clampInt(askCount, 0, 10_000)}),
        conversation_id = COALESCE(conversation_id, ${conversationId}::uuid)
    WHERE id = ${sessionId}::uuid AND status = 'active'
  `;
  return sessionView({ ...row, status: 'ended', end_reason: endReason }, now, used);
}

// ── Conversation excerpt for the voice model ─────────────────────────────────
// The call continues the open thread, so the voice model gets the last few
// turns as plain text (python escapes and fences it inside the prompt). Rev
// answers are flattened from their stored structure; numbers stay exactly as
// Rev wrote them so the voice can refer back without re-asking.
const EXCERPT_MAX_CHARS = 4000;
const EXCERPT_TURN_CHARS = 900;

function asText(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    for (const key of ['text', 'summary', 'headline', 'statement', 'content']) {
      if (typeof value[key] === 'string') return value[key];
    }
  }
  return '';
}

function parseContent(content) {
  if (typeof content === 'string') {
    try { return JSON.parse(content); } catch { return { text: content }; }
  }
  return content && typeof content === 'object' ? content : {};
}

function messageText(role, rawContent) {
  const content = parseContent(rawContent);
  if (role === 'user') return asText(content);
  if (content.error) return '';
  const direct = asText(content.text);
  if (direct) return direct;
  return ['situation', 'insight', 'implication', 'recommendation']
    .map((key) => asText(content[key]).trim())
    .filter(Boolean)
    .join(' ');
}

function buildVoiceExcerpt(rows) {
  const lines = [];
  for (const row of rows || []) {
    if (row.has_error) continue;
    const text = messageText(row.role, row.content).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const clipped = text.length > EXCERPT_TURN_CHARS ? `${text.slice(0, EXCERPT_TURN_CHARS - 1).trimEnd()}\u2026` : text;
    lines.push(`${row.role === 'user' ? 'Merchant' : 'Rev'}: ${clipped}`);
  }
  // Keep the newest turns when the thread is long.
  let excerpt = lines.join('\n');
  while (excerpt.length > EXCERPT_MAX_CHARS && lines.length > 1) {
    lines.shift();
    excerpt = lines.join('\n');
  }
  return excerpt.slice(-EXCERPT_MAX_CHARS);
}

module.exports = {
  buildVoiceExcerpt,
  DEFAULT_DAILY_SECONDS,
  MAX_CALL_SECONDS,
  MIN_START_SECONDS,
  HEARTBEAT_INTERVAL_MS,
  STALE_AFTER_MS,
  END_REASONS,
  dailyLimitSeconds,
  utcDayStart,
  nextUtcDayStart,
  elapsedSeconds,
  reapStaleSessions,
  secondsUsedToday,
  getAllowance,
  startSession,
  heartbeat,
  endSession,
  voiceError,
};
