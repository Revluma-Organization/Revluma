'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const quality = require('../revEvidenceQuality');
const contract = require('../revEvidenceContract');
const golden = require('./revEvidenceQuality.golden.json');

const NOW = '2026-11-07T12:00:00Z';
const ORG = 'org-1';
const STORE = 'store-1';
const WINDOW = {
  start: '2026-11-06T12:00:00+00:00',
  end: '2026-11-07T12:00:00+00:00',
  timezone: 'UTC',
  semantics: '[start, end)',
};

function item(id, metric, status, unit, currency, value, covStatus, covComplete,
  periodStatus, freshState, source, extra = {}) {
  return {
    id, metric, status, unit, currency, value,
    period: { ...WINDOW }, store_ids: [STORE], organization_id: ORG,
    source: { system: 'shopify', resource: source, references: [] },
    coverage: { status: covStatus, complete: covComplete, period_status: periodStatus,
      source, note: 'n' },
    freshness: { state: freshState, as_of: null, age_seconds: 10, policy: '3600s', note: 'n' },
    ...extra,
  };
}

const ITEMS = {
  healthy: item('ev-a1', 'net_revenue', 'available', 'currency', 'USD', '100.00',
    'complete', true, 'covered', 'fresh', 'orders'),
  stale: item('ev-a2', 'net_revenue', 'stale', 'currency', 'USD', '100.00',
    'complete', true, 'covered', 'stale', 'orders'),
  partial_coverage: item('ev-a3', 'net_revenue', 'available', 'currency', 'USD', '100.00',
    'partial', false, 'partial', 'fresh', 'orders'),
  unauthorized: item('ev-a4', 'net_revenue', 'unauthorized', 'currency', null, null,
    'missing_authorization', false, 'unavailable', 'unknown', 'orders'),
  retrieval_failed: item('ev-a5', 'net_revenue', 'retrieval_failed', 'currency', null, null,
    'retrieval_failed', false, 'unavailable', 'unknown', 'orders'),
  not_synchronized: item('ev-a6', 'net_revenue', 'not_synchronized', 'count', null, null,
    'not_synchronized', false, 'unavailable', 'never_synchronized', 'orders'),
  synchronizing: item('ev-a7', 'active_checkouts', 'pending', 'count', null, 5,
    'unknown', false, 'unavailable', 'synchronizing', 'orders'),
  verified_zero: item('ev-a8', 'refunds', 'verified_zero', 'currency', 'USD', 0,
    'complete', true, 'covered', 'fresh', 'refunds'),
  zero_incomplete: item('ev-a9', 'refunds', 'available', 'currency', 'USD', 0,
    'partial', false, 'partial', 'fresh', 'refunds'),
  null_field: item('ev-a10', 'net_revenue', 'available', 'currency', 'USD', null,
    'complete', true, 'covered', 'fresh', 'orders'),
  unsupported_currency: item('ev-a11', 'net_revenue', 'unsupported', 'currency', null, null,
    'unsupported', false, 'unavailable', 'fresh', 'orders'),
  contradictory: item('ev-a12', 'net_revenue', 'contradictory', 'currency', 'USD', '100.00',
    'complete', true, 'covered', 'fresh', 'orders'),
  record_unit: item('ev-a13', 'latest_order', 'available', 'record', null, { id: 'abc' },
    'complete', true, 'current_snapshot', 'fresh', 'orders'),
  ratio_unit: item('ev-a14', 'refund_rate', 'available', 'ratio', null, 0.5,
    'complete', true, 'covered', 'fresh', 'refunds'),
};

// --- parity: qualityOf across the six dimensions ---------------------------
test('qualityOf matches the Python module byte-for-byte', () => {
  for (const [name, it] of Object.entries(ITEMS)) {
    assert.deepEqual(quality.qualityOf(it), golden.quality_of[name], `qualityOf(${name})`);
  }
});

