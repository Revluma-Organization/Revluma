'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { _validateInvestigationResponse } = require('../mlService');
const { createEvidence } = require('../revEvidenceContract');

function validResult() {
  return {
    contract_version: 'rev-investigation-v1',
    success: true,
    read_only: true,
    response_type: 'analysis',
    text: '## What I can verify\n- USD 30.31 across 3 orders',
    investigation: {
      id: 'investigation-1',
      intent: 'revenue_investigation',
      status: 'complete',
      period: { start: '2026-10-25T12:00:00Z', end: '2026-11-01T12:00:00Z' },
      steps: [],
    },
    evidence: {
      schema_version: 'rev-evidence-v2',
      items: [createEvidence({
        organization_id: '11111111-1111-4111-8111-111111111111',
        store_id: '22222222-2222-4222-8222-222222222222',
        store_ids: ['22222222-2222-4222-8222-222222222222'], store_scope: 'store',
        evidence_type: 'calculation', domain: 'orders', classification: 'deterministic_calculation',
        metric: 'recorded_order_value', label: 'Recorded order value', value: '30.31',
        currency: 'USD', unit: 'currency', status: 'available', definition: 'Gross recorded order value.',
        period: { start: '2026-10-25T12:00:00Z', end: '2026-11-01T12:00:00Z', timezone: 'UTC', semantics: '[start, end)' },
        source: { system: 'shopify', resource: 'orders', references: [{ source_id: 'order-1', resource: 'orders', sync_run_id: 'run-1' }] },
        retrieved_at: '2026-11-01T12:00:00Z', computed_at: '2026-11-01T12:00:00Z',
        coverage: { status: 'complete', complete: true, period_status: 'covered', source: 'orders', note: 'Complete.' },
        freshness: { state: 'fresh', as_of: '2026-11-01T12:00:00Z', age_seconds: 0, policy: '3600s', note: 'Fresh.' },
        provenance: { retrieval: 'calculation', transformation: 'Sum totals.', calculation_version: 'v2', lineage: ['order-1'], reproducible: true },
        measurement: { amount: '30.31', currency: 'USD', interpretation: 'gross', tax: 'included', shipping: 'included', discounts: 'included', refunds: 'excluded', cancellations: 'excluded', numerator: null, denominator: null, formula: 'sum(total_price_set)' },
        confidence: { level: 'high', score: 0.95, basis: 'Complete.' }, limitations: [],
      })],
    },
    facts: [],
    hypotheses: [],
    unknowns: [],
    recommendations: [{ label: 'Compare periods', executed: false, action_state: 'recommended', execution_status: 'not_requested', merchant_confirmation: 'not_confirmed', independent_verification: 'unverified' }],
  };
}

test('valid investigation contract is accepted', () => {
  assert.equal(_validateInvestigationResponse(validResult()), true);
});

test('investigation contract rejects missing read-only guarantee', () => {
  const result = validResult();
  result.read_only = false;
  assert.equal(_validateInvestigationResponse(result), false);
  result.read_only = undefined;
  assert.equal(_validateInvestigationResponse(result), false);
});

test('investigation contract rejects unauthorised execution claims', () => {
  const result = validResult();
  result.recommendations = [{ label: 'Change price', executed: true }];
  assert.equal(_validateInvestigationResponse(result), false);
});

test('investigation contract rejects monetary evidence without a currency', () => {
  for (const currency of [undefined, null, '', 'usd', 'US', 'USDT']) {
    const result = validResult();
    result.evidence.items[0].currency = currency;
    assert.equal(_validateInvestigationResponse(result), false, String(currency));
  }
  const zero = validResult();
  zero.evidence.items[0].value = null;
  assert.equal(_validateInvestigationResponse(zero), false);
});

test('investigation contract rejects invalid evidence statuses and ids', () => {
  const result = validResult();
  result.evidence.items[0].status = 'probably';
  assert.equal(_validateInvestigationResponse(result), false);
  const badId = validResult();
  badId.evidence.items[0].id = 'evidence-1';
  assert.equal(_validateInvestigationResponse(badId), false);
});

test('investigation contract rejects a non-array evidence payload', () => {
  const result = validResult();
  result.evidence.items = {};
  assert.equal(_validateInvestigationResponse(result), false);
  assert.equal(_validateInvestigationResponse(null), false);
  assert.equal(_validateInvestigationResponse({ success: false }), false);
});

