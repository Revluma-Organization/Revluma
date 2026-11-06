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
const ALL_SCOPES = ['read_products', 'write_products', 'read_content', 'read_customers', 'read_orders', 'read_metaobjects', 'read_metaobject_definitions', 'read_legal_policies', 'read_discounts'];
function dbStub() {
  const rows = [{ source_id: 'stale', store_id: STORE, resource_id: 'collections', sync_run_id: 'old', active: true }];
  const calls = { ledger: [], deleted: 0 };
  const db = {
    rows, calls,
    stores: { findFirst: async ({ where }) => where.id === STORE && where.organization_id === ORG ? { id: STORE, organization_id: ORG, platform: 'shopify', access_token: 'encrypted', shop_domain: 'merchant.myshopify.com' } : null },
    commerce_resource_records: {
      findMany: async ({ where = {} } = {}) => rows.filter(row => (where.active === undefined || row.active === where.active) && (!where.sync_run_id || row.sync_run_id === where.sync_run_id)).map(row => ({ source_id: row.source_id })),
      deleteMany: async ({ where = {} } = {}) => {
        const before = rows.length;
        for (let index = rows.length - 1; index >= 0; index -= 1) {
          const row = rows[index];
          if ((where.active === undefined || row.active === where.active) && (!where.sync_run_id || row.sync_run_id === where.sync_run_id)) rows.splice(index, 1);
        }
        calls.deleted += before - rows.length;
        return { count: before - rows.length };
      },
      createMany: async ({ data }) => {
        const ids = new Set();
        for (const row of data) {
          if (ids.has(row.source_id) || rows.some(existing => existing.sync_run_id === row.sync_run_id && existing.source_id === row.source_id)) throw Object.assign(new Error('duplicate'), { code: 'P2002' });
          ids.add(row.source_id);
        }
        rows.push(...data); return { count: data.length };
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const row of rows) if ((!where.sync_run_id || row.sync_run_id === where.sync_run_id) && (where.active === undefined || row.active === where.active)) { Object.assign(row, data); count += 1; }
        return { count };
      },
      count: async ({ where }) => rows.filter(row => row.sync_run_id === where.sync_run_id && (where.active === undefined || row.active === where.active)).length,
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

test('write scope satisfies corresponding read access with server-owned metafield queries', async () => {
  const db = dbStub();
  const { graphql, calls } = graphqlFor(() => ({ products: connection([]) }), ['write_products']);
  const result = await service.getAuthorizedResourcePage(STORE, ORG, 'metafields.products', {}, { db, graphql });
  assert.equal(result.records.length, 0);
  assert.equal(calls[1].variables.ownerType, undefined);
  assert.match(calls[1].query, /products\(first:/);
});

test('missing live scope and cross-tenant stores fail before provider resource reads', async () => {
  const db = dbStub();
  const { graphql, calls } = graphqlFor(() => { throw new Error('must not read'); }, []);
  await assert.rejects(service.getAuthorizedResourcePage(STORE, ORG, 'collections', {}, { db, graphql }), error => error.code === 'REQUIRED_SCOPE_NOT_GRANTED');
  assert.equal(calls.length, 1);
  await assert.rejects(service.getAuthorizedResourcePage(STORE, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'collections', {}, { db, graphql }), error => error.code === 'SHOPIFY_STORE_NOT_FOUND');
});

test('nested connections are followed to completion with fixed node queries', async () => {
  const db = dbStub();
  const { graphql, calls } = graphqlFor((query) => query.includes('RevlumaNested_Product_media')
    ? { node: { media: connection([{ id: 'gid://shopify/MediaImage/2', alt: 'second' }]) } }
    : { products: connection([{ id: 'gid://shopify/Product/1', media: connection([{ id: 'gid://shopify/MediaImage/1', alt: 'first' }], true, 'nested-cursor') }]) });
  const result = await service.getAuthorizedResourcePage(STORE, ORG, 'product.media', {}, { db, graphql });
  assert.deepEqual(result.records[0].media.nodes.map(row => row.id), ['gid://shopify/MediaImage/1', 'gid://shopify/MediaImage/2']);
  assert.equal(result.records[0].media.pageInfo.hasNextPage, false);
  assert.equal(calls[2].variables.after, 'nested-cursor');
});

test('discount codes paginate through the parent DiscountNode and concrete discount type', async () => {
  const db = dbStub();
  const { graphql, calls } = graphqlFor((query) => query.includes('RevlumaNested_DiscountNode_codes')
    ? { node: { discount: { codes: connection([{ code: 'SECOND' }]) } } }
    : { discountNodes: connection([{ id: 'gid://shopify/DiscountNode/1', discount: { __typename: 'DiscountCodeBasic', title: 'Sale', codes: connection([{ code: 'FIRST' }], true, 'codes-cursor') } }]) });
  const result = await service.getAuthorizedResourcePage(STORE, ORG, 'discount-nodes', {}, { db, graphql });
  assert.deepEqual(result.records[0].discount.codes.nodes.map(row => row.code), ['FIRST', 'SECOND']);
  assert.match(calls[2].query, /node\(id: \$id\).*DiscountNode.*discount \{ \.\.\. on DiscountCodeBasic.*codes\(first:/);
  assert.equal(calls[2].variables.id, 'gid://shopify/DiscountNode/1');
  assert.equal(calls[2].variables.after, 'codes-cursor');
});

test('full sync atomically replaces snapshots, removes stale ids, and writes reconciliation evidence', async () => {
  const db = dbStub();
  const { graphql } = graphqlFor((query, variables) => ({ collections: connection([{ id: `gid://shopify/Collection/${variables.after ? 2 : 1}`, title: variables.after ? 'Second' : 'First' }], !variables.after, variables.after ? null : 'next') }));
  const result = await service.syncAuthorizedResource(STORE, ORG, 'collections', { db, graphql, ledger: ledgerStub(db) });
  assert.equal(result.discovered, 2); assert.equal(result.persisted, 2); assert.equal(result.deleted, 1);
  assert.equal(result.reconciliation.missing, 0); assert.equal(db.calls.deleted, 1);
  assert.equal(db.rows.every(row => row.resource_id === 'collections' && row.content_hash.length === 64 && row.active === true), true);
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

test('full reads are not capped at 100 pages or 10,000 records', async () => {
  let pageNumber = 0;
  const { graphql } = graphqlFor(() => {
    pageNumber += 1;
    return { collections: connection([{ id: `collection-${pageNumber}` }], pageNumber < 101, pageNumber < 101 ? `cursor-${pageNumber}` : null) };
  });
  const result = await service.fetchAll({ id: STORE }, 'collections', graphql);
  assert.equal(result.pagesCompleted, 101);
  assert.equal(result.records.length, 101);
});
