'use strict';
/**
 * Product-sync source-to-DB reconciliation (fixture-verified).
 *
 * The production stores currently expose no catalogue rows, so live
 * reconciliation is exercised through a deterministic fixture replicating the
 * authorized Shopify response shape. This suite asserts the CONTRACT that a
 * real sync must satisfy: counts, pages, idempotent re-runs, exact decimal
 * persistence, archived/draft handling, variant expansion, fail-closed
 * malformed payloads, and the documented (approval-gated) gap for
 * source-absent rows.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const GRAPHQL_PATH = require.resolve('../services/shopifyGraphql');
const DB_PATH = require.resolve('../configs/database');

const STORE = { id: 'store-fixture', shop_domain: 'fixture.myshopify.com', access_token: 'enc' };

function prismaStub(initial) {
  const store = { rows: [...(initial || [])], upsertCalls: 0, deleteCalls: [], variantRows: [] };
  const prisma = {
    products: {
      upsert: async ({ where, create, update }) => {
        store.upsertCalls += 1;
        const externalId = where.store_id_external_id.external_id;
        const existing = store.rows.find((row) => row.store_id === STORE.id && row.external_id === externalId);
        if (existing) {
          Object.assign(existing, update, { external_id: existing.external_id, store_id: existing.store_id });
          return existing;
        }
        const row = { id: `prod-${store.rows.length + 1}`, ...create };
        store.rows.push(row);
        return row;
      },
      deleteMany: async ({ where }) => {
        store.deleteCalls.push(where);
        const before = store.rows.length;
        store.rows = store.rows.filter((row) => !(row.store_id === where.store_id && row.external_id === where.external_id));
        return { count: before - store.rows.length };
      },
      findMany: async ({ where } = {}) => store.rows.filter((row) => (!where?.store_id || row.store_id === where.store_id)),
    },
    product_variants: {
      upsert: async ({ where, create, update }) => {
        const id = where.store_id_external_id.external_id;
        const existing = store.variantRows.find((row) => row.external_id === id);
        if (existing) {
          Object.assign(existing, update, { external_id: existing.external_id, store_id: existing.store_id });
          return existing;
        }
        const row = { id: `var-${store.variantRows.length + 1}`, ...create };
        store.variantRows.push(row);
        return row;
      },
      deleteMany: async ({ where } = {}) => {
        const notIn = where?.external_id?.notIn ?? null;
        const before = store.variantRows.length;
        store.variantRows = store.variantRows.filter((row) => {
          if (row.store_id !== where.store_id) return true;
          if (where.product_external_id && row.product_external_id !== where.product_external_id) return true;
          if (notIn) return notIn.includes(row.external_id);
          return row.external_id !== where.external_id;
        });
        return { count: before - store.variantRows.length };
      },
      findMany: async () => [...store.variantRows],
    },
  };
  require.cache[DB_PATH] = { id: DB_PATH, filename: DB_PATH, loaded: true, exports: { prisma } };
  return store;
}

function graphqlStub(handler) {
  const calls = [];
  const stub = async (store, query, variables) => {
    calls.push({ query, variables });
    return handler(query, variables, calls);
  };
  require.cache[GRAPHQL_PATH] = { id: GRAPHQL_PATH, filename: GRAPHQL_PATH, loaded: true, exports: { shopifyGraphql: stub } };
  return calls;
}

function loadSync() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes('productSync')) delete require.cache[key];
  }
  return require('../services/productSync');
}

function fixtureProduct(id, { status = 'ACTIVE', updatedAt = '2026-10-01T00:00:00Z', createdAt = '2026-09-01T00:00:00Z', price = '19.99', compareAt = '29.99', variants } = {}) {
  const variantNodes = variants || [
    { id: `gid://shopify/ProductVariant/${id}1`, title: 'Default Title', sku: `SKU-${id}`, barcode: '0123456789', position: 1, price, compareAtPrice: compareAt, inventoryItem: { measurement: { weight: { value: 0.5, unit: 'KILOGRAMS' } } } },
  ];
  return {
    id: `gid://shopify/Product/${id}`, title: `Fixture Product ${id}`, handle: `fixture-product-${id}`,
    description: 'Fixture description', productType: 'Widget', vendor: 'VendorCo', status,
    createdAt, updatedAt, publishedAt: '2026-09-02T00:00:00Z',
    tags: ['launch', 'fixture'],
    options: [{ name: 'Size', position: 1, values: ['S', 'M'] }],
    priceRangeV2: { minVariantPrice: { amount: price, currencyCode: 'USD' } },
    compareAtPriceRange: { maxVariantCompareAtPrice: { amount: compareAt, currencyCode: 'USD' } },
    variants: { nodes: variantNodes, pageInfo: { hasNextPage: false, endCursor: 'v-end' } },
    featuredImage: { url: 'https://cdn.example.com/img.png', altText: 'img' },
  };
}

function productsResponse(nodes, { hasNextPage = false, endCursor = 'page-end' } = {}) {
  return { products: { nodes, pageInfo: { hasNextPage, endCursor } } };
}

test('reconciliation: full catalogue (120 products, 3 pages) persists with exact decimals, zero duplicates', async () => {
  const state = prismaStub();
  const all = Array.from({ length: 120 }, (_, index) => fixtureProduct(String(1000 + index)));
  const calls = graphqlStub((query, variables) => {
    if (!query.includes('RevlumaProducts')) throw new Error('unexpected query');
    const after = variables.after == null ? 0 : Number(String(variables.after).split(':')[1]);
    const slice = all.slice(after, after + 50);
    const next = after + 50;
    return productsResponse(slice, { hasNextPage: next < all.length, endCursor: `page:${next}` });
  });
  const { syncProducts } = loadSync();
  const count = await syncProducts(STORE);
  assert.equal(count, 120);
  assert.equal(state.rows.length, 120);
  const ids = new Set(state.rows.map((row) => row.external_id));
  assert.equal(ids.size, 120);
  const pages = calls.filter((call) => call.query.includes('RevlumaProducts'));
  assert.equal(pages.length, 3);
  assert.equal(String(state.rows[0].price), '19.99');
  assert.equal(state.rows[0].dimensions.price_currency, 'USD');
});

test('reconciliation: re-sync is idempotent, preserves created_at, propagates source updated_at', async () => {
  const state = prismaStub();
  let version = 1;
  graphqlStub((query) => {
    if (!query.includes('RevlumaProducts')) throw new Error('unexpected query');
    const node = fixtureProduct('42', { updatedAt: version === 1 ? '2026-10-01T00:00:00Z' : '2026-10-05T00:00:00Z', price: version === 1 ? '19.99' : '24.99' });
    return productsResponse([node]);
  });
  let { syncProducts } = loadSync();
  await syncProducts(STORE);
  const createdAtFirst = state.rows[0].created_at;
  const updatedAtFirst = state.rows[0].updated_at;
  version = 2;
  ({ syncProducts } = loadSync());
  await syncProducts(STORE);
  assert.equal(state.rows.length, 1);
  assert.deepEqual(state.rows[0].created_at, createdAtFirst);
  assert.notDeepEqual(state.rows[0].updated_at, updatedAtFirst);
  assert.equal(String(state.rows[0].price), '24.99');
});

test('reconciliation: statuses map ACTIVE/ARCHIVED/DRAFT/UNLISTED to active/archived/draft/draft', async () => {
  const state = prismaStub();
  graphqlStub((query) => {
    if (!query.includes('RevlumaProducts')) throw new Error('unexpected query');
    return productsResponse([
      fixtureProduct('1', { status: 'ACTIVE' }),
      fixtureProduct('2', { status: 'ARCHIVED' }),
      fixtureProduct('3', { status: 'DRAFT' }),
      fixtureProduct('4', { status: 'UNLISTED' }),
    ]);
  });
  const { syncProducts } = loadSync();
  await syncProducts(STORE);
  const byId = Object.fromEntries(state.rows.map((row) => [row.external_id, row]));
  assert.equal(byId['1'].status, 'active');
  assert.equal(byId['2'].status, 'archived');
  assert.equal(byId['2'].purchasable, false);
  assert.equal(byId['3'].status, 'draft');
  assert.equal(byId['4'].status, 'draft');
});

test('reconciliation: >100-variant product expands via nested pagination before upsert', async () => {
  const state = prismaStub();
  const firstHundred = Array.from({ length: 100 }, (_, index) => ({
    id: `gid://shopify/ProductVariant/77-${index}`, title: `V${index}`, sku: `SKU-77-${index}`, barcode: null, position: index + 1, price: '9.99', compareAtPrice: null, inventoryItem: { measurement: { weight: { value: 0.1, unit: 'KILOGRAMS' } } },
  }));
  const nextFifty = Array.from({ length: 50 }, (_, index) => ({
    id: `gid://shopify/ProductVariant/77b-${index}`, title: `V${100 + index}`, sku: `SKU-77-${100 + index}`, barcode: null, position: 101 + index, price: '9.99', compareAtPrice: null, inventoryItem: { measurement: { weight: { value: 0.1, unit: 'KILOGRAMS' } } },
  }));
  graphqlStub((query, variables) => {
    if (query.includes('RevlumaProducts')) {
      const node = fixtureProduct('77', { variants: firstHundred });
      node.variants.pageInfo = { hasNextPage: true, endCursor: 'v-cursor-1' };
      return productsResponse([node]);
    }
    if (query.includes('RevlumaProductVariants')) {
      assert.equal(variables.after, 'v-cursor-1');
      return { node: { id: 'gid://shopify/Product/77', updatedAt: '2026-10-01T00:00:00Z', variants: { nodes: nextFifty, pageInfo: { hasNextPage: false, endCursor: 'v-end' } } } };
    }
    throw new Error('unexpected query');
  });
  const { syncProducts } = loadSync();
  const count = await syncProducts(STORE);
  assert.equal(count, 1);
  assert.equal(state.rows[0].dimensions.variant_count, 150);
});

test('reconciliation: malformed node fails loudly; earlier pages persist but the run reports failure', async () => {
  const state = prismaStub();
  graphqlStub((query, variables) => {
    if (!query.includes('RevlumaProducts')) throw new Error('unexpected query');
    if (variables.after == null) return productsResponse([fixtureProduct('good-1')], { hasNextPage: true, endCursor: 'p2' });
    // Valid variants connection (so the run reaches mapping) but no product id:
    return productsResponse([{
      title: 'Node without gid', status: 'ACTIVE', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
      variants: { nodes: [{ id: 'gid://shopify/ProductVariant/x1', title: 'v', sku: 'S', barcode: null, position: 1, price: '1.00', compareAtPrice: null, inventoryItem: { measurement: { weight: { value: 0.1, unit: 'KILOGRAMS' } } } }], pageInfo: { hasNextPage: false, endCursor: 'v-end' } },
    }]);
  });
  const { syncProducts } = loadSync();
  await assert.rejects(syncProducts(STORE), { code: 'SHOPIFY_PRODUCT_MALFORMED' });
  // Loud failure + idempotent convergence: the caller never advances last_synced_at,
  // and the next full sync overwrites these rows deterministically.
  assert.equal(state.rows.length, 1);
});

test('reconciliation: empty source is a no-op write of zero rows', async () => {
  const state = prismaStub();
  graphqlStub((query) => {
    if (!query.includes('RevlumaProducts')) throw new Error('unexpected query');
    return productsResponse([]);
  });
  const { syncProducts } = loadSync();
  const count = await syncProducts(STORE);
  assert.equal(count, 0);
  assert.equal(state.rows.length, 0);
  assert.equal(state.upsertCalls, 0);
});

test('KNOWN GAP (approval-gated): full sync never removes rows hard-deleted in source', async () => {
  // Documents current behavior so it cannot silently change: a row that exists
  // locally but is absent from the source is PRESERVED. Closing this gap means
  // a bulk delete on production data and requires explicit authorization
  // (MASTER-EXECUTION-REGISTER.md → Approval-gated items, item 9).
  const stale = { id: 'prod-stale', store_id: STORE.id, external_id: 'stale-1', name: 'Stale', status: 'active' };
  const state = prismaStub([stale]);
  graphqlStub((query) => {
    if (!query.includes('RevlumaProducts')) throw new Error('unexpected query');
    return productsResponse([]);
  });
  const { syncProducts } = loadSync();
  const count = await syncProducts(STORE);
  assert.equal(count, 0);
  assert.equal(state.rows.length, 1);
  assert.equal(state.rows[0].external_id, 'stale-1');
});
