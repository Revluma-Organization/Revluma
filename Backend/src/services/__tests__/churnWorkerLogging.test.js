'use strict';

// Production hardening Phase 5: churn failure logs must never carry raw
// shopper UUIDs (merchant-customer PII), and must still distinguish an
// outage from a contract rejection. The worker keeps its self-healing
// behaviour: a failed customer keeps a stale churn_scored_at and is retried
// by the next hourly run.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');

const servicesDir = path.join(__dirname, '..');

function stubModule(requestPath, exports) {
  const resolved = require.resolve(path.join(servicesDir, requestPath));
  require.cache[resolved] = {
    id: resolved, filename: resolved, loaded: true, exports, children: [], paths: [],
  };
}

const CUSTOMER_ID = 'c1a2b3c4-d5e6-4f70-8192-a3b4c5d6e7f8';
const STORE_ID = '3ed79446-0000-4000-8000-000000000001';
const ORG_ID = '1dc6aa19-0000-4000-8000-000000000002';

const warnings = [];
const emptyFindMany = async () => [];

stubModule('../configs/database', {
  prisma: {
    customers: {
      findMany: async () => ([{
        id: CUSTOMER_ID,
        store_id: STORE_ID,
        organization_id: ORG_ID,
        status: 'active',
        orders_count: 2,
        consent_email: true,
        stores: { id: STORE_ID, organization_id: ORG_ID },
      }]),
      updateMany: async () => ({ count: 0 }),
    },
    orders: { findMany: emptyFindMany },
    events: { findMany: emptyFindMany },
    sequence_sends: { findMany: emptyFindMany },
    churn_training_observations: { create: async () => ({}) },
  },
});
stubModule('./mlService', {
  // Provider outage: the exact shape mlService returns when Python is down.
  predictChurnRisk: async () => ({ success: false, error: { code: 'UNAVAILABLE', message: 'Rev is unavailable.' } }),
});
stubModule('../utils/logger', {
  warn: (event, payload) => warnings.push([event, payload]),
  info: () => {},
  error: () => {},
});
stubModule('./financialIntegrity', {
  verifiedCustomerLifetimeValue: () => ({ value: null, currency: null, mixed: false, verified: false }),
});

const { runDailyChurnScoring } = require('../churnWorkerService');

test('a churn failure is contained, pseudonymised and classified', async () => {
  const result = await runDailyChurnScoring({ limit: 10 });

  // One customer failed; the run itself completed (containment), and the
  // failure reason is aggregated so the job-state row can answer "why".
  assert.deepEqual(result, {
    processed: 0,
    failed: 1,
    failure_reasons: { UNAVAILABLE: 1 },
  });
  assert.equal(warnings.length, 1);
  const [event, payload] = warnings[0];
  assert.equal(event, 'daily_churn_customer_failed');

  // No raw shopper UUID anywhere in the log payload.
  assert.equal(payload.customer_id, undefined);
  assert.ok(!JSON.stringify(payload).includes(CUSTOMER_ID),
    'raw customer UUID leaked into churn failure log');

  // The deterministic pseudonym correlates across runs and matches the
  // Python-side redaction (sha256 prefix, 16 hex chars).
  const expected = crypto.createHash('sha256').update(CUSTOMER_ID).digest('hex').slice(0, 16);
  assert.equal(payload.customer_ref, expected);
  assert.match(payload.customer_ref, /^[0-9a-f]{16}$/);

  // The provider error code survives, so an outage is distinguishable from
  // a contract rejection in monitoring.
  assert.equal(payload.error_type, 'UNAVAILABLE');
});