test('six dimensions stay independent (available-but-stale, fresh-but-partial, complete-but-conflicting)', () => {
  const staleQ = quality.qualityOf(ITEMS.stale);
  assert.equal(staleQ.availability, 'available');
  assert.equal(staleQ.freshness, 'stale');
  assert.deepEqual(staleQ.reasons, ['stale_for_current_claim']);

  const partialQ = quality.qualityOf(ITEMS.partial_coverage);
  assert.equal(partialQ.freshness, 'fresh');
  assert.equal(partialQ.coverage, 'partial');
  assert.equal(partialQ.sufficiency, 'partial');

  const conflictQ = quality.qualityOf(ITEMS.contradictory);
  assert.equal(conflictQ.consistency, 'conflicting');
  assert.equal(conflictQ.coverage, 'complete');
  assert.equal(conflictQ.sufficiency, 'partial');
});

test('verified zero is never confused with missing', () => {
  assert.equal(quality.qualityOf(ITEMS.verified_zero).value_state, 'verified_zero');
  assert.equal(quality.qualityOf(ITEMS.verified_zero).sufficiency, 'sufficient');
  assert.equal(quality.qualityOf(ITEMS.null_field).value_state, 'null');
  assert.equal(quality.qualityOf(ITEMS.zero_incomplete).value_state, 'unknown');
  assert.equal(quality.qualityOf(ITEMS.not_synchronized).value_state, 'missing');
});

// --- parity: currency helpers (Task 207) -----------------------------------
test('aggregateCurrency matches Python', () => {
  assert.deepEqual(
    quality.aggregateCurrency([
      { amount: '10.50', currency: 'usd' },
      { amount: 4, currency: 'USD' },
      { amount: '0.25', currency: 'Usd' },
    ]), golden.aggregate_currency.single);
  assert.deepEqual(
    quality.aggregateCurrency([
      { amount: '100', currency: 'USD' },
      { amount: '100000', currency: 'NGN' },
    ]), golden.aggregate_currency.mixed);
  assert.deepEqual(
    quality.aggregateCurrency([
      { amount: '5', currency: 'USD' },
      { amount: '7', currency: null },
      { amount: '9', currency: '$' },
    ]), golden.aggregate_currency.unknown);
  assert.deepEqual(
    quality.aggregateCurrency([
      { amount: '0.1', currency: 'USD' },
      { amount: '0.2', currency: 'USD' },
    ]), golden.aggregate_currency.precision);
  assert.deepEqual(
    quality.aggregateCurrency([{ amount: '1.005', currency: 'USD' }]),
    golden.aggregate_currency.rounding);
  assert.deepEqual(
    quality.aggregateCurrency([{ amount: 'inf', currency: 'USD' }]),
    golden.aggregate_currency.inf);
  assert.deepEqual(quality.aggregateCurrency([]), golden.aggregate_currency.empty);

  // Hard invariant: mixed currencies never produce a combined total.
  const mixed = quality.aggregateCurrency([
    { amount: '100', currency: 'USD' },
    { amount: '100000', currency: 'NGN' },
  ]);
  assert.equal(mixed.combined, null);
  assert.equal(mixed.usable, false);
});

