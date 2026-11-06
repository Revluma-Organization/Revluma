'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const DB_PATH = require.resolve('../configs/database');
require.cache[DB_PATH] = { id: DB_PATH, filename: DB_PATH, loaded: true, exports: { prisma: {} } };
const service = require('../services/authorizedDataService');
const { SCOPES_QUERY } = require('../services/shopifyProductAction');
const { definitions } = require('../services/authorizedResourceCatalog');

const ORG = '11111111-1111-4111-8111-111111111111';
const STORE = '22222222-2222-4222-8222-222222222222';
const ALL_SCOPES = ['read_products', 'write_products', 'read_content', 'read_customers', 'read_orders', 'read_metaobjects', 'read_metaobject_definitions'];
function dbStub() {
  const rows = [{ source_id: 'stale', store_id: STORE, resource_id: 'collections', sync_run_id: 'old' }];
  const calls = { ledger: [], deleted: 0 };
  const db = {
    rows, calls,
    stores: { findFirst: async ({ where }) => where.id === STORE && where.organization_id === ORG ? { id: STORE, organization_id: ORG, platform: 'shopify', access_token: 'encrypted', shop_domain: 'merchant.myshopify.com' } : null },
    commerce_resource_records: {
      findMany: async () => rows.map(row => ({ source_id: row.source_id })),
      deleteMany: async () => { calls.deleted += 1; rows.length = 0; },
      createMany: async ({ data }) => { rows.push(...data); return { count: data.length }; },
      count: async ({ where }) => rows.filter(row => row.sync_run_id === where.sync_run_id).length,
    },
    $transaction: async callback => callback(db),
  };
  return db;
}
function ledgerStub(db) {
  return {
    beginAttempt: async (...args) => { db.calls.ledger.push(['begin', ...args.slice(0, 2)]); },
    recordSuccess: async (store, resource, report) => { db.calls.ledger.push(['success', store, resource, report]); },
    recordFailure: async (store, resource, error) => { db.calls.ledger.push(['failure', store, resource, error.code]); },
    mergeCheckpoint: async (store, resource, checkpoint) => { db.calls.ledger.push(['checkpoint', store, resource, checkpoint]); },
  };
}
function graphqlFor(handler, scopes = ALL_SCOPES) {
  const calls = [];
  const graphql = async (_store, query, variables) => {
    calls.push({ query, variables });
    if (query === SCOPES_QUERY) return { currentAppInstallation: { accessScopes: scopes.map(handle => ({ handle })) } };
    return handler(query, variables);
  };
  return { graphql, calls };
}
function connection(nodes, hasNextPage = false, endCursor = null) { return { nodes, pageInfo: { hasNextPage, endCursor } }; }

test('live resource reads enforce scopes, fixed queries, and pagination bounds', async () => {
  const db = dbStub();
  const { graphql, calls } = graphqlFor((query, variables) => {
    assert.equal(query, definitions.collections.query);
    assert.deepEqual(variables, { first: 25, after: 'cursor' });
    return { collections: connection([{ id: 'gid://shopify/Collection/1', title: 'Summer' }]) };
  });
  const result = await service.getAuthorizedResourcePage(STORE, ORG, 'collections', { first: '25', after: 'cursor' }, { db, graphql });
  assert.equal(result.records[0].title, 'Summer');
  assert.equal(result.coverage.persisted, false);
  assert.equal(calls.length, 2);
  await assert.rejects(service.getAuthorizedResourcePage(STORE, ORG, 'collections', { first: '101' }, { db, graphql }), error => error.code === 'INVALID_RESOURCE_PAGE_SIZE');
  await assert.rejects(service.getAuthorizedResourcePage(STORE, ORG, 'not-built', {}, { db, graphql }), error => error.code === 'RESOURCE_NOT_IMPLEMENTED');
});

