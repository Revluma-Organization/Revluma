'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { definitions, authorizedResourceIds } = require('../services/authorizedResourceCatalog');
const { getResource } = require('../services/resourceRegistry');

 test('every fixed-query resource is registered and contains no merchant query input', () => {
  assert.ok(authorizedResourceIds().length >= 28);
  for (const id of authorizedResourceIds()) {
    const entry = definitions[id];
    assert.ok(getResource(id), `${id} has registry coverage`);
    assert.ok(entry.query.startsWith('query RevlumaAuthorized_'));
    assert.ok(entry.scopes.length > 0);
    assert.equal(entry.query.includes('$resourceId'), false);
    assert.equal(entry.query.includes('${id}'), false);
  }
});

test('metafield readers bind server-owned owner types', () => {
  for (const [id, ownerType] of Object.entries({ 'metafields.products': 'PRODUCT', 'metafields.orders': 'ORDER', 'metafields.customers': 'CUSTOMER', 'metafields.shop': 'SHOP' })) {
    assert.equal(definitions[id].variables.ownerType, ownerType);
    assert.ok(definitions[id].query.includes('ownerType: $ownerType'));
  }
});
