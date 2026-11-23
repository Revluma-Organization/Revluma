'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { validateClaim, validateClaims, epistemicRollup } = require('../revEpistemics');
function claim() {
  return { contract_version: 'rev-claim-v1', classification: 'verified_fact',
    organization_id: 'org-a', store_ids: ['store-a'],
    evidence_ids: ['ev-ok'], unit: 'count', value: 1, rounding: 'integer_count' };
}
function evidence() { return { 'ev-ok': { id: 'ev-ok', status: 'available' } }; }
test('valid claim remains accepted', () => {
  assert.deepEqual(validateClaim(claim(), evidence(), {
    organizationId: 'org-a', storeIds: ['store-a'] }), []);
});
test('non-array evidence IDs reject without throwing', () => {
  assert.ok(validateClaim({ ...claim(), evidence_ids: 'ev-ok' }, evidence())
    .includes('invalid_claim_evidence_ids'));
});
test('non-array claim store IDs reject without throwing', () => {
  assert.ok(validateClaim({ ...claim(), store_ids: { id: 'store-b' } }, evidence(), {
    storeIds: ['store-a'] }).includes('invalid_claim_store_ids'));
});
test('non-array hypothesis evidence rejects without throwing', () => {
  assert.ok(validateClaim({ ...claim(), classification: 'hypothesis',
    hypothesis: { verified: false, missing_evidence: 'not measured' } }, evidence())
    .includes('invalid_hypothesis_missing_evidence'));
});
test('malformed claims collection rejects', () => {
  assert.ok(validateClaims({ foo: 1 }, []).includes('invalid_claims_collection'));
});
test('malformed evidence collection rejects', () => {
  assert.ok(validateClaims([claim()], { foo: 1 }).includes('invalid_evidence_collection'));
});
test('inherited keys are never genuine evidence identifiers', () => {
  const codes = validateClaim({ ...claim(), evidence_ids: ['__proto__'] }, {});
  assert.ok(codes.includes('verified_fact_cites_unknown_evidence'));
  assert.ok(!codes.includes('verified_fact_cites_unavailable_evidence'));
});
test('null evidence registry rejects', () => {
  assert.ok(validateClaim(claim(), null).includes('invalid_evidence_registry'));
});
test('malformed allowed-store scope rejects', () => {
  assert.ok(validateClaim(claim(), evidence(), {
    storeIds: { store: 'store-a' } }).includes('invalid_allowed_store_scope'));
});
test('reserved metric names are safe in rollup', () => {
  const result = epistemicRollup([
    { classification: 'unknown', metric: '__proto__' },
    { classification: 'verified_fact', metric: 'constructor' }]);
  assert.deepEqual(Object.keys(result.metrics).sort(), ['__proto__', 'constructor']);
  assert.deepEqual(Object.getOwnPropertyDescriptor(result.metrics, '__proto__').value, ['unknown']);
  assert.equal(result.total, 2);
});
test('non-array rollup input is harmless', () => {
  assert.equal(epistemicRollup({ foo: 'bar' }).total, 0);
});
test('unrecognised grades never increment inherited count keys', () => {
  const result = epistemicRollup([{ classification: 'constructor', metric: 'orders' }]);
  assert.equal(result.total, 0);
  assert.equal(result.counts.verified_fact, 0);
});