test('compareCurrency matches Python', () => {
  const cases = {
    same: [{ amount: '100', currency: 'USD' }, { amount: '90', currency: 'USD' }],
    none: [{ amount: '100', currency: 'USD' }, { amount: '160000', currency: 'NGN' }],
  };
  for (const [name, [a, b]] of Object.entries(cases)) {
    assert.deepEqual(quality.compareCurrency(a, b), golden.compare_currency[name], name);
  }
  assert.deepEqual(quality.compareCurrency(
    { amount: '100', currency: 'USD' }, { amount: '160000', currency: 'NGN' },
    { from_currency: 'USD', to_currency: 'NGN', rate: '1600',
      documented: true, source: 'fx-table', rate_at: '2026-11-07T00:00:00Z' }),
  golden.compare_currency.documented, 'documented');
  assert.deepEqual(quality.compareCurrency(
    { amount: '160000', currency: 'NGN' }, { amount: '100', currency: 'USD' },
    { from_currency: 'USD', to_currency: 'NGN', rate: '1600', documented: true, source: 'fx-table' }),
  golden.compare_currency.documented_reverse, 'documented_reverse');
  assert.deepEqual(quality.compareCurrency(
    { amount: '100', currency: 'USD' }, { amount: '160000', currency: 'NGN' },
    { from_currency: 'USD', to_currency: 'NGN', rate: '1600', documented: false, source: null }),
  golden.compare_currency.undocumented, 'undocumented');
  assert.deepEqual(quality.compareCurrency(
    { amount: '100', currency: 'USD' }, { amount: '160000', currency: 'NGN' },
    { from_currency: 'EUR', to_currency: 'GBP', rate: '840', documented: true, source: 'fx' }),
  golden.compare_currency.wrong_pair, 'wrong_pair');
  assert.deepEqual(quality.compareCurrency(
    { amount: '100', currency: 'USD' }, { amount: '160000', currency: 'NGN' },
    { from_currency: 'USD', to_currency: 'NGN', rate: '0', documented: true, source: 'fx' }),
  golden.compare_currency.zero_rate, 'zero_rate');
});

// --- parity: zero vs missing (Task 208) -------------------------------------
test('classifyZeroValue matches Python', () => {
  const contexts = {
    verified_zero_amount: { value: 0, kind: 'amount', coverage_complete: true, authorized: true, sync_state: 'ok', queried: true },
    verified_zero_count: { value: 0, kind: 'count', records_found: 0, coverage_complete: true, authorized: true, sync_state: 'ok', queried: true },
    incomplete: { value: 0, coverage_complete: false, authorized: true, sync_state: 'ok', queried: true },
    missing: { value: null, authorized: true, sync_state: 'ok', queried: true },
    null_field: { value: null, value_is_null_field: true, records_found: 4, coverage_complete: true, authorized: true, sync_state: 'ok', queried: true },
    records_but_null: { value: null, records_found: 4, coverage_complete: true, authorized: true, sync_state: 'ok', queried: true },
    failed_sync: { value: null, authorized: true, sync_state: 'failed', queried: false },
    never_synced: { value: null, authorized: true, sync_state: 'never', queried: false },
    unauthorized: { value: null, authorized: false },
    nonzero: { value: 7, coverage_complete: true, authorized: true, sync_state: 'ok', queried: true },
  };
  for (const [name, ctx] of Object.entries(contexts)) {
    assert.deepEqual(quality.classifyZeroValue(ctx), golden.classify_zero_value[name], name);
  }
});

test('safeRatio and safePercentChange match Python and never fabricate', () => {
  assert.deepEqual(quality.safeRatio(10, 4), golden.safe_ratio.ok);
  assert.deepEqual(quality.safeRatio(1, 3), golden.safe_ratio.third);
  assert.deepEqual(quality.safeRatio(1, 0), golden.safe_ratio.zero_denominator);
  assert.deepEqual(quality.safeRatio('nan', 1), golden.safe_ratio.nan);
  assert.deepEqual(quality.safeRatio('inf', 1), golden.safe_ratio.inf);

  assert.deepEqual(quality.safePercentChange(30, 20), golden.safe_percent_change.up);
  assert.deepEqual(quality.safePercentChange(10, 20), golden.safe_percent_change.down);
  assert.deepEqual(quality.safePercentChange(10, 0), golden.safe_percent_change.zero_baseline);
  assert.deepEqual(quality.safePercentChange(10, -5), golden.safe_percent_change.negative_baseline);
  assert.deepEqual(quality.safePercentChange(null, 20), golden.safe_percent_change.missing);

  const zeroDen = quality.safeRatio(1, 0);
  assert.equal(zeroDen.value, null);
  assert.equal(zeroDen.reason, 'zero_denominator');
  // No NaN/Infinity may ever escape a safe computation.
  assert.ok(zeroDen.value === null || Number.isFinite(zeroDen.value));
  assert.ok(quality.safeRatio('inf', 1).value === null);
  assert.ok(quality.safePercentChange(10, 0).percent === null);
});

