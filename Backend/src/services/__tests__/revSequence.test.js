const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LOCK_NAMESPACE,
  MAX_ALLOCATION_ATTEMPTS,
  acquireConversationWriteLock,
  isUniqueViolation,
  withSequenceAllocationRetry,
} = require('../revSequence');

// ── C2: per-conversation write lock ──────────────────────────────────────────

test('the write lock is transaction-scoped, namespaced and conversation-keyed', async () => {
  const calls = [];
  const tx = {
    $queryRaw: async (strings, ...values) => { calls.push({ sql: strings.join('?'), values }); return []; },
  };
  await acquireConversationWriteLock(tx, '44444444-4444-4444-8444-444444444444');
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /pg_advisory_xact_lock/);
  assert.match(calls[0].sql, /::text AS lock_acquired/,
    'the void lock result must be selected as text: Prisma cannot deserialize bare void');
  assert.equal(calls[0].values.includes(LOCK_NAMESPACE), true);
  assert.equal(calls[0].values.includes('44444444-4444-4444-8444-444444444444'), true);
});

test('distinct conversations take distinct locks', async () => {
  const seen = [];
  const tx = {
    $queryRaw: async (strings, ...values) => { seen.push(values); return []; },
  };
  await acquireConversationWriteLock(tx, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  await acquireConversationWriteLock(tx, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  assert.notDeepEqual(seen[0], seen[1]);
});

// ── C2: unique-violation detection across driver shapes ──────────────────────

for (const [name, error, expected] of [
  ['Prisma P2002 code', Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }), true],
  ['raw 23505 code', Object.assign(new Error('duplicate key'), { code: '23505' }), true],
  ['23505 inside a raw message', new Error('Raw query failed. Code: `23505`. Message: `duplicate key value violates unique constraint \"uq_x\"`'), true],
  ['duplicate-key wording', new Error('duplicate key value violates unique constraint'), true],
  ['null error', null, false],
  ['plain error', new Error('message insert failed'), false],
  ['connection error', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }), false],
  ['submission error', Object.assign(new Error('nope'), { code: 'REQUEST_ID_REUSED', statusCode: 409 }), false],
]) test(`detects ${name} as unique violation: ${expected}`, () => {
  assert.equal(isUniqueViolation(error), expected);
});

// ── C2: bounded allocation retry ─────────────────────────────────────────────

test('a first-attempt success runs the operation once', async () => {
  let runs = 0;
  const result = await withSequenceAllocationRetry(async () => { runs += 1; return 'ok'; });
  assert.equal(result, 'ok');
  assert.equal(runs, 1);
});

test('a transient unique violation retries and then succeeds', async () => {
  let runs = 0;
  const result = await withSequenceAllocationRetry(async () => {
    runs += 1;
    if (runs === 1) throw Object.assign(new Error('duplicate key'), { code: '23505' });
    return 'recovered';
  });
  assert.equal(result, 'recovered');
  assert.equal(runs, 2);
});

test('a persistent unique violation retries bounded times then rethrows', async () => {
  let runs = 0;
  await assert.rejects(
    withSequenceAllocationRetry(async () => {
      runs += 1;
      throw Object.assign(new Error('duplicate key'), { code: '23505' });
    }),
    /duplicate key/,
  );
  assert.equal(runs, MAX_ALLOCATION_ATTEMPTS);
});

test('a non-unique error is never retried', async () => {
  let runs = 0;
  await assert.rejects(
    withSequenceAllocationRetry(async () => { runs += 1; throw new Error('message insert failed'); }),
    /message insert failed/,
  );
  assert.equal(runs, 1);
});
