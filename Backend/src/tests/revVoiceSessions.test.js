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
  return { calls, $queryRaw: run('query'), $executeRaw: run('execute') };
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
    assert.match(order[2], /SUM/);
    assert.ok(db.calls[2].values.some(v => v instanceof Date && v.toISOString() === '2026-11-18T00:00:00.000Z'),
      'usage is counted from midnight UTC');
    assert.match(order[3], /INSERT INTO rev_voice_sessions/);
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

  // ── 6. Wiring ─────────────────────────────────────────────────────────────
  const route = fs.readFileSync(path.join(__dirname, '../route/revRoute.js'), 'utf8');
  assert.match(route, /router\.post\('\/live\/session',\s*authenticateToken, voiceStartLimiter,\s*revController\.startVoiceSession\)/);
  assert.match(route, /router\.post\('\/live\/session\/:id\/heartbeat',\s*authenticateToken, voiceSessionLimiter, revController\.voiceSessionHeartbeat\)/);
  assert.match(route, /router\.post\('\/live\/session\/:id\/end',\s*authenticateToken, voiceSessionLimiter,\s*revController\.endVoiceSession\)/);
  assert.match(route, /router\.get\('\/live\/allowance',\s*authenticateToken, voiceSessionLimiter, revController\.getVoiceAllowance\)/);
  const controller = fs.readFileSync(path.join(__dirname, '../controller/revController.js'), 'utf8');
  assert.match(controller, /mlService\.mintLiveToken\(/);
  assert.match(controller, /reason: 'unavailable'/, 'a failed mint releases the reserved call');
  assert.match(controller, /inputMode: validated\.inputMode/);
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
