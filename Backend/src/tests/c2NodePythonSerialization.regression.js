'use strict';
// C2 Node/Python common-serialization regression proof against real PostgreSQL.
//
// Requires a disposable local database (never production); runs in the
// release-candidate workflow, not in `npm test` (findTests only picks up
// `*.test.js`):
//   RELEASE_CANDIDATE_ISOLATED_DB=true node src/tests/c2NodePythonSerialization.regression.js
//
// Part A (no database): cross-runtime contract — the namespace and key
// expression in Python `_persist_messages` must be identical to Node's
// `revSequence` lock, and the lock must precede the FOR UPDATE base read.
// Part B (disposable localhost PG only): two-session mutual exclusion — a
// Node-style holder blocks a Python-style allocator and vice versa; a
// non-cooperating duplicate then fails closed on the unique backstop.
//
// Until the specified Python change lands, Part A fails with a pointer to the
// spec (red-before). Part B additionally requires the Python statement shape
// below; it mirrors the specified diff verbatim.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const repoRoot = path.join(__dirname, '..', '..', '..');
const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

// ── Part A: cross-runtime lock contract (no database) ───────────────────────
function partA() {
  const revSequenceSource = fs.readFileSync(
    path.join(repoRoot, 'Backend', 'src', 'services', 'revSequence.js'), 'utf8');
  const namespaceMatch = revSequenceSource.match(/const LOCK_NAMESPACE = '([^']+)'/);
  assert.ok(namespaceMatch, 'Node LOCK_NAMESPACE must exist');
  const namespace = namespaceMatch[1];
  assert.match(revSequenceSource,
    /pg_advisory_xact_lock\(hashtext\(\$\{LOCK_NAMESPACE\}\)|pg_advisory_xact_lock\(hashtext\('rev_conversation_sequence'\)/,
    'Node lock shape changed — update this contract test');

  const orchestratorPath = path.join(repoRoot, 'python', 'src', 'agents', 'orchestrator.py');
  const orchestratorSource = fs.readFileSync(orchestratorPath, 'utf8');
  const persistStart = orchestratorSource.indexOf('def _persist_messages(');
  assert.ok(persistStart > 0, '_persist_messages must exist in orchestrator.py');
  const nextDef = orchestratorSource.indexOf('\ndef ', persistStart + 1);
  const persistBody = orchestratorSource.slice(persistStart, nextDef > 0 ? nextDef : undefined);

  const lockPattern = new RegExp(
    `pg_advisory_xact_lock\\(\\s*hashtext\\(\\s*'${namespace}'\\s*\\)`);
  const lockIndex = persistBody.search(lockPattern);
  record('A1 python persist takes node advisory lock (same namespace)',
    lockIndex >= 0,
    lockIndex >= 0 ? `namespace='${namespace}'` : 'NOT IMPLEMENTED — see C2-APPROVAL-PACKAGE §1 spec');
  const forUpdateIndex = persistBody.indexOf('FOR UPDATE');
  record('A2 lock precedes FOR UPDATE base read (same transaction)',
    lockIndex >= 0 && forUpdateIndex > lockIndex,
    lockIndex >= 0 ? `lock@${lockIndex} < for_update@${forUpdateIndex}` : 'no lock statement found');
  return results.every((r) => r.ok);
}

// ── Part B: two-session mutual exclusion (disposable localhost PG) ──────────
// Mirrors the specified Python statement verbatim (SQLAlchemy text() form):
//   SELECT pg_advisory_xact_lock(hashtext('rev_conversation_sequence'),
//                                hashtext(CAST(:c AS text)))
async function partB() {
  const url = String(process.env.DATABASE_URL || '');
  if (process.env.RELEASE_CANDIDATE_ISOLATED_DB !== 'true' || !/@127\.0\.0\.1:5432\/revluma_rc\b/.test(url)) {
    throw new Error('Disposable localhost revluma_rc PostgreSQL and explicit opt-in required');
  }
  // Required lazily so Part A runs without a database client.
  const { prisma } = require('../configs/database');
  const revSequence = require('../services/revSequence');

  const orgId = randomUUID();
  const userId = randomUUID();
  const convId = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO conversations (id, organization_id, user_id, status, message_count, last_activity_at)
    VALUES (${convId}::uuid, ${orgId}::uuid, ${userId}::uuid, 'active', 1, NOW())`;
  await prisma.$executeRaw`
    INSERT INTO conversation_messages (id, conversation_id, organization_id, user_id, role, content, sequence_number)
    VALUES (${randomUUID()}::uuid, ${convId}::uuid, ${orgId}::uuid, ${userId}::uuid,
      'user', '{"text":"seed"}'::jsonb, 1)`;

  const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
  const txOptions = { maxWait: 15000, timeout: 60000 };
  // The specified Python persist sequence, executed from a second session:
  // advisory lock (same key domain as Node) -> FOR UPDATE base read -> insert.
  const pythonPersistSequence = async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext('rev_conversation_sequence'),
        hashtext(${convId}::text))::text AS lock_acquired`;
    const base = await tx.$queryRaw`
      SELECT message_count FROM conversations WHERE id = ${convId}::uuid FOR UPDATE`;
    const baseSeq = Number(base[0].message_count);
    await tx.$executeRaw`
      INSERT INTO conversation_messages (id, conversation_id, organization_id, user_id, role, content, sequence_number)
      VALUES (${randomUUID()}::uuid, ${convId}::uuid, ${orgId}::uuid, ${userId}::uuid,
        'rev', '{"text":"python-turn"}'::jsonb, ${baseSeq + 1})`;
    await tx.$executeRaw`
      UPDATE conversations SET message_count = ${baseSeq + 1} WHERE id = ${convId}::uuid`;
    return baseSeq + 1;
  };

  // B1: Node holder blocks the Python-style allocator until commit.
  let holderEntered = false;
  let holderRelease = false;
  const holder = prisma.$transaction(async (txA) => {
    await revSequence.acquireConversationWriteLock(txA, convId);
    holderEntered = true;
    const deadline = Date.now() + 10000;
    while (!holderRelease && Date.now() < deadline) await sleep(50);
    assert.ok(holderRelease, 'allocator never attempted while the lock was held');
  }, txOptions);
  while (!holderEntered) await sleep(50);
  let blockedError = null;
  try {
    await prisma.$transaction(async (txB) => {
      await txB.$executeRaw`SET LOCAL statement_timeout = '2s'`;
      await pythonPersistSequence(txB);
    }, txOptions);
  } catch (error) {
    blockedError = error;
  } finally {
    holderRelease = true;
  }
  await holder;
  record('B1 node holder blocks python-style allocator',
    Boolean(blockedError) && /statement timeout|canceling statement|57014/i.test(String(blockedError?.message || '')),
    blockedError ? String(blockedError.message || blockedError).slice(0, 120) : 'allocator was NOT blocked');

  // B2: after release, the allocator proceeds and takes MAX+1 (== 2).
  const allocated = await prisma.$transaction(pythonPersistSequence, txOptions);
  record('B2 allocator proceeds after release with MAX+1', allocated === 2, `allocated=${allocated}`);

  // B3: reverse direction — Python-order holder blocks a Node allocator.
  holderEntered = false;
  holderRelease = false;
  const pythonHolder = prisma.$transaction(async (txB) => {
    await txB.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext('rev_conversation_sequence'),
        hashtext(${convId}::text))::text AS lock_acquired`;
    holderEntered = true;
    const deadline = Date.now() + 10000;
    while (!holderRelease && Date.now() < deadline) await sleep(50);
    assert.ok(holderRelease, 'node allocator never attempted while the lock was held');
  }, txOptions);
  while (!holderEntered) await sleep(50);
  let reverseBlockedError = null;
  try {
    await prisma.$transaction(async (txA) => {
      await txA.$executeRaw`SET LOCAL statement_timeout = '2s'`;
      await revSequence.acquireConversationWriteLock(txA, convId);
    }, txOptions);
  } catch (error) {
    reverseBlockedError = error;
  } finally {
    holderRelease = true;
  }
  await pythonHolder;
  record('B3 python-order holder blocks node allocator',
    Boolean(reverseBlockedError) && /statement timeout|canceling statement|57014/i.test(String(reverseBlockedError?.message || '')),
    reverseBlockedError ? String(reverseBlockedError.message || reverseBlockedError).slice(0, 120) : 'node was NOT blocked');

  // B4: a non-cooperating duplicate fails closed on the unique backstop
  // (the RC bootstrap creates uq_conversation_message_sequence from schema).
  let backstopError = null;
  try {
    await prisma.$executeRaw`
      INSERT INTO conversation_messages (id, conversation_id, organization_id, user_id, role, content, sequence_number)
      VALUES (${randomUUID()}::uuid, ${convId}::uuid, ${orgId}::uuid, ${userId}::uuid,
        'rev', '{"text":"rogue"}'::jsonb, 2)`;
  } catch (error) {
    backstopError = error;
  }
  record('B4 non-cooperating duplicate rejected by unique backstop',
    revSequence.isUniqueViolation(backstopError),
    backstopError ? `code=${backstopError.code || 'n/a'}` : 'duplicate was NOT rejected');
  const finalSeqs = await prisma.$queryRaw`
    SELECT sequence_number FROM conversation_messages
    WHERE conversation_id = ${convId}::uuid ORDER BY sequence_number`;
  record('B5 conversation holds distinct sequences 1,2',
    finalSeqs.map((r) => Number(r.sequence_number)).join(',') === '1,2',
    JSON.stringify(finalSeqs.map((r) => Number(r.sequence_number))));

  await prisma.$disconnect();
  return results.every((r) => r.ok);
}

async function main() {
  const contractOk = partA();
  if (process.env.RELEASE_CANDIDATE_ISOLATED_DB !== 'true') {
    console.log('SKIP Part B (no RC opt-in): set RELEASE_CANDIDATE_ISOLATED_DB=true with disposable localhost revluma_rc to run the live two-session proof.');
    if (!contractOk) {
      console.error('Part A RED: Python serialization not implemented — see C2-APPROVAL-PACKAGE §1 for the specified diff.');
      process.exitCode = 1;
      return;
    }
    return;
  }
  if (!contractOk) {
    console.error('Part A RED: refusing Part B until the Python lock is implemented.');
    process.exitCode = 1;
    return;
  }
  const liveOk = await partB();
  if (!liveOk) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
});