test('write scope satisfies corresponding read access and owner type stays server controlled', async () => {
  const db = dbStub();
  const { graphql, calls } = graphqlFor(() => ({ metafields: connection([]) }), ['write_products']);
  const result = await service.getAuthorizedResourcePage(STORE, ORG, 'metafields.products', {}, { db, graphql });
  assert.equal(result.records.length, 0);
  assert.equal(calls[1].variables.ownerType, 'PRODUCT');
});

test('missing live scope and cross-tenant stores fail before provider resource reads', async () => {
  const db = dbStub();
  const { graphql, calls } = graphqlFor(() => { throw new Error('must not read'); }, []);
  await assert.rejects(service.getAuthorizedResourcePage(STORE, ORG, 'collections', {}, { db, graphql }), error => error.code === 'REQUIRED_SCOPE_NOT_GRANTED');
  assert.equal(calls.length, 1);
  await assert.rejects(service.getAuthorizedResourcePage(STORE, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'collections', {}, { db, graphql }), error => error.code === 'SHOPIFY_STORE_NOT_FOUND');
});

test('nested unfinished connections fail closed instead of claiming complete data', async () => {
  const db = dbStub();
  const { graphql } = graphqlFor(() => ({ products: connection([{ id: 'gid://shopify/Product/1', media: connection([], true, 'nested-cursor') }]) }));
  await assert.rejects(service.getAuthorizedResourcePage(STORE, ORG, 'product.media', {}, { db, graphql }), error => error.code === 'NESTED_PAGINATION_INCOMPLETE');
});

test('full sync atomically replaces snapshots, removes stale ids, and writes reconciliation evidence', async () => {
  const db = dbStub();
  const { graphql } = graphqlFor((query, variables) => ({ collections: connection([{ id: `gid://shopify/Collection/${variables.after ? 2 : 1}`, title: variables.after ? 'Second' : 'First' }], !variables.after, variables.after ? null : 'next') }));
  const result = await service.syncAuthorizedResource(STORE, ORG, 'collections', { db, graphql, ledger: ledgerStub(db) });
  assert.equal(result.discovered, 2); assert.equal(result.persisted, 2); assert.equal(result.deleted, 1);
  assert.equal(result.reconciliation.missing, 0); assert.equal(db.calls.deleted, 1);
  assert.equal(db.rows.every(row => row.resource_id === 'collections' && row.content_hash.length === 64), true);
  const success = db.calls.ledger.find(call => call[0] === 'success');
  assert.equal(success[3].pagesCompleted, 2); assert.equal(success[3].paginationComplete, true);
  assert.equal(db.calls.ledger.find(call => call[0] === 'checkpoint')[3].reconciliation.duplicates, 0);
});

test('duplicate or missing source ids prevent any destructive persistence', async () => {
  const db = dbStub();
  const { graphql } = graphqlFor(() => ({ collections: connection([{ id: 'same' }, { id: 'same' }]) }));
  await assert.rejects(service.syncAuthorizedResource(STORE, ORG, 'collections', { db, graphql, ledger: ledgerStub(db) }), error => error.code === 'RESOURCE_DUPLICATE_OR_MISSING_ID');
  assert.equal(db.calls.deleted, 0); assert.equal(db.rows.length, 1);
  assert.equal(db.calls.ledger.some(call => call[0] === 'failure'), true);
});

test('singleton shop policies have source ids and no fabricated page cursor', async () => {
  const db = dbStub();
  const { graphql } = graphqlFor(() => ({ shop: { shopPolicies: [{ type: 'PRIVACY_POLICY', body: 'Policy', url: 'https://shop/privacy' }] } }));
  const result = await service.getAuthorizedResourcePage(STORE, ORG, 'shop.policies', {}, { db, graphql });
  assert.equal(result.records[0].type, 'PRIVACY_POLICY'); assert.equal(result.page_info.has_next_page, false);
  assert.equal(service.sourceId('shop.policies', result.records[0]), 'PRIVACY_POLICY');
});