// --- parity: source-specific freshness (Task 210) ---------------------------
test('evaluateFreshness matches Python', () => {
  const asOfFresh = '2026-11-07T11:59:00Z';
  const asOfAging = '2026-11-07T10:00:00Z';
  const asOfStale = '2026-11-01T12:00:00Z';
  const asOfHistOk = '2026-10-15T12:00:00Z';
  const asOfHistBefore = '2026-09-15T12:00:00Z';
  const asOf45min = '2026-11-07T11:15:00Z';
  const period = { start: '2026-10-01T00:00:00Z', end: '2026-11-01T00:00:00Z' };

  const cases = {
    fresh: { asOf: asOfFresh, policySeconds: 3600, question: 'current' },
    aging: { asOf: asOfAging, policySeconds: 3600, question: 'current' },
    stale: { asOf: asOfStale, policySeconds: 3600, question: 'current' },
    never: { asOf: null, policySeconds: 3600, question: 'current' },
    failed: { asOf: NOW, syncState: 'failed', policySeconds: 3600, question: 'current' },
    synchronizing: { asOf: null, syncState: 'synchronizing', policySeconds: 3600, question: 'current' },
    historical_ok: { asOf: asOfHistOk, policySeconds: 3600, question: 'historical', period },
    historical_before_period: { asOf: asOfHistBefore, policySeconds: 3600, question: 'historical', period },
    inventory_aging: { asOf: asOf45min, policySeconds: 1800, question: 'current' },
    orders_fresh: { asOf: asOf45min, policySeconds: 3600, question: 'current' },
  };
  for (const [name, args] of Object.entries(cases)) {
    assert.deepEqual(
      quality.evaluateFreshness({ now: NOW, lastSuccessfulSync: null, ...args }),
      golden.evaluate_freshness[name], name);
  }
});

// --- parity: contradictions (Task 211) --------------------------------------
test('detectContradictions matches Python', () => {
  const a1 = { ...ITEMS.healthy, id: 'ev-c1' };
  assert.deepEqual(quality.detectContradictions([
    a1,
    item('ev-c2', 'net_revenue', 'available', 'currency', 'USD', '90.00',
      'complete', true, 'covered', 'fresh', 'checkout'),
  ]), golden.detect_contradictions.unresolved, 'unresolved');

  assert.deepEqual(quality.detectContradictions([
    a1,
    item('ev-c3', 'net_revenue', 'available', 'currency', 'USD', '90.00',
      'complete', true, 'covered', 'fresh', 'checkout'),
  ], { net_revenue: 'orders' }), golden.detect_contradictions.source_of_truth, 'source_of_truth');

  assert.deepEqual(quality.detectContradictions([
    a1,
    item('ev-c4', 'net_revenue', 'stale', 'currency', 'USD', '90.00',
      'complete', true, 'covered', 'stale', 'orders'),
  ]), golden.detect_contradictions.recency, 'recency');

  assert.deepEqual(quality.detectContradictions([
    a1,
    item('ev-c5', 'net_revenue', 'available', 'currency', 'USD', '90.00',
      'complete', true, 'covered', 'fresh', 'orders',
      { period: { start: '2026-11-05T12:00:00+00:00', end: '2026-11-06T12:00:00+00:00',
        timezone: 'UTC', semantics: '[start, end)' } }),
  ]), golden.detect_contradictions.different_periods, 'different_periods');

  assert.deepEqual(quality.detectContradictions([
    a1,
    item('ev-c6', 'net_revenue', 'available', 'currency', 'NGN', '90.00',
      'complete', true, 'covered', 'fresh', 'orders'),
  ]), golden.detect_contradictions.different_currencies, 'different_currencies');

  assert.deepEqual(quality.detectContradictions([
    a1,
    item('ev-c7', 'net_revenue', 'available', 'currency', 'USD', '100.00',
      'complete', true, 'covered', 'fresh', 'orders'),
  ]), golden.detect_contradictions.identical_values, 'identical_values');

  // Unresolved conflicts must never invent an averaged winner.
  const [unresolved] = quality.detectContradictions([
    a1,
    item('ev-x1', 'net_revenue', 'available', 'currency', 'USD', '80.00',
      'complete', true, 'covered', 'fresh', 'checkout'),
  ]);
  assert.equal(unresolved.resolved, false);
  assert.equal(unresolved.winner_value, null);
  assert.equal(unresolved.confidence_impact, 'reduce');
});

