'use strict';
/**
 * Schema↔registry comparator: honest gap output only; never asserts we own data.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { compareRegistryAgainstSchema, isCommerceRoot } = require('../services/capabilityDiffer');
const { REGISTRY } = require('../services/resourceRegistry');

function schemaOf(queryFields) {
  return {
    queryType: { fields: queryFields.map(name => ({ name })) },
    mutationType: { fields: [] },
    types: [{ name: 'Order' }, { name: 'Product' }, { name: 'Customer' }],
  };
}

test('unavailable schema yields SCHEMA_UNAVAILABLE, not fabricated green', () => {
  const out = compareRegistryAgainstSchema({ queryType: { fields: [] }, types: [] }, REGISTRY);
  assert.equal(out.status, 'SCHEMA_UNAVAILABLE');
});

test('complete commerce schema surfaces known roots and flags unknown commerce-looking ones', () => {
  const fields = ['shop', 'products', 'customers', 'orders', 'abandonedCheckouts', 'inventoryItems', 'locations', 'webhookSubscriptions', 'metaobjects', 'metaobjectDefinitions', 'bulkOperations', 'discountNodes', 'pages', 'blogs', 'urlRedirects', 'themes', 'markets', 'someFutureMerchantResource'];
  const out = compareRegistryAgainstSchema(schemaOf(fields), REGISTRY);
  assert.notEqual(out.status, 'SCHEMA_UNAVAILABLE');
  const kinds = out.findings.map(f => f.kind);
  assert.ok(kinds.includes('schema_root_uncovered'));
  const flagged = out.findings.filter(f => f.kind === 'schema_root_uncovered').map(f => f.field);
  assert.ok(flagged.includes('someFutureMerchantResource') || flagged.includes('webhookSubscriptions'));
});

test('missing declared query roots are flagged as warnings', () => {
  const out = compareRegistryAgainstSchema(schemaOf(['shop', 'products']), REGISTRY);
  const missing = out.warnings.filter(w => w.kind === 'registry_query_root_absent').map(w => w.resource);
  assert.ok(missing.includes('orders'));
});

test('isCommerceRoot classifies commerce-looking fields conservatively', () => {
  assert.ok(isCommerceRoot('allProducts'));
  assert.ok(isCommerceRoot('latestOrder'));
  assert.ok(!isCommerceRoot('__typename'));
});
