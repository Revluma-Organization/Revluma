'use strict';

/**
 * Phase 5B parity: the /orchestrate Node boundary is an epistemic firewall.
 * OrchestrationResult.to_dict() never emits claims/facts/hypotheses/unknowns,
 * and those grades are re-validated at the Node boundary only on the
 * investigation path — so any orchestrate result carrying them fails closed
 * instead of flowing into persistence unvalidated.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { _validateOrchestrateResponse } = require('../mlService');

function validAnalysis() {
  return {
    success: true, response_type: 'analysis',
    conversation_id: 'conv-1', message_id: 'msg-1',
    situation: 'Situation.', insight: 'Insight.',
    implication: 'Implication.', recommendation: 'Recommendation.',
  };
}

test('a classification-free orchestrate result still validates', () => {
  assert.equal(_validateOrchestrateResponse(validAnalysis()), true);
  assert.equal(_validateOrchestrateResponse({
    success: true, response_type: 'conversational',
    conversation_id: 'conv-1', message_id: 'msg-1', text: 'Hello.',
  }), true);
});

for (const key of ['claims', 'facts', 'hypotheses', 'unknowns']) {
  test(`orchestrate result carrying ${key} fails closed`, () => {
    assert.equal(_validateOrchestrateResponse({ ...validAnalysis(), [key]: [] }), false);
  });
}

test('one claim of every grade is still rejected without content inspection', () => {
  const claims = [
    { contract_version: 'rev-claim-v1', classification: 'verified_fact', evidence_ids: ['ev-1'] },
    { contract_version: 'rev-claim-v1', classification: 'calculated_observation', evidence_ids: ['ev-1'] },
    { contract_version: 'rev-claim-v1', classification: 'hypothesis', evidence_ids: [] },
    { contract_version: 'rev-claim-v1', classification: 'unknown' },
  ];
  assert.equal(_validateOrchestrateResponse({ ...validAnalysis(), claims }), false);
});

test('null classification payloads fail closed like the investigation boundary', () => {
  assert.equal(_validateOrchestrateResponse({ ...validAnalysis(), claims: null }), false);
  assert.equal(_validateOrchestrateResponse({ ...validAnalysis(), facts: null }), false);
});