// --- parity: collection rollup ----------------------------------------------
test('qualityOfCollection matches Python and preserves verified zeros', () => {
  assert.deepEqual(
    quality.qualityOfCollection([ITEMS.healthy, ITEMS.verified_zero, ITEMS.unauthorized]),
    golden.quality_of_collection);
  assert.deepEqual(quality.qualityOfCollection([
    ITEMS.healthy,
    item('ev-c8', 'net_revenue', 'available', 'currency', 'NGN', '100.00',
      'complete', true, 'covered', 'fresh', 'orders'),
  ]), golden.quality_of_collection_mixed);

  const rollup = quality.qualityOfCollection([ITEMS.healthy, ITEMS.verified_zero, ITEMS.unauthorized]);
  assert.equal(rollup.overall_sufficiency, 'unavailable');
  assert.equal(rollup.items.find((i) => i.id === 'ev-a8').value_state, 'verified_zero');
});

// --- wiring: quality survives the service boundary --------------------------
test('createEvidence attaches the quality block and it survives validation', () => {
  const input = {
    organization_id: ORG,
    store_ids: [STORE],
    store_id: null,
    evidence_type: 'metric',
    domain: 'orders',
    classification: 'verified_fact',
    status: 'available',
    metric: 'net_revenue',
    label: 'Net revenue (24h)',
    value: '100.00',
    unit: 'currency',
    currency: 'USD',
    definition: 'Net order value for the period',
    period: {
      start: '2026-11-06T12:00:00Z', end: '2026-11-07T12:00:00Z',
      timezone: 'UTC', semantics: '[start, end)',
    },
    source: { system: 'shopify', resource: 'orders', references: [] },
    retrieved_at: NOW,
    computed_at: null,
    coverage: { status: 'complete', period_status: 'covered', complete: true,
      source: 'orders', note: 'n' },
    freshness: { state: 'fresh', as_of: NOW, age_seconds: 10, policy: '3600s', note: 'n' },
    provenance: { retrieval: 'aggregate', transformation: 't',
      calculation_version: 'v1', lineage: ['source:orders'], reproducible: true },
    measurement: { amount: '100.00', currency: 'USD', interpretation: 'net',
      tax: 'unknown', shipping: 'unknown', discounts: 'unknown', refunds: 'unknown',
      cancellations: 'unknown', numerator: null, denominator: null, formula: 'f' },
    confidence: { level: 'high', score: 0.95, basis: 'b' },
    store_scope: 'organization',
    limitations: [],
  };
  const created = contract.createEvidence(input);
  assert.ok(created.quality, 'quality block present on the created item');
  assert.equal(created.quality.schema_version, 'rev-evidence-quality-v1');
  assert.equal(created.quality.sufficiency, 'sufficient');
  // The block round-trips through the collection validator untouched.
  const check = contract.validateEvidenceCollection([created], { organizationId: ORG, storeIds: [STORE] });
  assert.deepEqual(check, { valid: true, errors: [] });
  // And quality derived after serialization equals quality at creation time.
  assert.deepEqual(quality.qualityOf(JSON.parse(JSON.stringify(created))), created.quality);
});
