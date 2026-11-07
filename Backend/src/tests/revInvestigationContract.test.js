const test = require('node:test');
const assert = require('node:assert/strict');
const { createEvidence } = require('../services/revEvidenceContract');
const { _validateInvestigationResponse: validate } = require('../services/mlService');
const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '33333333-3333-4333-8333-333333333333';
const STORE = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-11-07T12:00:00.000Z';
function item(overrides = {}) {
  return createEvidence({
    organization_id: ORG, store_id: STORE, store_ids: [STORE], store_scope: 'store',
    evidence_type: 'calculation', domain: 'orders', classification: 'deterministic_calculation',
    status: 'available', metric: 'recorded_order_value', label: 'Recorded order value',
    value: '12.50', unit: 'currency', currency: 'USD', definition: 'Gross recorded order value; not recoverable revenue.',
    period: { start: '2026-11-06T12:00:00.000Z', end: NOW, timezone: 'UTC', semantics: '[start, end)' },
    source: { system: 'shopify', resource: 'orders', references: [{ source_id: 'order-1', resource: 'orders', sync_run_id: 'run-1' }] },
    retrieved_at: NOW, computed_at: NOW,
    coverage: { status: 'complete', complete: true, period_status: 'covered', source: 'intelligence_order_coverage', note: 'Complete period.' },
    freshness: { state: 'fresh', as_of: NOW, age_seconds: 0, policy: '3600s', note: 'Fresh.' },
    provenance: { retrieval: 'calculation', transformation: 'Sum order totals.', calculation_version: 'revenue-v2', lineage: ['order-1'], reproducible: true },
    measurement: { amount: '12.50', currency: 'USD', interpretation: 'gross', tax: 'included', shipping: 'included', discounts: 'included', refunds: 'excluded', cancellations: 'excluded', numerator: null, denominator: null, formula: 'sum(total_price_set)' },
    confidence: { level: 'high', score: 0.95, basis: 'Complete coverage.' }, limitations: [],
    ...overrides,
  });
}
function response(overrides = {}) {
  const evidence = item();
  return {
    success: true, read_only: true, text: 'Recorded order value was USD 12.50.', response_type: 'analysis',
    investigation: { id: 'investigation-1', intent: 'revenue', status: 'completed', period: {} },
    investigation_outcome: {
      contract_version: 'rev-investigation-outcome-v1', outcome: 'success',
      tenant: { organization_id: ORG, store_ids: [STORE] },
      required_domains: [], available_domains: [], unavailable_domains: [],
      answerability: { can_answer: [], cannot_establish: [] }, retry: { eligible: false },
      history: {}, coverage: {}, diagnostic_reference: 'REV-0123456789ABCDEF',
    },
    evidence: { schema_version: 'rev-evidence-v2', items: [evidence] },
    facts: [{ text: 'Recorded order value was USD 12.50.', evidence_ids: [evidence.id] }],
    hypotheses: [], unknowns: [], recommendations: [], ...overrides,
  };
}
test('valid typed investigation responses preserve evidence and financial definitions', () => {
  assert.equal(validate(response(), ORG, [STORE]), true);
  assert.equal(response().evidence.items[0].measurement.refunds, 'excluded');
});
test('forged tenant/store references and orphan facts are rejected', () => {
  assert.equal(validate(response(), OTHER_ORG, [STORE]), false);
  assert.equal(validate(response(), ORG, ['44444444-4444-4444-8444-444444444444']), false);
  const orphan = response(); orphan.facts[0].evidence_ids = ['ev-000000000000000000000000'];
  assert.equal(validate(orphan, ORG, [STORE]), false);
});
test('verified hypotheses and affirmative unknowns fail closed', () => {
  const hypothesis = response({ hypotheses: [{ text: 'Guessed cause', verified: true, basis_evidence_ids: [] }] });
  assert.equal(validate(hypothesis, ORG, [STORE]), false);
  assert.throws(() => item({ classification: 'unknown', status: 'unavailable', value: 0 }));
});
test('missing coverage, freshness, provenance or measurement invalidates model output', () => {
  for (const field of ['coverage', 'freshness', 'provenance', 'measurement']) {
    const candidate = response(); delete candidate.evidence.items[0][field];
    assert.equal(validate(candidate, ORG, [STORE]), false, field);
  }
});
