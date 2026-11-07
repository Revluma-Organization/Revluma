const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createEvidence, assertEvidence, validateEvidenceCollection,
} = require('../services/revEvidenceContract');

const ORG = '11111111-1111-4111-8111-111111111111';
const STORE = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-11-07T12:00:00.000Z';

function base(overrides = {}) {
  return createEvidence({
    evidence_type: 'store_snapshot',
    domain: 'orders',
    classification: 'verified_fact',
    status: 'available',
    organization_id: ORG,
    store_id: STORE,
    store_ids: [STORE],
    store_scope: 'store',
    label: 'Orders',
    definition: 'Non-cancelled orders',
    limitations: [],
    metric: 'orders',
    value: 4,
    unit: 'count',
    currency: null,
    source: { system: 'shopify', resource: 'orders', references: [{ source_id: 'record-1', resource: 'orders', sync_run_id: null }] },
    computed_at: NOW,
    period: { start: '2026-11-07T11:00:00.000Z', end: '2026-11-07T12:00:00.000Z', timezone: 'UTC', semantics: '[start, end)', label: 'One hour' },
    retrieved_at: NOW,
    coverage: { status: 'complete', complete: true, period_status: 'covered', source: 'orders', note: 'Complete' },
    freshness: { state: 'fresh', as_of: NOW, age_seconds: 0, policy: 'snapshot_15m', note: 'Fresh' },
    confidence: { level: 'high', score: 0.99, basis: 'Reconciled' },
    provenance: { retrieval: 'snapshot', transformation: 'Count orders', calculation_version: null, lineage: ['commerce_resource_records'], reproducible: true },
    measurement: null,
    note: 'Test',
    ...overrides,
  });
}

test('v2 evidence requires authenticated ownership, period, provenance and freshness', () => {
  for (const field of ['organization_id', 'store_id', 'store_ids', 'period', 'coverage', 'freshness', 'provenance', 'retrieved_at']) {
    const item = base(); delete item[field];
    assert.throws(() => assertEvidence(item), new RegExp(field));
  }
  assert.equal(assertEvidence(base()).organization_id, ORG);
});

test('unknown classifications cannot assert values or findings', () => {
  assert.throws(() => base({ classification: 'unknown', status: 'unavailable', value: 0 }));
  assert.equal(base({ classification: 'unknown', status: 'unavailable', value: null, metric: 'store_snapshot' }).value, null);
});

test('zero monetary values require complete certified period coverage', () => {
  assert.throws(() => base({
    value: 0, unit: 'currency', currency: 'USD', metric: 'recorded_order_value',
    value: '0', measurement: { amount: '0', currency: 'USD', interpretation: 'gross', tax: 'included', shipping: 'included', discounts: 'included', refunds: 'excluded', cancellations: 'excluded', numerator: null, denominator: null, formula: 'sum(total_price_set)' },
    coverage: { status: 'partial', complete: false, period_status: 'partial', source: 'orders', note: 'Partial' },
  }));
  assert.equal(base({ status: 'verified_zero', value: 0, coverage: base().coverage, note: 'Certified zero' }).value, 0);
});

test('stale and partial evidence preserve their explicit states', () => {
  const stale = base({ status: 'stale', freshness: { state: 'stale', as_of: NOW, age_seconds: 3600, policy: 'snapshot_15m', note: 'Stale' } });
  const partial = base({ status: 'partial', coverage: { ...base().coverage, status: 'partial', complete: false } });
  assert.equal(assertEvidence(stale).status, 'stale');
  assert.equal(assertEvidence(partial).status, 'partial');
});

test('forged timestamps, timezones, currencies and store references fail closed', () => {
  assert.throws(() => base({ retrieved_at: '2026-11-07' }));
  assert.throws(() => base({ period: { ...base().period, timezone: 'Mars/Olympus' } }));
  assert.throws(() => base({ period: { ...base().period, start: base().period.end } }));
  assert.throws(() => base({ currency: 'US D', value: '1', unit: 'currency' }));
  assert.throws(() => base({ store_ids: [STORE, STORE] }));
});

test('evidence IDs are stable and malformed batches identify their failure location', () => {
  assert.equal(base().id, base().id);
  assert.notEqual(base().id, base({ value: 5 }).id);
  const result = validateEvidenceCollection([{ ...base(), id: 'forged' }], { organizationId: ORG, storeIds: [STORE] });
  assert.equal(result.valid, false);
});
