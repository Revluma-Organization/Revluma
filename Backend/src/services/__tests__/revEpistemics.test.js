'use strict';

/**
 * Task 204: Node mirror parity for the canonical epistemic claim contract.
 * The golden file is generated from the PYTHON module
 * (python/scripts/gen_epistemic_golden.py); the same claim must produce the
 * same stable error codes on both runtimes, and the rollup must match.
 */

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  CLAIM_CONTRACT_VERSION,
  IMPACT_ASSERTED,
  epistemicRollup,
  normalizeCurrency,
  validateClaim,
  validateClaims,
} = require('../revEpistemics');
const golden = require('./revEpistemics.golden.json');

test('contract version and impact vocabulary match the pinned golden', () => {
  assert.equal(CLAIM_CONTRACT_VERSION, 'rev-claim-v1');
  assert.equal(CLAIM_CONTRACT_VERSION, golden.contract_version);
  assert.deepEqual(IMPACT_ASSERTED, ['lost', 'recoverable', 'saved', 'prevented', 'avoided', 'leakage']);
});

test('normalizeCurrency matches the Python normalizer', () => {
  assert.equal(normalizeCurrency('usd'), 'USD');
  assert.equal(normalizeCurrency(' USD '), 'USD');
  assert.equal(normalizeCurrency('ngn1'), null);
  assert.equal(normalizeCurrency(123), null);
  assert.equal(normalizeCurrency(null), null);
  assert.equal(normalizeCurrency('us'), null);
});

for (const entry of golden.cases) {
  test(`parity: ${entry.name}`, () => {
    const errors = validateClaim(entry.claim, entry.known_evidence, {
      organizationId: entry.organization_id,
      storeIds: entry.store_ids,
    });
    assert.deepEqual(errors, entry.errors, `case ${entry.name}`);
  });
}

test('parity: validateClaims set level (with a non-object entry)', () => {
  const { claims, items, organization_id, store_ids, errors } = golden.set_case;
  const got = validateClaims(claims, items, { organizationId: organization_id, storeIds: store_ids });
  assert.deepEqual(got, errors);
});

for (const entry of golden.rollup_cases) {
  test(`rollup parity: ${entry.name}`, () => {
    const rollup = epistemicRollup(entry.claims);
    assert.deepEqual(rollup, entry.rollup);
  });
}

// ── Boundary behaviour beyond the golden (Node-side rules) ─────────────────

test('a claim set with any invalid claim is rejected at the boundary', () => {
  const good = golden.cases.find((c) => c.name === 'count_claim_valid');
  const bad = golden.cases.find((c) => c.name === 'money_false_precision');
  const items = Object.values(good.known_evidence);
  const allValid = validateClaims([good.claim], items, {
    organizationId: good.organization_id, storeIds: good.store_ids,
  });
  assert.deepEqual(allValid, []);
  const withBad = validateClaims([good.claim, bad.claim], items, {
    organizationId: good.organization_id, storeIds: good.store_ids,
  });
  assert.ok(withBad.includes('currency_claim_false_precision'));
});

test('restated provenance claims are not re-derived against fresh evidence', () => {
  const entry = golden.cases.find((c) => c.name === 'restated_claim_valid');
  assert.deepEqual(validateClaim(entry.claim, {}, {
    organizationId: entry.organization_id, storeIds: entry.store_ids,
  }), []);
});
