'use strict';

// Production hardening Phase 5 — churn queue observability.
//
// The eleven-customer churn failure storm stayed invisible for days because
// the queue coordinated through a Redis lock that left no persistent trace:
// "did churn run, and did it fail?" was only answerable from Render logs.
// runChurnQueue now claims the Postgres job lock and writes its outcome to
// automation_job_state, so a failed pass is stored as failed/partial with
// structured counters — exactly like the business-state rebuild.

// The scheduler's require chain loads encryption.js, which validates the key
// format at import time. A syntactically valid dummy is enough: nothing in
// this test encrypts or decrypts.
process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY ||= '0'.repeat(64);

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const servicesDir = path.join(__dirname, '..');

function stubModule(requestPath, exports) {
  const resolved = require.resolve(path.join(servicesDir, requestPath));
  require.cache[resolved] = {
    id: resolved, filename: resolved, loaded: true, exports, children: [], paths: [],
  };
}

const rawCalls = [];
const upserts = [];

const prisma = {
  automation_job_state: {
    upsert: async (args) => { upserts.push(args); },
    update: async () => ({}),
  },
  // Tagged-template raw queries: record the interpolated values and report
  // success (1 row) so acquire/release both proceed.
  $executeRaw: (strings, ...values) => { rawCalls.push(values); return Promise.resolve(1); },
  $queryRaw: (strings, ...values) => Promise.resolve([]),
  customers: { findMany: async () => [] },
  stores: { findMany: async () => [] },
  organizations: { findMany: async () => [] },
};

stubModule('../configs/database', { prisma });
stubModule('./churnWorkerService', {
  runDailyChurnScoring: async () => ({ processed: 2, failed: 1 }),
});
stubModule('../utils/logger', { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} });

const { runChurnQueue } = require('../schedulerService');
const { deriveJobStatus } = require('../schedulerLocks');

test('a churn pass is claimed and released in automation_job_state', async () => {
  await runChurnQueue();

  // The job row is ensured under the persistent job name.
  assert.ok(upserts.some((call) => call?.where?.job_name === 'daily-churn'),
    'daily-churn job row was not ensured');

  // The release wrote the derived status and structured counters.
  const releaseCall = rawCalls.find((values) => values.includes('partial'));
  assert.ok(releaseCall, `expected a partial-status release, saw: ${JSON.stringify(rawCalls)}`);
  const resultJson = releaseCall.find((value) => typeof value === 'string' && value.includes('"job"'));
  const stored = JSON.parse(resultJson);
  assert.equal(stored.job, 'daily-churn');
  assert.equal(stored.succeeded, 2);
  assert.equal(stored.failed, 1);
  assert.ok(Number.isFinite(stored.latency_ms));
});

test('mixed churn outcomes derive partial, total failures derive failed', () => {
  assert.equal(deriveJobStatus({ succeeded: 2, failed: 1 }), 'partial');
  assert.equal(deriveJobStatus({ succeeded: 0, failed: 11 }), 'failed');
  assert.equal(deriveJobStatus({ succeeded: 5, failed: 0 }), 'completed');
});
