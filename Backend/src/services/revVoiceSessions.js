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
 *
 * Every call belongs to a conversation, like a typed chat. A call started
 * outside one gets a conversation created by the server (owns_conversation),
 * and every finished spoken line is saved into it as an ordinary
 * conversation_messages row (metadata.voice_kind = 'transcript'). The
 * conversation is always the one recorded on the session row: the browser
 * can never point a call at a different conversation. An owned conversation
 * that is still empty when its call ends is deleted, so silent calls leave
 * nothing behind.
 */

const { v4: uuidv4, v5: uuidv5 } = require('uuid');
const revSequence = require('./revSequence');

const DEFAULT_DAILY_SECONDS = 1800;          // 30 minutes per organization per UTC day
const MAX_CALL_SECONDS = 3600;               // token ceiling enforced by python too
const MIN_START_SECONDS = 20;                // not worth opening a call with less
const HEARTBEAT_INTERVAL_MS = 15_000;
const STALE_AFTER_MS = 45_000;
const END_REASONS = new Set([
  'hangup', 'assistant', 'limit', 'error', 'replaced', 'stale', 'unavailable', 'unload',
]);

// Spoken-turn persistence.
const CALL_CONVERSATION_NAMESPACE = '0d6c2f4e-7b1a-4c8e-9f3d-5a2b8e1c7d40';
const TRANSCRIPT_ENTRY_NAMESPACE = '9e3b5a71-2c4d-4f86-b0a9-1d7e6c3f8b25';
const MAX_TRANSCRIPT_BATCH = 25;
const MAX_TRANSCRIPT_TEXT = 4000;
// Lines that finish while the call is hanging up are still accepted.
const TRANSCRIPT_GRACE_MS = 10 * 60 * 1000;
const CLIENT_ENTRY_ID = /^[A-Za-z0-9_.:-]{1,64}$/;

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

  await cleanupEmptyCallConversations(prisma, { organizationId, userId }).catch(() => 0);

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
    SELECT id, organization_id, user_id, conversation_id, owns_conversation, status, end_reason,
           max_seconds, seconds_used, turn_count, ask_count, started_at, last_seen_at, ended_at
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
  sessionId, organizationId, userId, turnCount = 0, askCount = 0, now = new Date(),
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
  sessionId, organizationId, userId, reason = 'hangup', turnCount = 0, askCount = 0,
  now = new Date(),
}) {
  const row = await loadOwnedSession(prisma, { sessionId, organizationId, userId });
  if (row.status !== 'active') return { ...sessionView(row, now, Number(row.seconds_used)), conversation_id: row.conversation_id || null };
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
        ask_count = GREATEST(ask_count, ${clampInt(askCount, 0, 10_000)})
    WHERE id = ${sessionId}::uuid AND status = 'active'
  `;
  // A call where nothing was said leaves no empty conversation behind. Not
  // when the tab is closing or reloading: the page may be about to open that
  // conversation again, so it is tidied up when the next call starts.
  const removed = endReason === 'unload' ? 0
    : await cleanupEmptyCallConversations(prisma, { organizationId, userId }).catch(() => 0);
  let conversationId = row.conversation_id || null;
  if (conversationId && Number(removed) > 0 && !(await conversationExists(prisma, conversationId))) {
    conversationId = null;
  }
  return { ...sessionView({ ...row, status: 'ended', end_reason: endReason }, now, used), conversation_id: conversationId };
}

async function conversationExists(prisma, conversationId) {
  const rows = await prisma.$queryRaw`SELECT 1 AS present FROM conversations WHERE id = ${conversationId}::uuid LIMIT 1`;
  return Boolean(rows?.[0]);
}

/**
 * Give a call that started outside a conversation its own conversation, and
 * record it on the session. Deterministic per session, so a retried request
 * never creates a second one. Like a typed chat's first turn, the row stays
 * out of history until it has a message.
 */
async function createCallConversation(prisma, { sessionId, organizationId, userId }) {
  const conversationId = uuidv5(String(sessionId), CALL_CONVERSATION_NAMESPACE);
  await prisma.$transaction([
    prisma.$executeRaw`
      INSERT INTO conversations (id, organization_id, user_id, status, message_count, last_activity_at)
      VALUES (${conversationId}::uuid, ${organizationId}::uuid, ${userId}::uuid, 'active', 0, NOW())
      ON CONFLICT (id) DO NOTHING
    `,
    prisma.$executeRaw`
      UPDATE rev_voice_sessions
      SET conversation_id = ${conversationId}::uuid, owns_conversation = true
      WHERE id = ${sessionId}::uuid AND organization_id = ${organizationId}::uuid
    `,
  ]);
  return conversationId;
}

/**
 * Delete conversations created by this user's ended calls that never got a
 * message. A conversation still used by a live call is never touched.
 */
async function cleanupEmptyCallConversations(prisma, { organizationId, userId = null }) {
  return prisma.$executeRaw`
    DELETE FROM conversations c
    USING rev_voice_sessions s
    WHERE s.conversation_id = c.id
      AND s.owns_conversation = true
      AND s.status = 'ended'
      AND s.organization_id = ${organizationId}::uuid
      AND c.organization_id = ${organizationId}::uuid
      AND (${userId}::uuid IS NULL OR s.user_id = ${userId}::uuid)
      AND NOT EXISTS (SELECT 1 FROM conversation_messages m WHERE m.conversation_id = c.id)
      AND NOT EXISTS (
        SELECT 1 FROM rev_voice_sessions live
        WHERE live.conversation_id = c.id AND live.status = 'active'
      )
  `;
}

// ── Spoken turns ─────────────────────────────────────────────────────────────

/**
 * Validate finished transcript lines from the browser. Each line has a
 * client id (stable for the call, so a resend is idempotent), a speaker and
 * its text. Empty lines are dropped; anything malformed rejects the batch.
 */
function normaliseTranscriptEntries(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw voiceError(400, 'VOICE_INVALID_TRANSCRIPT', 'entries must be an array.');
  }
  if (raw.length > MAX_TRANSCRIPT_BATCH) {
    throw voiceError(400, 'VOICE_INVALID_TRANSCRIPT', `Send at most ${MAX_TRANSCRIPT_BATCH} transcript lines at a time.`);
  }
  const seen = new Set();
  const entries = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw voiceError(400, 'VOICE_INVALID_TRANSCRIPT', 'Each transcript line must be an object.');
    }
    const clientId = typeof entry.client_id === 'string' ? entry.client_id.trim() : '';
    if (!CLIENT_ENTRY_ID.test(clientId)) {
      throw voiceError(400, 'VOICE_INVALID_TRANSCRIPT', 'Each transcript line needs a valid client_id.');
    }
    if (entry.speaker !== 'user' && entry.speaker !== 'rev') {
      throw voiceError(400, 'VOICE_INVALID_TRANSCRIPT', "speaker must be 'user' or 'rev'.");
    }
    const text = typeof entry.text === 'string'
      ? entry.text.replace(/\0/g, '').replace(/\s+/g, ' ').replace(/\s+([,.!?;:])/g, '$1').trim()
      : '';
    if (!text || seen.has(clientId)) continue;
    seen.add(clientId);
    let spokenAt = null;
    if (typeof entry.spoken_at === 'string') {
      const parsed = new Date(entry.spoken_at);
      if (!Number.isNaN(parsed.getTime())) spokenAt = parsed.toISOString();
    }
    entries.push({
      clientId,
      speaker: entry.speaker,
      text: text.length > MAX_TRANSCRIPT_TEXT ? `${text.slice(0, MAX_TRANSCRIPT_TEXT - 1).trimEnd()}\u2026` : text,
      interrupted: entry.speaker === 'rev' && entry.interrupted === true,
      spokenAt,
    });
  }
  return entries;
}

/**
 * Save finished spoken lines into the call's conversation, in order, under
 * the conversation write lock (same single-writer rule as typed turns).
 * Idempotent per (call, client id). Returns how many new rows were written.
 */
async function saveTranscript(prisma, {
  session, organizationId, userId, entries, titleHint = null, now = new Date(),
}) {
  const conversationId = session.conversation_id || null;
  if (!entries.length) return { saved: 0, conversationId };
  if (session.status !== 'active') {
    const endedAt = session.ended_at ? new Date(session.ended_at).getTime() : 0;
    if (!endedAt || now.getTime() - endedAt > TRANSCRIPT_GRACE_MS) {
      throw voiceError(409, 'VOICE_SESSION_CLOSED', 'This call has ended.');
    }
  }
  if (!conversationId) {
    throw voiceError(409, 'VOICE_CONVERSATION_GONE', "This call's conversation no longer exists.");
  }
  const saved = await revSequence.withSequenceAllocationRetry(() => prisma.$transaction(async (tx) => {
    const owned = await tx.$queryRaw`
      SELECT 1 AS present FROM conversations
      WHERE id = ${conversationId}::uuid AND organization_id = ${organizationId}::uuid
      LIMIT 1
    `;
    if (!owned?.[0]) throw voiceError(409, 'VOICE_CONVERSATION_GONE', "This call's conversation no longer exists.");
    await revSequence.acquireConversationWriteLock(tx, conversationId);
    let written = 0;
    for (const entry of entries) {
      const role = entry.speaker === 'user' ? 'user' : 'rev';
      const content = role === 'user'
        ? { text: entry.text, voice_transcript: true }
        : { text: entry.text, voice_transcript: true, response_type: 'voice', read_only: true };
      const metadata = {
        input_mode: 'voice',
        voice_kind: 'transcript',
        voice_session_id: String(session.id),
        voice_client_id: entry.clientId,
        ...(entry.interrupted ? { interrupted: true } : {}),
        ...(entry.spokenAt ? { spoken_at: entry.spokenAt } : {}),
      };
      const correlationId = uuidv5(`${session.id}:${entry.clientId}`, TRANSCRIPT_ENTRY_NAMESPACE);
      const inserted = await tx.$executeRaw`
        INSERT INTO conversation_messages (
          id, conversation_id, organization_id, user_id, role, content,
          sequence_number, correlation_id, has_error, agent_name, metadata
        )
        SELECT ${uuidv4()}::uuid, ${conversationId}::uuid, ${organizationId}::uuid, ${userId}::uuid,
               ${role}, ${JSON.stringify(content)}::jsonb, COALESCE(MAX(sequence_number), 0) + 1,
               ${correlationId}::uuid, false, ${role === 'rev' ? 'rev_voice' : null}, ${JSON.stringify(metadata)}::jsonb
        FROM conversation_messages
        WHERE conversation_id = ${conversationId}::uuid
        ON CONFLICT (organization_id, conversation_id, role, correlation_id) DO NOTHING
      `;
      written += Number(inserted) || 0;
    }
    if (written > 0) {
      await tx.$executeRaw`
        UPDATE conversations
        SET last_activity_at = NOW(),
            message_count = message_count + ${written},
            title = COALESCE(NULLIF(btrim(title), ''), ${titleHint}),
            updated_at = NOW()
        WHERE id = ${conversationId}::uuid AND organization_id = ${organizationId}::uuid
      `;
    }
    return written;
  }));
  return { saved, conversationId };
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
  MAX_TRANSCRIPT_BATCH,
  MAX_TRANSCRIPT_TEXT,
  TRANSCRIPT_GRACE_MS,
  CALL_CONVERSATION_NAMESPACE,
  TRANSCRIPT_ENTRY_NAMESPACE,
  loadOwnedSession,
  createCallConversation,
  cleanupEmptyCallConversations,
  normaliseTranscriptEntries,
  saveTranscript,
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
