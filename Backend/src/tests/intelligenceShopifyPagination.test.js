'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { nextConnectionCursor, fetchConnection } = require('../services/shopifySync');

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

test('multi-page Shopify sync preserves all fetched records in order', async () => {
  const cursors = [];
  const fetchPage = async (_store, _query, { after }) => {
    cursors.push(after);
    return { orders: after === null
      ? { nodes: [{ id: 'a' }], pageInfo: { hasNextPage: true, endCursor: 'next' } }
      : { nodes: [{ id: 'b' }], pageInfo: { hasNextPage: false, endCursor: 'next' } } };
  };
  const rows = await fetchConnection({}, '', 'orders', fetchPage);
  assert.deepEqual(rows.map(row => row.id), ['a', 'b']);
  assert.deepEqual(cursors, [null, 'next']);
});
test('Shopify sync rejects cursor stall without silently truncating records', async () => {
  const fetchPage = async () => ({ orders: { nodes: [{ id: 'a' }],
    pageInfo: { hasNextPage: true, endCursor: 'same' } } });
  await assert.rejects(fetchConnection({}, '', 'orders', fetchPage), /pagination_stalled/);
});
