'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateRecommendationBoundary } = require('../revRecommendations');
const ORG = '11111111-1111-4111-8111-111111111111';
const STORE = '22222222-2222-4222-8222-222222222222';
const FINDING = '123e4567-e89b-42d3-a456-426614174000';
const REC = '123e4567-e89b-42d3-a456-426614174010';
const EVIDENCE = 'ev-1234567890123456789012';
function selected() {
  return { contract_version: 'rev-selected-finding-v1', finding_id: FINDING,
    tenant: { organization_id: ORG, store_ids: [STORE] }, evidence_references: [EVIDENCE] };
}
function recommendation() {
  return { contract_version: 'rev-recommendation-v1', recommendation_id: REC, finding_id: FINDING,
    tenant: { organization_id: ORG, store_ids: [STORE] }, lifecycle_state: 'presented',
    read_only: true, executed: false, execution_status: 'not_requested',
    step: 'Compare order count and average order value for the selected periods.',
    why_it_matters: 'The arithmetic driver narrows the investigation without claiming causation.',
    validation_method: 'Repeat the same comparison after an equivalent period.',
    evidence_references: [EVIDENCE] };
}
const options = { organizationId: ORG, evidenceIds: new Set([EVIDENCE]) };

test('valid selected finding and specific read-only recommendation pass independently', () => {
  assert.deepEqual(validateRecommendationBoundary(selected(), [recommendation()], options), []);
});

test('foreign tenant, store scope and evidence references fail closed', () => {
  const foreign = recommendation(); foreign.tenant.organization_id = 'other-org';
  assert.ok(validateRecommendationBoundary(selected(), [foreign], options).includes('recommendation_tenant'));
  const orphan = recommendation(); orphan.evidence_references = ['ev-forged'];
  assert.ok(validateRecommendationBoundary(selected(), [orphan], options).includes('recommendation_evidence_reference'));
  const badSelected = selected(); badSelected.evidence_references = ['ev-forged'];
  assert.ok(validateRecommendationBoundary(badSelected, [], options).includes('selected_finding_evidence_reference'));
});

test('generic, duplicate and execution-claiming recommendations are rejected', () => {
  const generic = recommendation(); generic.step = 'Improve your store';
  generic.validation_method = '';
  assert.ok(validateRecommendationBoundary(selected(), [generic], options).includes('recommendation_quality'));
  const executed = recommendation(); executed.executed = true;
  assert.ok(validateRecommendationBoundary(selected(), [executed], options).includes('recommendation_lifecycle'));
  assert.ok(validateRecommendationBoundary(selected(), [recommendation(), recommendation()], options).includes('recommendation_duplicate'));
});

test('stale, superseded and resolved lifecycle states remain typed but never executed', () => {
  for (const lifecycle_state of ['invalidated', 'superseded', 'resolved']) {
    const rec = { ...recommendation(), lifecycle_state };
    assert.deepEqual(validateRecommendationBoundary(selected(), [rec], options), []);
    assert.equal(rec.executed, false);
  }
});
