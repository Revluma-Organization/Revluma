'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CONTRACT_VERSION, STAGES, validateSpecialistExecution } = require('../revSpecialists');

const ORG = '11111111-1111-4111-8111-111111111111';
function valid() {
  return {
    contract_version: CONTRACT_VERSION,
    specialist: { name: 'revenue', version: '1.0.0' }, execution_id: crypto.randomUUID(), investigation_id: crypto.randomUUID(),
    request: 'Why did revenue change?', resolved_intent: 'revenue_investigation',
    tenant: { organization_id: ORG, store_ids: ['store-a'] }, period: { start: '2026-11-01T00:00:00Z', end: '2026-11-02T00:00:00Z' },
    required_capabilities: ['revenue_observations'], required_evidence_domains: ['revenue_observations'], retrieved_evidence_domains: ['revenue_observations'],
    status: 'success', verified_facts: [], calculated_findings: [{ metric: 'recorded_order_value', value: '10.00', currency: 'USD', epistemic_grade: 'calculated_observation', evidence_references: ['ev-1'] }],
    hypotheses: [], unknowns: [], evidence_references: ['ev-1'], coverage: { state: 'verified', complete: true }, freshness: { state: 'fresh' },
    currency_integrity: { currencies: ['USD'], mixed_currency_totals: false }, findings: [],
    recommendations: [{ state: 'recommended', executed: false, read_only: true, evidence_ids: ['ev-1'] }],
    investigation_outcome: 'success', limitations: [], unsupported_capabilities: [],
    lifecycle: STAGES.map(stage => ({ stage, status: 'completed' })), diagnostics: { read_only: true },
    follow_up_context: { investigation_id: crypto.randomUUID() }, contradictions: [],
  };
}

test('valid specialist execution passes independent tenant/evidence/lifecycle validation', () => {
  assert.deepEqual(validateSpecialistExecution(valid(), { organizationId: ORG, evidenceIds: new Set(['ev-1']) }), []);
});

test('foreign tenant, foreign evidence, PII and false action success fail closed', () => {
  const foreign = valid(); foreign.tenant.organization_id = 'other';
  assert.ok(validateSpecialistExecution(foreign, { organizationId: ORG, evidenceIds: new Set(['ev-1']) }).includes('specialist_tenant'));
  const citation = valid(); citation.calculated_findings[0].evidence_references = ['ev-foreign'];
  assert.ok(validateSpecialistExecution(citation, { organizationId: ORG, evidenceIds: new Set(['ev-1']) }).includes('specialist_evidence_reference'));
  const pii = valid(); pii.diagnostics.email = 'private@example.com';
  assert.ok(validateSpecialistExecution(pii, { organizationId: ORG, evidenceIds: new Set(['ev-1']) }).includes('specialist_sensitive_field'));
  const action = valid(); action.recommendations[0].executed = true;
  assert.ok(validateSpecialistExecution(action, { organizationId: ORG, evidenceIds: new Set(['ev-1']) }).includes('specialist_action_state'));
});

test('empty success and incomplete lifecycle are rejected', () => {
  const empty = valid(); empty.calculated_findings = [];
  assert.ok(validateSpecialistExecution(empty, { organizationId: ORG, evidenceIds: new Set(['ev-1']) }).includes('specialist_empty_success'));
  const lifecycle = valid(); lifecycle.lifecycle.pop();
  assert.ok(validateSpecialistExecution(lifecycle, { organizationId: ORG, evidenceIds: new Set(['ev-1']) }).includes('specialist_lifecycle'));
});