test('controller source enforces streaming, search, retry and read-only guards', () => {
  const file = path.join(__dirname, '..', '..', 'controller', 'revController.js');
  const source = fs.readFileSync(file, 'utf8');
  assert.ok(source.includes('exports.chatStream'), 'streaming endpoint must exist');
  assert.ok(source.includes("code: 'READ_ONLY'"), 'read-only guard must exist');
  assert.ok(source.includes('reuse_user_message'), 'retry must reuse the user turn');
  assert.ok(source.includes('exports.retryConversation'), 'retry endpoint must exist');
  assert.ok(source.includes('rawSearch'), 'conversation search must exist');
  assert.ok(source.includes('cm.organization_id = ${org.id}::uuid'),
    'conversation search must be organization-scoped');
  assert.ok(source.includes('mlService.streamInvestigation'), 'stream must use the gateway');
  assert.ok(!source.includes('require(\'axios\').post'), 'controllers must not call providers directly');

  const route = fs.readFileSync(
    path.join(__dirname, '..', '..', 'route', 'revRoute.js'), 'utf8');
  assert.ok(route.includes("router.post('/stream'"), 'stream route must be mounted');
  assert.ok(route.includes("router.post('/conversation/:id/retry'"), 'retry route must be mounted');
  assert.ok(route.includes("router.get('/tools'"), 'tool catalog route must be mounted');
  assert.ok(route.includes('authenticateToken, chatLimiter'), 'stream must be rate limited');
});

// ── Task 204: epistemic claim contract at the Node boundary ────────────────

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const STORE_ID = '22222222-2222-4222-8222-222222222222';

function baseClaim(over = {}) {
  return {
    claim_id: 'clm-boundary1',
    contract_version: 'rev-claim-v1',
    classification: 'verified_fact',
    text: 'Recorded order value USD 30.31 across 3 orders',
    metric: 'recorded_order_value',
    value: '30.31',
    unit: 'currency',
    currency: 'USD',
    rounding: '2dp_money',
    period: { start: '2026-10-25T12:00:00Z', end: '2026-11-01T12:00:00Z', timezone: 'UTC' },
    retrieved_at: '2026-11-01T12:00:00Z',
    evidence_ids: [validResult().evidence.items[0].id],
    source: { system: 'shopify', resource: 'orders' },
    organization_id: ORG_ID,
    store_ids: [STORE_ID],
    quality: null,
    limitations: [],
    financial_impact: null,
    calculation: null,
    hypothesis: null,
    unknown: null,
    ...over,
  };
}

test('claim contract accepts a verified fact citing recorded evidence', () => {
  const result = validResult();
  result.claims = [baseClaim()];
  result.epistemics = {
    contract_version: 'rev-claim-v1',
    valid: true,
    validation_errors: [],
    rollup: { contract_version: 'rev-claim-v1', counts: { verified_fact: 1 }, total: 1, metrics: {} },
  };
  assert.equal(_validateInvestigationResponse(result, ORG_ID, [STORE_ID]), true);
});

test('claim contract rejects a fact citing unknown evidence', () => {
  const result = validResult();
  result.claims = [baseClaim({ evidence_ids: ['ev-does-not-exist'] })];
  assert.equal(_validateInvestigationResponse(result, ORG_ID, [STORE_ID]), false);
});

test('claim contract rejects a hypothesis marked verified', () => {
  const result = validResult();
  result.claims = [baseClaim({
    classification: 'hypothesis',
    value: null,
    unit: null,
    currency: null,
    rounding: null,
    evidence_ids: [],
    hypothesis: {
      verified: true,
      supports: [],
      missing_evidence: ['a dedicated investigation'],
      confidence: 0.2,
    },
  })];
  assert.equal(_validateInvestigationResponse(result, ORG_ID, [STORE_ID]), false);
});

test('claim contract accepts a hypothesis that is not verified', () => {
  const result = validResult();
  result.claims = [baseClaim({
    classification: 'hypothesis',
    value: null,
    unit: null,
    currency: null,
    rounding: null,
    evidence_ids: [],
    hypothesis: {
      verified: false,
      supports: [],
      missing_evidence: ['a dedicated investigation'],
      confidence: 0.2,
    },
  })];
  assert.equal(_validateInvestigationResponse(result, ORG_ID, [STORE_ID]), true);
});

test('claim contract rejects an unknown claim carrying a value', () => {
  const result = validResult();
  result.claims = [baseClaim({
    classification: 'unknown',
    value: 0,
    unit: null,
    currency: null,
    rounding: null,
    evidence_ids: [],
    unknown: { reason: 'The reason is not recorded.', attempts: ['checkout_observations'] },
  })];
  assert.equal(_validateInvestigationResponse(result, ORG_ID, [STORE_ID]), false);
});

