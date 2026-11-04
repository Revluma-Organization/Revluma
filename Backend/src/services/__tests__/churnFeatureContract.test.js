'use strict';

// Production hardening Phase 5 — churn feature contract.
//
// Root cause of the 11 hourly `daily_churn_customer_failed` errors: the
// financial-integrity rule (never treat an unlabelled or mixed-currency LTV
// as money) sends `avg_order_value: null`, while the churn feature validator
// demanded a finite number for every feature. Every customer whose stored
// LTV lacked a verified currency failed validation before the request ever
// reached Python — all 11 active customers of the test store, every run.
//
// The contract now distinguishes "unknown money" (null, legal for the two
// LTV-derived fields) from "broken feature" (null/NaN anywhere else).

const test = require('node:test');
const assert = require('node:assert/strict');

const { _validateChurnFeatures, CHURN_FEATURES } = require('../mlService');

function baseFeatures() {
  const features = {};
  for (const name of CHURN_FEATURES) features[name] = 0;
  features.days_since_last_purchase = 12;
  features.past_orders_total = 2;
  features.rfm_recency_score = 3;
  features.rfm_frequency_score = 2;
  features.rfm_monetary_score = 2;
  return features;
}

test('a fully numeric payload stays valid', () => {
  const result = _validateChurnFeatures(baseFeatures());
  assert.deepEqual(result, { valid: true });
});

test('an unverified avg_order_value (null) is accepted, not a failure', () => {
  const features = baseFeatures();
  features.avg_order_value = null; // financial integrity: unlabelled currency
  assert.deepEqual(_validateChurnFeatures(features), { valid: true });
});

test('null remains invalid for every non-money feature', () => {
  for (const name of CHURN_FEATURES) {
    if (name === 'avg_order_value') continue;
    const features = baseFeatures();
    features[name] = null;
    const result = _validateChurnFeatures(features);
    assert.equal(result.valid, false, `${name}: null must stay invalid`);
    assert.match(result.message, /Invalid churn feature/);
  }
});

test('NaN and missing keys stay invalid', () => {
  const nan = baseFeatures();
  nan.avg_order_value = NaN;
  assert.equal(_validateChurnFeatures(nan).valid, false);

  const missing = baseFeatures();
  delete missing.avg_order_value;
  assert.equal(_validateChurnFeatures(missing).valid, false);
});
