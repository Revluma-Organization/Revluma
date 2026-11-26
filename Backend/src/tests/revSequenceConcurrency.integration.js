'use strict';
// C2 single-writer concurrency proof against real PostgreSQL.
//
// Requires a disposable local database (never production); runs in the
// release-candidate workflow, not in `npm test`:
//   RELEASE_CANDIDATE_ISOLATED_DB=true node src/tests/revSequenceConcurrency.integration.js
//
// The release-candidate bootstrap creates uq_conversation_message_sequence
// from the Prisma schema, so these scenarios race against the REAL unique
// backstop: eight parallel acceptSubmission calls, eight parallel rev-row
// inserts through the REAL shipped _insertRevMessage source (sliced and
// evaluated like revPersistence.contract.test.js does, but with the real
// Prisma client), and a mixed race. Every scenario must finish with distinct,
// gapless sequence numbers and no surfaced 23505.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../configs/database');
const { acceptSubmission } = require('../services/revSubmission');
const revSequence = require('../services/revSequence');

const url = String(process.env.DATABASE_URL || '');
if (process.env.RELEASE_CANDIDATE_ISOLATED_DB !== 'true' || !/@127\.0\.0\.1:5432\/revluma_rc\b/.test(url)) {
  throw new Error('Disposable localhost revluma_rc PostgreSQL and explicit opt-in required');
}

// C2_SCENARIOS filters to a comma-separated subset of scenario indices
// (absent = all). CI runs cumulative prefixes in separate steps so a failure
// is attributable without reading logs; local runs keep the full sequence.
const wantedScenarios = String(process.env.C2_SCENARIOS || '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);
let nextScenarioIndex = 0;
// C2_PARALLEL scales the race width (default 8). CI bisects with 1 before 8.
const raceWidth = Math.max(1, parseInt(process.env.C2_PARALLEL || '8', 10) || 8);
const expectedSequences = (start, count) =>
  Array.from({ length: count }, (_, index) => start + index);

const results = [];
function record(name, fn) {
  const index = nextScenarioIndex;
  nextScenarioIndex += 1;
  if (wantedScenarios.length > 0 && !wantedScenarios.includes(String(index))) {
    results.push({ name, ok: true, skipped: true });
    return Promise.resolve();
  }
  return Promise.resolve()
    .then(fn)
    .then(() => results.push({ name, ok: true }))
    .catch((error) => results.push({ name, ok: false, error }));
}

// The REAL _insertRevMessage, evaluated with the REAL Prisma client. Any
// rename or signature drift fails here exactly as in the contract test.
function loadInsertRevMessage() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'controller', 'revController.js'), 'utf8');
  const constMatch = source.match(/const MAX_PERSISTED_EVIDENCE_ITEMS = (\d+);/);
  assert.ok(constMatch, 'MAX_PERSISTED_EVIDENCE_ITEMS constant must exist');
  const helpersStart = source.indexOf('function _boundedResultForPersistence');
  const insertStart = source.indexOf('async function _insertRevMessage');
  const insertEnd = source.indexOf('async function _persistFindingContext', insertStart);
  assert.ok(helpersStart > 0 && insertStart > helpersStart && insertEnd > insertStart,
    'persistence helpers must exist in revController');
  const context = {
    MAX_PERSISTED_EVIDENCE_ITEMS: Number(constMatch[1]),
    prisma,
    revSequence,
    uuidv4,
    exports: {},
  };
  vm.createContext(context);
  vm.runInContext(source.slice(helpersStart, insertStart), context);
  return vm.runInContext(`${source.slice(insertStart, insertEnd)}; _insertRevMessage;`, context);
}

// Prisma raw execution is single-statement: strip comment lines (which may
// carry semicolons) and run each ;-separated chunk on its own. None of the C2
// SQL files contain a semicolon inside a string literal.
function splitSqlStatements(sql) {
  const withoutComments = sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
  return withoutComments.split(';').map((chunk) => chunk.trim()).filter(Boolean);
}