test('claim contract rejects false monetary precision', () => {
  const result = validResult();
  result.claims = [baseClaim({ value: '30.315' })];
  assert.equal(_validateInvestigationResponse(result, ORG_ID, [STORE_ID]), false);
});

test('claim contract rejects a calculated observation with a zero denominator', () => {
  const result = validResult();
  result.claims = [baseClaim({
    classification: 'calculated_observation',
    value: '50.0',
    unit: 'percent',
    rounding: '1dp_percent',
    calculation: {
      id: 'percent-change:recorded_order_value',
      version: 'percent-change-v1',
      method: 'percent_change',
      formula: 'percent = (current - previous) / previous * 100',
      inputs: [
        { role: 'current', evidence_id: validResult().evidence.items[0].id, value: '30.31', currency: 'USD' },
        { role: 'previous', evidence_id: validResult().evidence.items[0].id, value: 0, currency: 'USD' },
      ],
      rounding: '1dp_percent',
    },
  })];
  assert.equal(_validateInvestigationResponse(result, ORG_ID, [STORE_ID]), false);
});

test('claim contract rejects asserted impact without a recorded method', () => {
  const result = validResult();
  result.claims = [baseClaim({ financial_impact: 'lost' })];
  assert.equal(_validateInvestigationResponse(result, ORG_ID, [STORE_ID]), false);
  const withCalc = validResult();
  withCalc.claims = [baseClaim({
    classification: 'calculated_observation',
    value: '50.0',
    unit: 'percent',
    rounding: '1dp_percent',
    financial_impact: 'recoverable',
    calculation: {
      id: 'c', version: 'v', method: 'percent_change', formula: 'f',
      inputs: [
        { role: 'current', evidence_id: validResult().evidence.items[0].id, value: '30.31', currency: 'USD' },
        { role: 'previous', evidence_id: validResult().evidence.items[0].id, value: '20.00', currency: 'USD' },
      ],
      rounding: '1dp_percent',
    },
  })];
  assert.equal(_validateInvestigationResponse(withCalc, ORG_ID, [STORE_ID]), true);
});

test('claim contract rejects cross-tenant and cross-store claims', () => {
  const tenant = validResult();
  tenant.claims = [baseClaim({ organization_id: '99999999-9999-4999-8999-999999999999' })];
  assert.equal(_validateInvestigationResponse(tenant, ORG_ID, [STORE_ID]), false);
  const store = validResult();
  store.claims = [baseClaim({ store_ids: ['store-foreign'] })];
  assert.equal(_validateInvestigationResponse(store, ORG_ID, [STORE_ID]), false);
});

test('claim contract accepts a restated provenance claim not in current evidence', () => {
  const result = validResult();
  result.claims = [baseClaim({
    restated: true,
    source_investigation: 'inv-previous',
    // The provenance answer cites the PREVIOUS investigation's claim; the
    // current response's evidence may be empty and that must be fine.
    evidence_ids: [validResult().evidence.items[0].id],
  })];
  assert.equal(_validateInvestigationResponse(result, ORG_ID, [STORE_ID]), true);
  const noSource = validResult();
  noSource.claims = [baseClaim({ restated: true })];
  assert.equal(_validateInvestigationResponse(noSource, ORG_ID, [STORE_ID]), false);
});

test('claim contract rejects an epistemics block that violates its invariants', () => {
  const bad = validResult();
  bad.epistemics = {
    contract_version: 'rev-claim-v1',
    valid: false,
    validation_errors: [],
    rollup: { counts: {} },
  };
  assert.equal(_validateInvestigationResponse(bad, ORG_ID, [STORE_ID]), false);
  const wrongVersion = validResult();
  wrongVersion.epistemics = {
    contract_version: 'rev-claim-v0',
    valid: true,
    validation_errors: [],
    rollup: { counts: {} },
  };
  assert.equal(_validateInvestigationResponse(wrongVersion, ORG_ID, [STORE_ID]), false);
});

test('claim contract rejects corrections that do not name the superseded claim', () => {
  const original = baseClaim();
  const mismatched = validResult();
  mismatched.corrections = {
    superseded: { ...original, superseded: true, superseded_reason: 'challenged' },
    correction: { claim_id: 'clm-corr', corrects_claim_id: 'clm-something-else' },
  };
  assert.equal(_validateInvestigationResponse(mismatched, ORG_ID, [STORE_ID]), false);
  const consistent = validResult();
  consistent.corrections = {
    superseded: { ...original, superseded: true, superseded_reason: 'challenged' },
    correction: { claim_id: 'clm-corr', corrects_claim_id: original.claim_id },
  };
  assert.equal(_validateInvestigationResponse(consistent, ORG_ID, [STORE_ID]), true);
});
