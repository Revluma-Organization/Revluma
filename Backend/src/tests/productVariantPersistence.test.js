'use strict';
/**
 * Normalized variant persistence: every variant is stored independently,
 * stale variant rows are reconciled, and both GraphQL money shapes work.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const GRAPHQL_PATH = require.resolve('../services/shopifyGraphql');
const DB_PATH = require.resolve('../configs/database');

function graphqlStub(handler) {
  const calls = [];
  const stub = async (store, query, variables) => {
    calls.push({ query, variables });
    return handler(query, variables, calls);
  };
  require.cache[GRAPHQL_PATH] = { id: GRAPHQL_PATH, filename: GRAPHQL_PATH, loaded: true, exports: { shopifyGraphql: stub } };
  return calls;
}

function prismaStub(store) {
  store.rows = store.rows || [];
  store.variantRows = store.variantRows || [];
  const prisma = {
    products: {
      upsert: async ({ create }) => ({ id: `prod-${create.external_id}`, ...create }),
      deleteMany: async () => ({ count: 0 }),
    },
    product_variants: {
      upsert: async ({ where, create, update }) => {
        const id = where.store_id_external_id.external_id;
        const existing = store.variantRows.find((row) => row.external_id === id);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        store.variantRows.push(create);
        return create;
      },
      deleteMany: async ({ where }) => {
        const keep = where.external_id?.notIn ?? null;
        const before = store.variantRows.length;
        store.variantRows = store.variantRows.filter((row) => {
          if (row.store_id !== where.store_id || row.product_external_id !== where.product_external_id) return true;
          return keep ? keep.includes(row.external_id) : false;
        });
        return { count: before - store.variantRows.length };
      },
    },
  };
  require.cache[DB_PATH] = { id: DB_PATH, filename: DB_PATH, loaded: true, exports: { prisma } };
  return store;
}

function loadSync() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes('productSync')) delete require.cache[key];
  }
  return require('../services/productSync');
}

const STORE = { id: '11111111-1111-1111-1111-111111111111' };

function fixture(priceShape = 'scalar') {
  const m = (amount) => priceShape === 'scalar' ? amount : { amount, currencyCode: 'USD' };
  return {
    id: 'gid://shopify/Product/100', title: 'Fixture', handle: 'fixture',
    description: '', productType: 'Widget', vendor: 'V', status: 'ACTIVE',
    createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', publishedAt: '2026-09-02T00:00:00Z',
    tags: [], options: [{ name: 'Size', position: 1, values: ['S', 'M'] }],
    priceRangeV2: { minVariantPrice: { amount: '19.99', currencyCode: 'USD' } },
    compareAtPriceRange: { maxVariantCompareAtPrice: { amount: '29.99', currencyCode: 'USD' } },
    variants: {
      nodes: [
        { id: 'gid://shopify/ProductVariant/1001', title: 'S', sku: 'SKU-S', barcode: '1', position: 1, price: m('19.99'), compareAtPrice: m('29.99'), availableForSale: true, selectedOptions: [{ name: 'Size', value: 'S' }], inventoryItem: { id: 'gid://shopify/InventoryItem/9001', tracked: true, requiresShipping: true, measurement: { weight: { value: 0.4, unit: 'KILOGRAMS' } } } },
        { id: 'gid://shopify/ProductVariant/1002', title: 'M', sku: 'SKU-M', barcode: null, position: 2, price: m('24.99'), compareAtPrice: null, availableForSale: false, selectedOptions: [{ name: 'Size', value: 'M' }], inventoryItem: { id: 'gid://shopify/InventoryItem/9002', tracked: false, requiresShipping: true, measurement: { weight: { value: 0.5, unit: 'KILOGRAMS' } } } },
      ],
      pageInfo: { hasNextPage: false, endCursor: 'v1' },
    },
    featuredImage: null,
  };
}

function pagedProducts(nodes, { hasNextPage = false, endCursor = 'p1' } = {}) {
  return { products: { nodes, pageInfo: { hasNextPage, endCursor } } };
}

test('syncProducts persists every variant independently with exact prices', async () => {
  const state = prismaStub({});
  graphqlStub((query) => {
    assert.ok(query.includes('RevlumaProducts'));
    return pagedProducts([fixture()]);
  });
  const { syncProducts } = loadSync();
  await syncProducts(STORE);
  assert.equal(state.variantRows.length, 2, 'both variants persisted');
  const [s, m] = state.variantRows.sort((a, b) => a.position - b.position);
  assert.equal(s.external_id, '1001');
  assert.equal(s.product_external_id, '100');
  assert.equal(String(s.price), '19.99');
  assert.equal(String(s.compare_at_price), '29.99');
  assert.equal(s.inventory_item_external_id, '9001');
  assert.equal(s.tracked, true);
  assert.equal(s.available_for_sale, true);
  assert.equal(Number(s.weight), 0.4);
  assert.equal(s.weight_unit, 'KILOGRAMS');
  assert.deepEqual(s.selected_options, [{ name: 'Size', value: 'S' }]);
  assert.equal(m.price, '24.99');
});

test('stale variants of the product are reconciled (delete of vanished rows)', async () => {
  const state = prismaStub({ variantRows: [
    { store_id: STORE.id, product_external_id: '100', external_id: '9999', title: 'Gone', price: '1.00' },
  ] });
  graphqlStub((query) => pagedProducts([fixture()]));
  const { syncProducts } = loadSync();
  await syncProducts(STORE);
  const remaining = state.variantRows.map((row) => row.external_id).sort();
  assert.deepEqual(remaining, ['1001', '1002'], 'vanished variant row deleted; current rows kept');
});

test('MoneyV2-object prices are accepted as well as scalar decimals', async () => {
  const state = prismaStub({});
  graphqlStub((query) => pagedProducts([fixture('moneyv2')]));
  const { syncProducts } = loadSync();
  await syncProducts(STORE);
  assert.equal(state.variantRows.length, 2);
  assert.equal(String(state.variantRows.find((r) => r.external_id === '1001').price), '19.99');
});
