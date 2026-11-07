'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  OUTCOMES, validateInvestigationOutcome, retryabilityForError,
  investigationOutcomeFromTransportError,
} = require('../revInvestigationOutcomes');

const ORG = '11111111-1111-4111-8111-111111111111';
function valid() {
  return {
    contract_version: 'rev-investigation-outcome-v1', outcome: 'partial_success',
    tenant: { organization_id: ORG, store_ids: ['store-a'] },
    required_domains: ['orders', 'inventory'], available_domains: ['orders'], unavailable_domains: ['inventory'],
    integration: { state: 'partially_operational' }, sync: { state: 'failed' }, retrieval: { state: 'partial' },
    history: { state: 'verified' }, coverage: { state: 'verified' },
    answerability: { can_answer: ['orders'], cannot_establish: ['inventory contribution'] },
    retry: { eligible: true, starts_sync: false }, diagnostic_reference: 'REV-0123456789ABCDEF',
  };
}

test('all canonical outcomes are distinct and a valid partial investigation passes', () => {
  assert.equal(OUTCOMES.length, 18);
  assert.deepEqual(validateInvestigationOutcome(valid(), ORG), []);
});

test('tenant, scope, retry and safe diagnostics are independently validated', () => {
  const foreign = valid(); foreign.tenant.organization_id = 'other';
  assert.ok(validateInvestigationOutcome(foreign, ORG).includes('outcome_tenant_mismatch'));
  const secret = valid(); secret.access_token = 'secret';
  assert.ok(validateInvestigationOutcome(secret, ORG).includes('outcome_sensitive_field'));
  const retry = valid(); retry.retry.eligible = 'yes';
  assert.ok(validateInvestigationOutcome(retry, ORG).includes('outcome_retry'));
});

test('permanent service and contract failures never advertise a retry', () => {
  for (const code of ['INTELLIGENCE_AUTH_FAILED', 'INTELLIGENCE_INVALID_REQUEST', 'INTELLIGENCE_INVALID_RESPONSE', 'INTELLIGENCE_NOT_CONFIGURED']) {
    assert.equal(retryabilityForError(code), false);
    assert.equal(investigationOutcomeFromTransportError({ code }).retry.eligible, false);
  }
  for (const code of ['INTELLIGENCE_TIMEOUT', 'INTELLIGENCE_UNAVAILABLE']) {
    assert.equal(retryabilityForError(code), true);
  }
});
