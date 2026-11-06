'use strict';

// Source-vs-database reconciliation: DB-side half.
//
// What this script does NOT do: query the Shopify Admin API. Counting source
// records requires the merchant's installed access token, which only exists
// inside the deployed service. Running this offline is therefore a skeleton:
// it reports what the database holds and what the sync ledger believes, and
// explicitly marks the source half as NOT VERIFIED. After deploy, persist a
// twin report via the admin sync-coverage endpoint + a Shopify-side count
// (orders count, products count) to complete reconciliation.
//
// Never mutates. Outputs JSON.
//
// Usage: DATABASE_URL=... node scripts/reconcileResourceCounts.js [--json]

async function main() {
  const { prisma } = require('../src/configs/database');
  const counts = {};
  const stores = await prisma.stores.findMany({
    where: { platform: 'shopify' },
    select: { id: true, shop_domain: true, last_synced_at: true, granted_scopes: true },
  });
  for (const store of stores) {
    const [
      products, variants, customers, orders, transactions, refunds,
      fulfillments, carts, orderItems,
    ] = await Promise.all([
      prisma.products.count({ where: { store_id: store.id } }),
      prisma.product_variants.count({ where: { store_id: store.id } }),
      prisma.customers.count({ where: { store_id: store.id } }),
      prisma.orders.count({ where: { store_id: store.id } }),
      prisma.order_transactions.count({ where: { store_id: store.id } }),
      prisma.order_refunds.count({ where: { store_id: store.id } }),
      prisma.order_fulfillments.count({ where: { store_id: store.id } }),
      prisma.abandoned_carts.count({ where: { store_id: store.id } }),
      prisma.order_items.count({ where: { store_id: store.id } }),
    ]);
    const ledger = await prisma.store_sync_domain_states.findMany({ where: { store_id: store.id } });
    counts[store.shop_domain || store.id] = {
      store_id: store.id,
      last_synced_at: store.last_synced_at,
      persisted: { products, variants, customers, orders, order_items: orderItems, transactions, refunds, fulfillments, abandoned_checkouts: carts },
      ledger: ledger.map(row => ({
        domain: row.domain, status: row.status, records_discovered: row.records_discovered,
        pages_completed: row.pages_completed, pagination_complete: row.pagination_complete,
        retry_count: row.retry_count, error_code: row.error_code, freshness_seconds: row.last_succeeded_at ? Math.floor((Date.now() - new Date(row.last_succeeded_at).getTime()) / 1000) : null,
      })),
      source_counts: 'NOT VERIFIED — requires the installed access token inside the deployed service',
      parity_verdict: 'NOT VERIFIED',
    };
  }
  process.stdout.write(JSON.stringify({
    generated_at: new Date().toISOString(),
    warning: 'DB-side counts only. Source parity requires a live token via the deployed admin sync-coverage path; do not mark any store COMPLETE from this output alone.',
    stores: counts,
  }, null, 2) + '\n');
}

if (require.main === module) {
  main().catch(err => {
    process.stderr.write(`reconcileResourceCounts failed: ${err.message}\n`);
    process.exit(1);
  });
}
