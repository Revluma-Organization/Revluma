'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { nextConnectionCursor } = require('../services/shopifySync');

test('pagination finishes only with an explicit terminal page', () => {
  assert.equal(nextConnectionCursor({ nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }, null, 'orders'), null);
  assert.equal(nextConnectionCursor({ nodes: [{ id: 1 }], pageInfo: { hasNextPage: true, endCursor: 'cursor-1' } }, null, 'orders'), 'cursor-1');
});
test('rejects malformed, cursorless, and stalled Shopify pages', () => {
  for (const connection of [
    null, {}, { nodes: [], pageInfo: {} },
    { nodes: [], pageInfo: { hasNextPage: true, endCursor: null } },
    { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'same' } },
  ]) {
    assert.throws(() => nextConnectionCursor(connection, 'same', 'orders'), /pagination_(invalid|stalled)/);
  }
});
