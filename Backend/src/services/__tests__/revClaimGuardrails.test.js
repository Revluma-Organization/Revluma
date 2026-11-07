'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  narrativeGuardrailErrors, responseGuardrailErrors, safePersistedNarrative,
} = require('../revClaimGuardrails');

const period = { start: '2026-10-25T00:00:00Z', end: '2026-11-01T00:00:00Z' };
function payload() {
  return {
    text: 'Recorded order value was USD 10.00. Its cause is unknown.',
    evidence: { items: [{ id: 'ev-1', metric: 'recorded_order_value', status: 'available', quality_eligible: true, currency: 'USD', period, measurement: { interpretation: 'recorded_observed' } }], comparison_items: [] },
    facts: [{ text: 'Recorded order value USD 10.00', metric: 'recorded_order_value', evidence_ids: ['ev-1'], currency: 'USD', period, causal_status: 'observed' }],
    comparison_facts: [], year_over_year_facts: [], hypotheses: [], recommendations: [],
  };
}

test('observation, association, hypothesis and unknown do not become causation', () => {
  assert.deepEqual(responseGuardrailErrors(payload()), []);
  const value = payload();
  value.facts[0].causal_status = 'statistical_association';
  value.facts[0].text = 'Recorded order value is associated with the comparison period';
  assert.deepEqual(responseGuardrailErrors(value), []);
  value.facts = [];
  value.hypotheses = [{ statement: 'Inventory is a possible contributor; no causal evidence is established.', status: 'hypothesis', causal_status: 'hypothesis', basis_evidence_ids: ['ev-1'] }];
  assert.deepEqual(responseGuardrailErrors(value), []);
});

test('causal, sequence and plausibility claims fail even with a citation or trailing disclaimer', () => {
  for (const text of [
    'Low inventory caused the revenue decline. [1]',
    'Revenue fell because of low inventory.',
    'Revenue fell after the update, so the update drove the decline.',
    'Low inventory caused the decline, but this is not established.',
  ]) assert.ok(narrativeGuardrailErrors(text).includes('unsupported_causal_language'), text);
});

test('lost, recovered, preventable, stockout and guaranteed revenue fail closed', () => {
  for (const text of ['Revluma can recover USD 10,000.', 'You lost USD 4,000 from this stockout.', 'This preventable revenue loss is USD 900.', 'We guarantee recovered revenue.', 'We recovered USD 10, but it is not verified.']) {
    assert.ok(narrativeGuardrailErrors(text).includes('unsupported_financial_impact_language'), text);
  }
});

test('execution prose and forged lifecycle states are not authority', () => {
  for (const text of ['I updated the product.', 'We have executed the recommendation.', 'Your settings have been changed.', 'I’ve successfully updated the product.', 'The price was updated by me.', 'The problem is resolved.', 'Revluma recovered the abandoned carts.']) {
    assert.ok(narrativeGuardrailErrors(text).includes('generated_action_or_outcome_claim'), text);
  }
  const value = payload();
  value.recommendations = [{ action_state: 'executed', executed: true, execution_status: 'executed', merchant_confirmation: 'merchant_confirmed', independent_verification: 'verified', execution_actor: 'rev', executed_at: new Date().toISOString() }];
  const errors = responseGuardrailErrors(value);
  assert.ok(errors.includes('recommendation_0_generated_state_not_authoritative'));
  assert.ok(errors.includes('recommendation_0_merchant_confirmation_not_authoritative'));
});

test('recoverable evidence needs a complete eligible independent attribution method', () => {
  const value = payload();
  value.evidence.items[0].measurement.interpretation = 'recoverable';
  assert.ok(responseGuardrailErrors(value).includes('financial_impact_record_required'));
  value.evidence.items[0].financial_impact = { methodology_id: 'before-after', methodology_version: '1', inputs: {}, coverage: {}, assumptions: [], limitations: [], eligible: false, independent_attribution_verified: false };
  assert.ok(responseGuardrailErrors(value).includes('financial_impact_not_eligible'));
});

test('material claims require relevant, fresh/eligible, period and currency-matched evidence', () => {
  for (const mutate of [
    (v) => { v.evidence.items[0].metric = 'inventory_units'; },
    (v) => { v.evidence.items[0].quality_eligible = false; },
    (v) => { v.evidence.items[0].status = 'partial'; },
    (v) => { v.evidence.items[0].currency = 'NGN'; },
    (v) => { v.evidence.items[0].period = { ...period, start: '2025-01-01T00:00:00Z' }; },
    (v) => { v.facts[0].evidence_ids = ['ev-forged']; },
  ]) {
    const value = payload(); mutate(value);
    assert.ok(responseGuardrailErrors(value).some((error) => error.startsWith('material_claim_')));
  }
});

test('numeric citations resolve only to returned source references', () => {
  const value = payload();
  value.text += ' [1]';
  assert.ok(responseGuardrailErrors(value).includes('unresolved_citation_reference'));
  value.evidence.items[0].source = { references: ['shopify:orders:123'] };
  assert.deepEqual(responseGuardrailErrors(value), []);
});

test('verified causal requires genuine method, not a causal label or before/after claim', () => {
  const value = payload();
  value.facts[0].causal_status = 'verified_causal';
  value.facts[0].causal_methodology = { design: 'before_after', eligible: true };
  assert.ok(responseGuardrailErrors(value).includes('verified_causal_methodology_required'));
});

test('history and cached persisted prose are suppressed without revealing evidence', () => {
  const historical = 'I updated your prices and recovered USD 900 from another merchant.';
  const safe = safePersistedNarrative(historical);
  assert.notEqual(safe, historical);
  assert.ok(!safe.includes('900'));
  assert.ok(!safe.includes('another merchant'));
  assert.equal(safePersistedNarrative('Recorded revenue was USD 10.00.'), 'Recorded revenue was USD 10.00.');
});

test('legitimate read-only and uncertainty language remains usable', () => {
  for (const text of [
    'Nothing has been changed or sent.',
    'No independently verified recovered revenue is established.',
    'This comparison does not establish its cause or the amount of recoverable revenue.',
    'Causes are not established by this evidence.',
  ]) assert.deepEqual(narrativeGuardrailErrors(text), [], text);
});
