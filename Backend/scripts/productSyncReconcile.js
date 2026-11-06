#!/usr/bin/env node
/**
 * Operator-run product catalogue reconciliation (source Shopify -> local DB).
 *
 * DRY-RUN BY DEFAULT. Prints a JSON plan: how many products the authorized
 * installation returns, how many local rows exist, which are missing locally,
 * and which local rows are absent from the source.
 *
 * The plan never implies a write will happen. Applying the deletion of
 * source-absent rows requires ALL of:
 *   --apply
 *   REVLUMA_RECONCILE_CONFIRM_DELETIONS=DELETE-SOURCE-ABSENT-PRODUCTS
 *   --store <exact store uuid>
 * and, when the source returns zero products, additionally
 *   REVLUMA_RECONCILE_ALLOW_EMPTY_SOURCE=ALLOW-EMPTY-SOURCE-DELETE
 *
 * This script never prints tokens, prices are not printed, and it never
 * mutates Shopify. Local deletions are limited to the computed
 * `absent_from_source` set for the one store named on the command line.
 *
 * Usage:
 *   node scripts/productSyncReconcile.js --store <store-uuid-or-myshopify-domain>
 *   node scripts/productSyncReconcile.js --store <store-uuid> --apply   # approval-gated
 */
'use strict';
const { prisma } = require('../src/configs/database');
const { shopifyGraphql } = require('../src/services/shopifyGraphql');
const { diffProductCatalogue, planSourceAbsentDeletion } = require('../src/services/productReconciliation');

const MAX_PAGES = 100;

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1] || null;
}

async function resolveStore(target) {
  const looksUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(target || ''));
  const store = looksUuid
    ? await prisma.stores.findUnique({ where: { id: target }, select: { id: true, shop_domain: true, platform: true, organization_id: true, status: true } })
    : await prisma.stores.findFirst({ where: { shop_domain: target, platform: 'shopify', status: { not: 'deleted' } }, select: { id: true, shop_domain: true, platform: true, organization_id: true, status: true } });
  if (!store) throw Object.assign(new Error('store not found'), { code: 'STORE_NOT_FOUND' });
  if (store.platform !== 'shopify') throw Object.assign(new Error('reconciliation is only defined for shopify stores'), { code: 'STORE_NOT_SHOPIFY' });
  return store;
}

async function fetchSourceIds(store) {
  const ids = [];
  let cursor = null;
  let pages = 0;
  const seen = new Set();
  do {
    if (++pages > MAX_PAGES) throw Object.assign(new Error('pagination limit exceeded'), { code: 'SHOPIFY_PAGINATION_LIMIT_EXCEEDED' });
    const data = await shopifyGraphql(store, `query RevlumaReconcileIds($first: Int!, $after: String) {
      products(first: $first, after: $after, sortKey: UPDATED_AT) {
        nodes { id }
        pageInfo { hasNextPage endCursor }
      }
    }`, { first: 250, after: cursor });
    const connection = data?.products;
    if (!connection || !Array.isArray(connection.nodes) || typeof connection.pageInfo?.hasNextPage !== 'boolean') {
      throw Object.assign(new Error('shopify_products_response_malformed'), { code: 'SHOPIFY_PRODUCTS_RESPONSE_MALFORMED' });
    }
    for (const node of connection.nodes) if (node?.id) ids.push(String(node.id).split('/').pop());
    const next = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
    if (next) {
      if (seen.has(next)) throw Object.assign(new Error('pagination stalled'), { code: 'SHOPIFY_PAGINATION_STALLED' });
      seen.add(next);
    }
    cursor = next;
  } while (cursor);
  return ids;
}

async function main() {
  const target = arg('store');
  if (!target) {
    console.error('usage: node scripts/productSyncReconcile.js --store <store-uuid-or-myshopify-domain> [--apply]');
    process.exit(2);
  }
  const apply = process.argv.includes('--apply');
  const store = await resolveStore(target);
  const sourceIds = await fetchSourceIds(store);
  const dbRows = await prisma.products.findMany({ where: { store_id: store.id }, select: { external_id: true, status: true, updated_at: true } });
  const diff = diffProductCatalogue({ sourceIds, dbRows });
  const plan = planSourceAbsentDeletion({
    diff,
    apply,
    confirmToken: process.env.REVLUMA_RECONCILE_CONFIRM_DELETIONS,
    allowEmptySourceToken: process.env.REVLUMA_RECONCILE_ALLOW_EMPTY_SOURCE,
  });

  const report = {
    tool: 'shopify-product-reconciliation',
    version: 1,
    generated_at: new Date().toISOString(),
    store: { id: store.id, shop_domain: store.shop_domain, organization_id: store.organization_id, status: store.status },
    mode: plan.apply ? 'apply' : 'dry_run',
    source_count: diff.source_count,
    db_count: diff.db_count,
    matched_count: diff.matched_count,
    missing_in_db: diff.missing_in_db,
    absent_from_source: diff.absent_from_source,
    note: 'Shopify data is read through the authorized installation; nothing is mutated in Shopify. Absent-from-source rows are only deleted with --apply plus the confirmation environment phrase.',
  };

  if (plan.apply && plan.deletable_external_ids.length) {
    const result = await prisma.products.deleteMany({
      where: { store_id: store.id, external_id: { in: plan.deletable_external_ids } },
    });
    report.deleted_rows = result.count;
  } else {
    report.deleted_rows = 0;
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exit(0);
}

main().catch((error) => {
  process.stderr.write(JSON.stringify({ error: error.code || error.name || 'reconciliation_failed' }) + '\n');
  process.exit(2);
});
