'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const voice = require('../services/revVoiceSessions');

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const OTHER = '99999999-9999-4999-8999-999999999999';
const SESSION = '33333333-3333-4333-8333-333333333333';

// A fake prisma that records tagged-template SQL and answers by keyword.
function fakePrisma(answers = {}) {
  const calls = [];
  const run = (kind) => async (strings, ...values) => {
    const sql = strings.join('?').replace(/\s+/g, ' ').trim();
    calls.push({ kind, sql, values });
    for (const [needle, answer] of Object.entries(answers)) {
      if (sql.includes(needle)) return typeof answer === 'function' ? answer(values) : answer;
    }
    return kind === 'execute' ? 1 : [];
  };
  const db = { calls, $queryRaw: run('query'), $executeRaw: run('execute') };
  // Callback transactions run against the same recorder; array form awaits.
  db.$transaction = async (work) => (typeof work === 'function' ? work(db) : Promise.all(work));
  return db;
}

(async () => {
  // ── 1. Allowance configuration ────────────────────────────────────────────
  assert.equal(voice.dailyLimitSeconds({}), 1800);
  assert.equal(voice.dailyLimitSeconds({ REV_VOICE_DAILY_SECONDS: '600' }), 600);
  assert.equal(voice.dailyLimitSeconds({ REV_VOICE_DAILY_SECONDS: '0' }), 0);
  assert.equal(voice.dailyLimitSeconds({ REV_VOICE_DAILY_SECONDS: 'lots' }), 1800);
  assert.equal(voice.dailyLimitSeconds({ REV_VOICE_DAILY_SECONDS: '-5' }), 1800);
  assert.equal(voice.dailyLimitSeconds({ REV_VOICE_DAILY_SECONDS: '999999' }), 86400);

  const now = new Date('2026-11-18T22:30:00.000Z');
  assert.equal(voice.utcDayStart(now).toISOString(), '2026-11-18T00:00:00.000Z');
  assert.equal(voice.nextUtcDayStart(now).toISOString(), '2026-11-19T00:00:00.000Z');
  assert.equal(voice.elapsedSeconds('2026-11-18T22:29:00Z', now, 600), 60);
  assert.equal(voice.elapsedSeconds('2026-11-18T22:00:00Z', now, 600), 600, 'capped at max_seconds');
  assert.equal(voice.elapsedSeconds('2026-11-18T22:31:00Z', now, 600), 0, 'clock skew never goes negative');

  // ── 2. Starting a call ────────────────────────────────────────────────────
  {
    const db = fakePrisma({
      'AS used': [{ used: 600 }],
      'INSERT INTO rev_voice_sessions': (values) => [{ id: SESSION, max_seconds: values[4], started_at: now }],
    });
    const started = await voice.startSession(db, { organizationId: ORG, userId: USER, model: 'gemini-3.8-live', now, env: {} });
    assert.equal(started.sessionId, SESSION);
    assert.equal(started.maxSeconds, 1200, 'call is limited to the remaining allowance');
    assert.equal(started.allowance.remaining_seconds, 1200);
    assert.equal(started.allowance.resets_at, '2026-11-19T00:00:00.000Z');
    const order = db.calls.map(c => c.sql);
    assert.match(order[0], /end_reason = 'stale'/, 'stale calls are reaped first');
    assert.match(order[1], /end_reason = 'replaced'/, 'the user\'s previous live call is replaced');
    assert.ok(db.calls[1].values.includes(USER));
    assert.match(order[2], /DELETE FROM conversations/, 'empty conversations of ended calls are cleaned up');
    assert.match(order[3], /SUM/);
    assert.ok(db.calls[3].values.some(v => v instanceof Date && v.toISOString() === '2026-11-18T00:00:00.000Z'),
      'usage is counted from midnight UTC');
    assert.match(order[4], /INSERT INTO rev_voice_sessions/);
  }
  {
    const db = fakePrisma({ 'AS used': [{ used: 1790 }] });
    await assert.rejects(
      voice.startSession(db, { organizationId: ORG, userId: USER, model: 'm', now, env: {} }),
      (error) => error.statusCode === 429 && error.code === 'VOICE_LIMIT_REACHED'
        && error.allowance.remaining_seconds === 10 && !/\u2014/.test(error.message),
    );
    assert.ok(!db.calls.some(c => c.sql.includes('INSERT')), 'no session row when the allowance is spent');
  }
  {
    const db = fakePrisma({ 'AS used': [{ used: 0 }], INSERT: (v) => [{ id: SESSION, max_seconds: v[4], started_at: now }] });
    const started = await voice.startSession(db, { organizationId: ORG, userId: USER, model: 'm', now,
      env: { REV_VOICE_DAILY_SECONDS: '20000' } });
    assert.equal(started.maxSeconds, voice.MAX_CALL_SECONDS, 'one call never exceeds the token ceiling');
  }

  // ── 3. Heartbeats use the server clock and end calls at the limit ────────
  const activeRow = (overrides = {}) => ({
    id: SESSION, organization_id: ORG, user_id: USER, conversation_id: null, status: 'active', end_reason: null,
    max_seconds: 300, seconds_used: 0, turn_count: 0, ask_count: 0,
    started_at: new Date(now.getTime() - 120_000), last_seen_at: new Date(now.getTime() - 15_000), ...overrides,
  });
  {
    const db = fakePrisma({ 'FROM rev_voice_sessions WHERE id': [activeRow()] });
    const view = await voice.heartbeat(db, { sessionId: SESSION, organizationId: ORG, userId: USER,
      turnCount: 4, askCount: 1, now });
    assert.equal(view.status, 'active');
    assert.equal(view.seconds_used, 120);
    assert.equal(view.remaining_seconds, 180);
    const update = db.calls.find(c => c.kind === 'execute');
    assert.ok(update.values.includes(120) && update.values.includes(4) && update.values.includes(1));
    assert.ok(update.values.includes(false), 'not over the limit yet');
    assert.doesNotMatch(update.sql, /conversation_id/, 'a heartbeat can never re-point the call at another conversation');
  }
  {
    const db = fakePrisma({ 'FROM rev_voice_sessions WHERE id': [activeRow({ started_at: new Date(now.getTime() - 400_000) })] });
    const view = await voice.heartbeat(db, { sessionId: SESSION, organizationId: ORG, userId: USER, now });
    assert.equal(view.status, 'ended');
    assert.equal(view.end_reason, 'limit');
    assert.equal(view.seconds_used, 300, 'never charged past max_seconds');
    assert.equal(view.remaining_seconds, 0);
  }
  {
    const db = fakePrisma({ 'FROM rev_voice_sessions WHERE id': [activeRow({ status: 'ended', end_reason: 'replaced', seconds_used: 90 })] });
    const view = await voice.heartbeat(db, { sessionId: SESSION, organizationId: ORG, userId: USER, now });
    assert.equal(view.status, 'ended');
    assert.equal(view.end_reason, 'replaced', 'a replaced call learns it should hang up');
    assert.ok(!db.calls.some(c => c.kind === 'execute'));
  }
  for (const owner of [{ organization_id: OTHER }, { user_id: OTHER }]) {
    const db = fakePrisma({ 'FROM rev_voice_sessions WHERE id': [activeRow(owner)] });
    await assert.rejects(voice.heartbeat(db, { sessionId: SESSION, organizationId: ORG, userId: USER, now }),
      (error) => error.statusCode === 404 && error.code === 'VOICE_SESSION_NOT_FOUND');
  }

  // ── 4. Hanging up is idempotent and keeps known reasons only ─────────────
  {
    const db = fakePrisma({ 'FROM rev_voice_sessions WHERE id': [activeRow()] });
    const view = await voice.endSession(db, { sessionId: SESSION, organizationId: ORG, userId: USER, reason: 'drop table', now });
    assert.equal(view.status, 'ended');
    assert.equal(view.end_reason, 'hangup');
    assert.equal(view.seconds_used, 120);
    const end = db.calls.find(c => c.kind === 'execute' && c.sql.includes("SET status = 'ended'"));
    assert.doesNotMatch(end.sql, /conversation_id/, 'hanging up can never re-point the call at another conversation');
    assert.ok(db.calls.some(c => c.sql.startsWith('DELETE FROM conversations')), 'a silent call leaves no empty conversation');
  }
  {
    const CONV = '44444444-4444-4444-8444-444444444444';
    // The owned conversation was empty and is gone after cleanup.
    const db = fakePrisma({
      'FROM rev_voice_sessions WHERE id': [activeRow({ conversation_id: CONV, owns_conversation: true })],
      'DELETE FROM conversations': 1,
      'FROM conversations WHERE id': [],
    });
    const view = await voice.endSession(db, { sessionId: SESSION, organizationId: ORG, userId: USER, now });
    assert.equal(view.conversation_id, null, 'the dashboard learns the empty conversation was removed');
  }
  {
    const CONV = '44444444-4444-4444-8444-444444444444';
    const db = fakePrisma({
      'FROM rev_voice_sessions WHERE id': [activeRow({ conversation_id: CONV, owns_conversation: true })],
      'DELETE FROM conversations': 0,
    });
    const view = await voice.endSession(db, { sessionId: SESSION, organizationId: ORG, userId: USER, now });
    assert.equal(view.conversation_id, CONV, 'a call with saved lines keeps its conversation');
  }
  {
    const CONV = '44444444-4444-4444-8444-444444444444';
    const db = fakePrisma({ 'FROM rev_voice_sessions WHERE id': [activeRow({ conversation_id: CONV, owns_conversation: true })] });
    const view = await voice.endSession(db, { sessionId: SESSION, organizationId: ORG, userId: USER, reason: 'unload', now });
    assert.equal(view.end_reason, 'unload');
    assert.equal(view.conversation_id, CONV);
    assert.ok(!db.calls.some(c => c.sql.startsWith('DELETE FROM conversations')), 'a reloading page can still open its conversation');
  }
  {
    const db = fakePrisma({ 'FROM rev_voice_sessions WHERE id': [activeRow()] });
    const view = await voice.endSession(db, { sessionId: SESSION, organizationId: ORG, userId: USER, reason: 'assistant', now });
    assert.equal(view.end_reason, 'assistant');
  }
  {
    const db = fakePrisma({ 'FROM rev_voice_sessions WHERE id': [activeRow({ status: 'ended', end_reason: 'hangup', seconds_used: 42 })] });
    const view = await voice.endSession(db, { sessionId: SESSION, organizationId: ORG, userId: USER, now });
    assert.equal(view.seconds_used, 42);
    assert.ok(!db.calls.some(c => c.kind === 'execute'), 'ending twice writes nothing');
  }

  // ── 5. Conversation excerpt for the voice model ──────────────────────────
  {
    const excerpt = voice.buildVoiceExcerpt([
      { role: 'user', content: { text: 'How did sales do last week?' } },
      { role: 'rev', content: { response_type: 'analysis', situation: 'Revenue was $12,400.', insight: { text: 'Up 8% week over week.' } } },
      { role: 'rev', content: { error: true }, has_error: true },
      { role: 'user', content: JSON.stringify({ text: 'And refunds?' }) },
      { role: 'rev', content: { response_type: 'conversational', text: 'Refunds were 3 orders.' } },
    ]);
    assert.equal(excerpt, [
      'Merchant: How did sales do last week?',
      'Rev: Revenue was $12,400. Up 8% week over week.',
      'Merchant: And refunds?',
      'Rev: Refunds were 3 orders.',
    ].join('\n'));
    const long = voice.buildVoiceExcerpt(Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'rev' : 'user', content: { text: `turn ${i} ${'x'.repeat(400)}` } })));
    assert.ok(long.length <= 4000);
    assert.match(long, /turn 39/, 'the newest turns survive trimming');
    assert.doesNotMatch(long, /turn 0 /);
    assert.equal(voice.buildVoiceExcerpt([]), '');
  }

  // ── 6. Calls are conversations: spoken lines are saved ───────────────────
  {
    const db = fakePrisma();
    const first = await voice.createCallConversation(db, { sessionId: SESSION, organizationId: ORG, userId: USER });
    const again = await voice.createCallConversation(fakePrisma(), { sessionId: SESSION, organizationId: ORG, userId: USER });
    assert.match(first, /^[0-9a-f-]{36}$/);
    assert.equal(first, again, 'one conversation per call, even when the request is retried');
    assert.match(db.calls[0].sql, /INSERT INTO conversations .* ON CONFLICT \(id\) DO NOTHING/);
    assert.ok(db.calls[0].values.includes(ORG) && db.calls[0].values.includes(USER));
    assert.match(db.calls[1].sql, /SET conversation_id = \?::uuid, owns_conversation = true/);
    assert.ok(db.calls[1].values.includes(ORG), 'only the organization\'s own session is updated');
  }
  {
    const db = fakePrisma();
    await voice.cleanupEmptyCallConversations(db, { organizationId: ORG, userId: USER });
    const sql = db.calls[0].sql;
    assert.match(sql, /s\.owns_conversation = true/, 'only conversations a call created');
    assert.match(sql, /s\.status = 'ended'/);
    assert.match(sql, /NOT EXISTS \(SELECT 1 FROM conversation_messages m WHERE m\.conversation_id = c\.id\)/, 'never one with messages');
    assert.match(sql, /live\.status = 'active'/, 'never one a live call is using');
    assert.match(sql, /c\.organization_id = \?::uuid/);
  }
  {
    const entries = voice.normaliseTranscriptEntries([
      { client_id: 't1-1', speaker: 'user', text: '  How did   sales do , last week ? ', spoken_at: '2026-11-18T22:29:00Z' },
      { client_id: 't1-2', speaker: 'rev', text: 'Let me check.', interrupted: true },
      { client_id: 't1-3', speaker: 'user', text: '   ' },
      { client_id: 't1-1', speaker: 'user', text: 'duplicate id' },
      { client_id: 't1-4', speaker: 'user', text: 'x'.repeat(5000), interrupted: true },
    ]);
    assert.equal(entries.length, 3, 'blank and repeated lines are dropped');
    assert.deepEqual(entries[0], { clientId: 't1-1', speaker: 'user', text: 'How did sales do, last week?',
      interrupted: false, spokenAt: '2026-11-18T22:29:00.000Z' });
    assert.equal(entries[1].interrupted, true);
    assert.equal(entries[2].interrupted, false, 'only Rev can be interrupted');
    assert.equal(entries[2].text.length, voice.MAX_TRANSCRIPT_TEXT);
    for (const bad of [
      'nope', [{ client_id: 'bad id!', speaker: 'user', text: 'x' }], [{ client_id: 'a', speaker: 'system', text: 'x' }],
      [null], Array.from({ length: voice.MAX_TRANSCRIPT_BATCH + 1 }, (_, i) => ({ client_id: `t${i}`, speaker: 'user', text: 'x' })),
    ]) {
      assert.throws(() => voice.normaliseTranscriptEntries(bad),
        (error) => error.statusCode === 400 && error.code === 'VOICE_INVALID_TRANSCRIPT');
    }
    assert.deepEqual(voice.normaliseTranscriptEntries(undefined), []);
  }
  {
    const CONV = '44444444-4444-4444-8444-444444444444';
    const session = activeRow({ conversation_id: CONV, owns_conversation: true });
    const entries = voice.normaliseTranscriptEntries([
      { client_id: 't1-1', speaker: 'user', text: 'How did sales do?' },
      { client_id: 't1-2', speaker: 'rev', text: 'Up 8 percent.', interrupted: true },
    ]);
    const db = fakePrisma({ 'SELECT 1 AS present FROM conversations': [{ present: 1 }] });
    const result = await voice.saveTranscript(db, { session, organizationId: ORG, userId: USER, entries, titleHint: 'Weekly sales check', now });
    assert.deepEqual(result, { saved: 2, conversationId: CONV });
    const sqls = db.calls.map(c => c.sql);
    assert.ok(sqls[0].includes('organization_id = ?::uuid') && db.calls[0].values.includes(ORG), 'the conversation must belong to the org');
    assert.match(sqls[1], /pg_advisory_xact_lock/, 'same single-writer lock as typed turns');
    const inserts = db.calls.filter(c => c.sql.startsWith('INSERT INTO conversation_messages'));
    assert.equal(inserts.length, 2);
    assert.match(inserts[0].sql, /COALESCE\(MAX\(sequence_number\), 0\) \+ 1/);
    assert.match(inserts[0].sql, /ON CONFLICT \(organization_id, conversation_id, role, correlation_id\) DO NOTHING/, 'resending a line is harmless');
    assert.ok(inserts[0].values.includes('user') && inserts[1].values.includes('rev'));
    const userContent = JSON.parse(inserts[0].values.find(v => typeof v === 'string' && v.includes('"text"')));
    assert.deepEqual(userContent, { text: 'How did sales do?', voice_transcript: true });
    const revMeta = JSON.parse(inserts[1].values.find(v => typeof v === 'string' && v.includes('voice_kind')));
    assert.equal(revMeta.voice_kind, 'transcript');
    assert.equal(revMeta.input_mode, 'voice');
    assert.equal(revMeta.voice_client_id, 't1-2');
    assert.equal(revMeta.interrupted, true);
    // Correlation ids are deterministic per (call, line) so a retry dedupes.
    const replay = fakePrisma({ 'SELECT 1 AS present FROM conversations': [{ present: 1 }] });
    await voice.saveTranscript(replay, { session, organizationId: ORG, userId: USER, entries, now });
    const ids = (calls) => calls.filter(c => c.sql.startsWith('INSERT INTO conversation_messages'))
      .map(c => c.values.find((v, i) => i > 4 && typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v) && v !== CONV && v !== ORG && v !== USER));
    assert.deepEqual(ids(replay.calls), ids(db.calls));
    const touch = db.calls.find(c => c.sql.startsWith('UPDATE conversations'));
    assert.match(touch.sql, /last_activity_at = NOW\(\)/, 'the call moves to the top of history');
    assert.ok(touch.values.includes(2) && touch.values.includes('Weekly sales check'));
  }
  {
    const CONV = '44444444-4444-4444-8444-444444444444';
    const entries = voice.normaliseTranscriptEntries([{ client_id: 'a', speaker: 'user', text: 'hello' }]);
    await assert.rejects(voice.saveTranscript(fakePrisma(), {
      session: activeRow({ conversation_id: null }), organizationId: ORG, userId: USER, entries, now,
    }), (error) => error.statusCode === 409 && error.code === 'VOICE_CONVERSATION_GONE');
    await assert.rejects(voice.saveTranscript(fakePrisma(), {
      session: activeRow({ conversation_id: CONV }), organizationId: ORG, userId: USER, entries, now,
    }), (error) => error.code === 'VOICE_CONVERSATION_GONE', 'a deleted or foreign conversation is refused');
    await assert.rejects(voice.saveTranscript(fakePrisma({ 'SELECT 1 AS present FROM conversations': [{ present: 1 }] }), {
      session: activeRow({ conversation_id: CONV, status: 'ended', ended_at: new Date(now.getTime() - voice.TRANSCRIPT_GRACE_MS - 1000) }),
      organizationId: ORG, userId: USER, entries, now,
    }), (error) => error.statusCode === 409 && error.code === 'VOICE_SESSION_CLOSED');
    const late = await voice.saveTranscript(fakePrisma({ 'SELECT 1 AS present FROM conversations': [{ present: 1 }] }), {
      session: activeRow({ conversation_id: CONV, status: 'ended', ended_at: new Date(now.getTime() - 5000) }),
      organizationId: ORG, userId: USER, entries, now,
    });
    assert.equal(late.saved, 1, 'lines that finish while hanging up are still saved');
    const none = await voice.saveTranscript(fakePrisma(), { session: activeRow({ conversation_id: CONV }), organizationId: ORG, userId: USER, entries: [], now });
    assert.deepEqual(none, { saved: 0, conversationId: CONV });
  }

  // ── 7. Wiring ─────────────────────────────────────────────────────────────
  const route = fs.readFileSync(path.join(__dirname, '../route/revRoute.js'), 'utf8');
  assert.match(route, /router\.post\('\/live\/session',\s*authenticateToken, voiceStartLimiter,\s*revController\.startVoiceSession\)/);
  assert.match(route, /router\.post\('\/live\/session\/:id\/heartbeat',\s*authenticateToken, voiceSessionLimiter, revController\.voiceSessionHeartbeat\)/);
  assert.match(route, /router\.post\('\/live\/session\/:id\/end',\s*authenticateToken, voiceSessionLimiter,\s*revController\.endVoiceSession\)/);
  assert.match(route, /router\.post\('\/live\/session\/:id\/transcript',\s*authenticateToken, voiceTranscriptLimiter, revController\.saveVoiceTranscript\)/);
  assert.match(route, /router\.get\('\/live\/allowance',\s*authenticateToken, voiceSessionLimiter, revController\.getVoiceAllowance\)/);
  const controller = fs.readFileSync(path.join(__dirname, '../controller/revController.js'), 'utf8');
  assert.match(controller, /mlService\.mintLiveToken\(/);
  assert.match(controller, /reason: 'unavailable'/, 'a failed mint releases the reserved call');
  assert.match(controller, /inputMode: validated\.inputMode/);
  assert.match(controller, /revVoice\.createCallConversation\(/, 'a call outside a conversation gets one');
  assert.match(controller, /conversation_id: callConversationId/);
  assert.doesNotMatch(controller.slice(controller.indexOf('function _voiceCounters'), controller.indexOf('async function _saveVoiceTranscript')),
    /conversation_id/, 'the browser cannot choose the call\'s conversation after it starts');
  assert.equal((controller.match(/cm\.metadata->>'voice_client_id' AS voice_client_id/g) || []).length, 3, 'every history page says which rows were spoken');
  const retry = controller.slice(controller.indexOf('exports.retryConversation'));
  assert.equal((retry.match(/<> 'transcript'/g) || []).length, 2, 'retry ignores spoken lines');
  const ownership = fs.readFileSync(path.join(__dirname,
    '../../prisma/migrations/20261203000000_rev_voice_session_conversation/migration.sql'), 'utf8').replace(/--[^\n]*/g, '');
  assert.match(ownership, /ADD COLUMN IF NOT EXISTS owns_conversation boolean NOT NULL DEFAULT false/);
  assert.doesNotMatch(ownership, /\bDROP\b|\bGRANT\b|CREATE POLICY/i, 'additive only');
  const migration = fs.readFileSync(path.join(__dirname,
    '../../prisma/migrations/20261201000000_rev_voice_sessions/migration.sql'), 'utf8');
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  const sql = migration.replace(/--[^\n]*/g, '');
  assert.doesNotMatch(sql, /\bGRANT\b|CREATE POLICY|\bDROP\b|ALTER TABLE (?!rev_voice_sessions)/i, 'additive and service-role only');
  assert.match(sql, /REVOKE ALL ON TABLE rev_voice_sessions FROM %I/);
  const ml = require('../services/mlService');
  assert.equal(typeof ml.mintLiveToken, 'function');

  console.log('revVoiceSessions tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