async function executeSqlStatements(sql) {
  const affected = [];
  for (const chunk of splitSqlStatements(sql)) {
    affected.push(await prisma.$executeRawUnsafe(chunk));
  }
  return affected;
}

async function sequencesOf(conversationId) {
  const rows = await prisma.$queryRaw`
    SELECT sequence_number FROM conversation_messages
    WHERE conversation_id = ${conversationId}::uuid
    ORDER BY sequence_number ASC
  `;
  return rows.map((row) => row.sequence_number);
}

async function main() {
  const suffix = randomUUID().slice(0, 8);
  const userId = randomUUID();
  const orgId = randomUUID();
  const convId = randomUUID();
  const insertRevMessage = loadInsertRevMessage();

  await prisma.users.create({
    data: { id: userId, full_name: 'RC C2', email: `rc-c2-${suffix}@example.invalid`, password_hash: 'x' },
  });
  await prisma.organizations.create({
    data: { id: orgId, owner_id: userId, company_name: `RC C2 ${suffix}`, slug: `rc-c2-${suffix}`, industry: 'test', country: 'NG' },
  });
  await prisma.conversations.create({ data: { id: convId, organization_id: orgId, user_id: userId } });

  try {
    await record('the unique backstop exists before the races start', async () => {
      const rows = await prisma.$queryRaw`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'conversation_messages' AND indexname = 'uq_conversation_message_sequence'
      `;
      assert.equal(rows.length, 1, 'RC bootstrap must create the C2 backstop from the schema');
    });

    await record('parallel accepts all complete without duplicates', async () => {
      const outcomes = await Promise.all(Array.from({ length: raceWidth }, (_, index) => acceptSubmission({
        prisma,
        organizationId: orgId,
        userId,
        message: `concurrent question ${index}`,
        requestId: randomUUID(),
        requestedConversationId: convId,
      })));
      assert.equal(outcomes.every((outcome) => outcome.duplicate === false), true);
    });

    await record('accepted sequences are contiguous from 1', async () => {
      assert.deepEqual(await sequencesOf(convId), expectedSequences(1, raceWidth));
    });

    await record('parallel rev inserts allocate distinct gapless sequences', async () => {
      await Promise.all(Array.from({ length: raceWidth }, (_, index) => {
        const correlationId = randomUUID();
        return insertRevMessage({
          organizationId: orgId,
          userId,
          conversationId: convId,
          correlationId,
          content: {
            response_type: 'chat', text: `concurrent answer ${index}`,
            correlation_id: correlationId, execution_id: randomUUID(), read_only: true,
          },
        });
      }));
      assert.deepEqual(await sequencesOf(convId), expectedSequences(1, raceWidth * 2));
    });

    await record('a mixed accept/rev race allocates distinct gapless sequences', async () => {
      const accepts = Array.from({ length: 4 }, (_, index) => acceptSubmission({
        prisma, organizationId: orgId, userId,
        message: `mixed question ${index}`, requestId: randomUUID(), requestedConversationId: convId,
      }));
      const revs = Array.from({ length: 4 }, (_, index) => {
        const correlationId = randomUUID();
        return insertRevMessage({
          organizationId: orgId, userId, conversationId: convId, correlationId,
          content: {
            response_type: 'chat', text: `mixed answer ${index}`,
            correlation_id: correlationId, execution_id: randomUUID(), read_only: true,
          },
        });
      });
      await Promise.all([...accepts, ...revs]);
      assert.deepEqual(await sequencesOf(convId), expectedSequences(1, raceWidth * 2 + 8));
    });

    await record('the tuple predicate shape works through Prisma-bound parameters', async () => {
      const top = await prisma.$queryRaw`
        SELECT id, sequence_number FROM conversation_messages
        WHERE conversation_id = ${convId}::uuid
        ORDER BY sequence_number DESC, id DESC
        LIMIT 1
      `;
      assert.equal(top.length, 1);
      const maxSeq = top[0].sequence_number;
      // The exact row-constructor shape getConversation uses for before_id.
      const page = await prisma.$queryRaw`
        SELECT sequence_number FROM conversation_messages
        WHERE conversation_id = ${convId}::uuid
          AND (sequence_number, id) < (${top[0].sequence_number}, ${top[0].id}::uuid)
        ORDER BY sequence_number DESC, id DESC
        LIMIT 5
      `;
      assert.deepEqual(
        page.map((row) => row.sequence_number),
        [maxSeq - 1, maxSeq - 2, maxSeq - 3, maxSeq - 4, maxSeq - 5],
      );
    });

    await record('repair.sql is valid and a no-op on race-free data', async () => {
      const repairFile = fs.readFileSync(
        path.join(__dirname, '..', '..', 'prisma', 'migrations-pending',
          '20261126000000_c2_conversation_message_sequence', 'repair.sql'),
        'utf8',
      );
      const updateOnly = repairFile.slice(0, repairFile.indexOf('-- Verification'));
      const affected = await executeSqlStatements(updateOnly);
      assert.equal(affected.length, 1, 'repair.sql must hold exactly one UPDATE before its verification SELECT');
      // eslint-disable-next-line no-console
      console.log(`repair.sql affected ${Number(affected[0])} row(s) database-wide`);
      const ties = await prisma.$queryRaw`
        SELECT COUNT(*) AS tied FROM (
          SELECT sequence_number FROM conversation_messages
          WHERE conversation_id = ${convId}::uuid
          GROUP BY sequence_number HAVING COUNT(*) > 1
        ) t
      `;
      assert.equal(Number(ties[0].tied), 0);
    });

    await record('migration.sql applies idempotently on top of the bootstrapped schema', async () => {
      const migrationFile = fs.readFileSync(
        path.join(__dirname, '..', '..', 'prisma', 'migrations-pending',
          '20261126000000_c2_conversation_message_sequence', 'migration.sql'),
        'utf8',
      );
      const affected = await executeSqlStatements(migrationFile);
      assert.equal(affected.length, 1, 'migration.sql must hold exactly one statement');
    });

    await record('rollback.sql drops and migration.sql re-creates the backstop', async () => {
      const pending = path.join(__dirname, '..', '..', 'prisma', 'migrations-pending',
        '20261126000000_c2_conversation_message_sequence');
      const rollbackFile = fs.readFileSync(path.join(pending, 'rollback.sql'), 'utf8');
      const migrationFile = fs.readFileSync(path.join(pending, 'migration.sql'), 'utf8');
      try {
        const chunks = await executeSqlStatements(rollbackFile);
        assert.equal(chunks.length, 2, 'rollback.sql must drop both backstop shapes');
        const dropped = await prisma.$queryRaw`
          SELECT indexname FROM pg_indexes
          WHERE tablename = 'conversation_messages' AND indexname = 'uq_conversation_message_sequence'
        `;
        assert.equal(dropped.length, 0, 'rollback must drop the backstop');
      } finally {
        await executeSqlStatements(migrationFile);
      }
      const restored = await prisma.$queryRaw`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'conversation_messages' AND indexname = 'uq_conversation_message_sequence'
      `;
      assert.equal(restored.length, 1, 'the backstop must be restored after the round-trip');
    });
  } finally {
    await prisma.conversation_messages.deleteMany({ where: { conversation_id: convId } });
    await prisma.conversations.delete({ where: { id: convId } });
    await prisma.organizations.delete({ where: { id: orgId } });
    await prisma.users.delete({ where: { id: userId } });
    await prisma.$disconnect();
  }

  const failed = results.filter((result) => !result.ok);
  for (const result of results) {
    // eslint-disable-next-line no-console
    console.log(`${result.ok ? 'ok' : 'NOT OK'} - ${result.name}${result.skipped ? ' (skipped)' : ''}`);
    if (!result.ok) console.error(result.error);
  }
  if (failed.length > 0) {
    throw new Error(`${failed.length} rev sequence concurrency scenario(s) failed`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
