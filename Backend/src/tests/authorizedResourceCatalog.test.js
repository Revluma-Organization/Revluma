'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { definitions, authorizedResourceIds } = require('../services/authorizedResourceCatalog');
const { getResource } = require('../services/resourceRegistry');

 test('every fixed-query resource is registered and contains no merchant query input', () => {
  assert.ok(authorizedResourceIds().length >= 27);
  for (const id of authorizedResourceIds()) {
    const entry = definitions[id];
    assert.ok(getResource(id), `${id} has registry coverage`);
    assert.ok(entry.query.startsWith('query RevlumaAuthorized_'));
    assert.ok(entry.scopes.length > 0);
    assert.equal(entry.query.includes('$resourceId'), false);
    assert.equal(entry.query.includes('${id}'), false);
  }
});

test('metafield readers use real owner connections and nested completion contracts', () => {
  for (const [id, root] of Object.entries({ 'metafields.products': 'products', 'metafields.orders': 'orders', 'metafields.customers': 'customers' })) {
    assert.equal(definitions[id].root, root);
    assert.ok(definitions[id].nested.metafields.selection.includes('namespace'));
  }
  assert.equal(definitions['metafields.shop'].singleton, true);
  assert.ok(definitions['product.media'].nested.media);
  assert.equal(definitions['analytics.reports'], undefined);
});
