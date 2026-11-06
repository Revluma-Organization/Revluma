'use strict';
/**
 * Product catalogue sync tests.
 *
 * Transport (shopifyGraphql) and persistence (configs/database) are mocked at
 * the module boundary; no Shopify or database traffic occurs.
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
  const prisma = {
    products: {
      upsert: async ({ where, create, update }) => {
        const existing = store.rows.find((row) => row.external_id === where.store_id_external_id.external_id);
        if (existing) {
          Object.assign(existing, update, { external_id: existing.external_id, store_id: existing.store_id });
          return existing;
        }
        const row = { id: `prod-${store.rows.length + 1}`, ...create };
        store.rows.push(row);
        return row;
      },
      deleteMany: async ({ where }) => {
        const before = store.rows.length;
        store.rows = store.rows.filter((row) => !(row.store_id === where.store_id && row.external_id === where.external_id));
        return { count: before - store.rows.length };
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

const STORE = { id: 'store-test', shop_domain: 'test.myshopify.com', access_token: 'enc' };

function productNode(id, { updatedAt = '2026-10-01T00:00:00Z', price = '19.99', compareAt = '29.99', variants } = {}) {
  const variantNodes = variants || [
    { id: `gid://shopify/ProductVariant/${id}1`, title: 'Default Title', sku: 'SKU-1', barcode: '0123456789', position: 1, price, compareAtPrice: compareAt, inventoryItem: { measurement: { weight: { value: 0.5, unit: 'KILOGRAMS' } } } },
  ];
  return {
    id: `gid://shopify/Product/${id}`, title: `Product ${id}`, handle: `product-${id}`,
    description: 'A product', productType: 'Widget', vendor: 'VendorCo', status: 'ACTIVE',
    createdAt: '2026-09-01T00:00:00Z', updatedAt, publishedAt: '2026-09-02T00:00:00Z',
    tags: ['launch'],
    options: [{ name: 'Size', position: 1, values: ['S', 'M'] }],
    priceRangeV2: { minVariantPrice: { amount: price, currencyCode: 'USD' } },
    compareAtPriceRange: { maxVariantCompareAtPrice: { amount: compareAt, currencyCode: 'USD' } },
    variants: { nodes: variantNodes, pageInfo: { hasNextPage: false, endCursor: 'v-end' } },
    featuredImage: { url: 'https://cdn.example.com/img.png', altText: 'img' },
  };
}

test('syncProducts persists mapped catalogue rows with exact decimal prices', async () => {
  const state = prismaStub({});
  graphqlStub((query) => {
    if (query.includes('RevlumaProducts')) {
      return { products: { nodes: [productNode('100'), productNode('101', { price: '5.50', compareAt: null })],
        pageInfo: { hasNextPage: false, endCursor: 'end' } } };
    }
    throw new Error('unexpected query');
  });
  const { syncProducts } = loadSync();
  const count = await syncProducts(STORE);
  assert.equal(count, 2);
  const first = state.rows.find((row) => row.external_id === '100');
  assert.equal(first.name, 'Product 100');
  assert.equal(String(first.price), '19.99');
  assert.equal(String(first.regular_price), '29.99');
  assert.equal(first.on_sale, true);
  assert.equal(first.purchasable, true);
  assert.equal(first.sku, 'SKU-1');
  assert.equal(first.status, 'active');
  assert.equal(first.dimensions.price_currency, 'USD');
  const second = state.rows.find((row) => row.external_id === '101');
  assert.equal(second.on_sale, false);
  assert.equal(second.sale_price, null);
});

test('syncProducts paginates and rejects a stalled cursor', async () => {
  prismaStub({});
  graphqlStub((query) => {
    if (query.includes('RevlumaProducts')) {
      return { products: { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'same-cursor' } } };
    }
    throw new Error('unexpected query');
  });
  const { syncProducts } = loadSync();
  await assert.rejects(syncProducts(STORE), { code: 'SHOPIFY_PAGINATION_STALLED' });
});

test('nested variants resume across pages before any upsert', async () => {
  const state = prismaStub({});
  graphqlStub((query, variables) => {
    if (query.includes('RevlumaProducts')) {
      const node = productNode('200');
      node.variants = { nodes: [node.variants.nodes[0]], pageInfo: { hasNextPage: true, endCursor: 'v1' } };
      return { products: { nodes: [node], pageInfo: { hasNextPage: false, endCursor: 'end' } } };
    }
    if (query.includes('RevlumaProductVariants')) {
      return { node: { id: variables.id, updatedAt: '2026-10-01T00:00:00Z',
        variants: { nodes: [{ id: `gid://shopify/ProductVariant/2002`, title: 'Large', sku: 'SKU-2', barcode: null, position: 2, price: '21.99', compareAtPrice: null, inventoryItem: { measurement: { weight: null } } }],
          pageInfo: { hasNextPage: false, endCursor: 'v2' } } } };
    }
    throw new Error('unexpected query');
  });
  const { syncProducts } = loadSync();
  const count = await syncProducts(STORE);
  assert.equal(count, 1);
  assert.equal(state.rows[0].dimensions.variant_count, 2);
});

test('a product changing mid-pagination fails closed before any upsert', async () => {
  const state = prismaStub({});
  graphqlStub((query, variables) => {
    if (query.includes('RevlumaProducts')) {
      const node = productNode('201');
      node.variants = { nodes: [node.variants.nodes[0]], pageInfo: { hasNextPage: true, endCursor: 'v1' } };
      return { products: { nodes: [node], pageInfo: { hasNextPage: false, endCursor: 'end' } } };
    }
    if (query.includes('RevlumaProductVariants')) {
      return { node: { id: variables.id, updatedAt: '2026-10-02T00:00:00Z', // different source version
        variants: { nodes: [{ id: `gid://shopify/ProductVariant/2012`, title: 'Changed', sku: 'SKU-2', barcode: null, position: 2, price: '1.00', compareAtPrice: null, inventoryItem: { measurement: { weight: null } } }],
          pageInfo: { hasNextPage: false, endCursor: 'v2' } } } };
    }
    throw new Error('unexpected query');
  });
  const { syncProducts } = loadSync();
  await assert.rejects(syncProducts(STORE), { code: 'SHOPIFY_VARIANTS_INCOMPLETE' });
  assert.equal(state.rows.length, 0);
});

test('price strings are kept exact (no float rounding)', async () => {
  const state = prismaStub({});
  graphqlStub((query) => {
    if (query.includes('RevlumaProducts')) {
      return { products: { nodes: [productNode('300', { price: '10.123', compareAt: null })],
        pageInfo: { hasNextPage: false, endCursor: 'end' } } };
    }
    throw new Error('unexpected query');
  });
  const { syncProducts } = loadSync();
  await syncProducts(STORE);
  assert.equal(String(state.rows[0].price), '10.123');
});

test('products webhooks refetch truth from Shopify and honour deletes', async () => {
  const state = prismaStub({});
  graphqlStub((query, variables) => {
    if (query.includes('RevlumaProduct(')) {
      return { node: productNode('500', { price: '12.00', compareAt: null }) };
    }
    throw new Error('unexpected query');
  });
  // commerceWebhookService pulls in many modules; reload the chain against the fakes.
  for (const key of Object.keys(require.cache)) {
    if (key.includes('commerceWebhookService') || key.includes('productSync')) delete require.cache[key];
  }
  const { processCommerceWebhook } = require('../services/commerceWebhookService');
  const created = await processCommerceWebhook({ provider: 'shopify', store: STORE, topic: 'products/create', payload: { id: 500 } });
  assert.equal(created.action, 'product_upserted');
  assert.equal(state.rows[0].external_id, '500');
  const deleted = await processCommerceWebhook({ provider: 'shopify', store: STORE, topic: 'products/delete', payload: { id: 500 } });
  assert.equal(deleted.action, 'product_deleted');
  assert.equal(state.rows.length, 0);
});

test('products webhook without an id is rejected loudly', async () => {
  prismaStub({});
  graphqlStub(() => { throw new Error('no transport expected'); });
  for (const key of Object.keys(require.cache)) {
    if (key.includes('commerceWebhookService') || key.includes('productSync')) delete require.cache[key];
  }
  const { processCommerceWebhook } = require('../services/commerceWebhookService');
  await assert.rejects(
    processCommerceWebhook({ provider: 'shopify', store: STORE, topic: 'products/create', payload: {} }),
    { code: 'PRODUCT_WEBHOOK_MALFORMED' });
});

test('deleteProduct removes only the targeted row for the store', async () => {
  const state = prismaStub({
    rows: [
      { id: 'p1', store_id: 'store-test', external_id: '400', name: 'A' },
      { id: 'p2', store_id: 'store-other', external_id: '400', name: 'B' },
    ],
  });
  graphqlStub(() => { throw new Error('no transport expected'); });
  const { deleteProduct } = loadSync();
  const result = await deleteProduct(STORE, '400');
  assert.equal(result.count, 1);
  assert.deepEqual(state.rows.map((row) => row.store_id), ['store-other']);
});

test('VARIANT_FIELDS uses inventoryItem.measurement.weight (ProductVariant.weight no longer exists)', async () => {
  const source = require('fs').readFileSync(require.resolve('../services/productSync'), 'utf8');
  const fieldsBlock = source.match(/const VARIANT_FIELDS = `([\s\S]*?)`;/)[1];
  assert.match(fieldsBlock, /inventoryItem\s*{\s*measurement\s*{\s*weight/);
  // A bare weight field on the variant node is the 2026-10 schema failure.
  assert.doesNotMatch(fieldsBlock, /\n\s*weight\s*{/);
});
