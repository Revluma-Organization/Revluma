/**
 * Admin-only, read-only source-vs-database reconciliation (message-6 §8).
 *
 * Baseline guarantee:
 *   products  — source total (productsCount) vs DB total; plus existence check
 *               of the 25 most recently created products (sample, not proof).
 *   orders    — existence check of the 25 most recent orders in the DB.
 *               TOTAL parity is not claimed: we deliberately retain a recent
 *               window, not full history; source totals always exceed DB.
 *   customers — existence check of the 25 most recently updated customers.
 *
 * Nothing is written. Verdicts: MATCH | MISSING | NOT_VERIFIED.
 * MATCH is evidence for the sampled/compared surface only — never a global
 * certificate for the store's full universe of Shopify data.
 */
'use strict';

const { prisma } = require('../configs/database');
const { shopifyGraphql } = require('../services/shopifyGraphql');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const QUERY = `query RevlumaReconciliation {
  productsCount { count precision }
  customersCount { count precision }
  recentProducts: products(first: 25, reverse: true, query: "status:active", sortKey: CREATED_AT) { nodes { id } pageInfo { hasNextPage } }
  recentOrders: orders(first: 25, reverse: true, sortKey: CREATED_AT) { nodes { id } }
  recentCustomers: customers(first: 25, reverse: true, sortKey: UPDATED_AT) { nodes { id } }
}`;

const externalId = gid => String(gid || '').split('/').pop();

async function getShopifyStoreReconciliation(req, res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  try {
    const { storeId } = req.params;
    if (!UUID_RE.test(String(storeId || ''))) {
      return res.status(400).json({ success: false, error: 'store_id_must_be_a_uuid' });
    }
    const store = await prisma.stores.findFirst({
      where: { id: storeId, platform: 'shopify' },
      select: { id: true, organization_id: true, shop_domain: true },
    });
    if (!store) return res.status(404).json({ success: false, error: 'store_not_found' });

    let data = null;
    let introspectionFailure = null;
    try {
      data = await shopifyGraphql(store, QUERY, {});
    } catch (error) {
      introspectionFailure = { code: error?.code || error?.name || 'graphql_error', message: String(error?.message || '').slice(0, 300) };
    }
    if (!data) {
      return res.status(502).json({
        success: false,
        error: 'source_unreachable',
        error_code: introspectionFailure?.code || 'graphql_error',
        note: 'Source half of reconciliation could not be executed — verdict is NOT VERIFIED, never MATCH.',
      });
    }

    const dbProducts = await prisma.products.count({ where: { store_id: store.id } });
    const dbOrders = await prisma.orders.count({ where: { store_id: store.id } });
    const dbCustomers = await prisma.customers.count({ where: { store_id: store.id } });
    const productIds = (data.recentProducts?.nodes || []).map(n => externalId(n.id));
    const persistedProducts = productIds.length
      ? await prisma.products.findMany({ where: { store_id: store.id, external_id: { in: productIds } }, select: { external_id: true } })
      : [];
    const persistedProductIds = new Set(persistedProducts.map(r => r.external_id));
    const missingProducts = productIds.filter(id => !persistedProductIds.has(id));

    const orderIds = (data.recentOrders?.nodes || []).map(n => externalId(n.id));
    const persistedOrders = orderIds.length
      ? await prisma.orders.findMany({ where: { store_id: store.id, external_order_id: { in: orderIds } }, select: { external_order_id: true } })
      : [];
    const persistedOrderIds = new Set(persistedOrders.map(r => r.external_order_id));
    const missingOrders = orderIds.filter(id => !persistedOrderIds.has(id));

    const customerIds = (data.recentCustomers?.nodes || []).map(n => externalId(n.id));
    const persistedCustomers = customerIds.length
      ? await prisma.customers.findMany({ where: { store_id: store.id, external_id: { in: customerIds } }, select: { external_id: true } })
      : [];
    const persistedCustomerIds = new Set(persistedCustomers.map(r => r.external_id));
    const missingCustomers = customerIds.filter(id => !persistedCustomerIds.has(id));

    const sourceProducts = data.productsCount && Number.isFinite(data.productsCount.count) ? data.productsCount.count : null;
    const sourceCustomers = data.customersCount && Number.isFinite(data.customersCount.count) ? data.customersCount.count : null;
    const sourceCustomerPrecision = data.customersCount?.precision ?? null;

    return res.status(200).json({
      success: true,
      report: 'source_db_reconciliation_v1',
      store: { id: store.id, organization_id: store.organization_id, shop_domain: store.shop_domain },
      checked_at: new Date().toISOString(),
      metrics: {
        products: {
          source_total: sourceProducts,
          source_precision: data.productsCount?.precision ?? null,
          db_total: dbProducts,
          total_delta: sourceProducts !== null ? sourceProducts - dbProducts : null,
          total_verdict: sourceProducts === null ? 'NOT_VERIFIED' : (sourceProducts === dbProducts ? 'MATCH' : 'MISSING'),
          sample: { checked: productIds.length, missing: missingProducts },
          caveat: 'Source count includes archived/draft products; DB sync may legitimately diverge if the sync filters statuses — inspect sample ids before declaring drift.',
        },
        orders: {
          source_total: null,
          db_total: dbOrders,
          total_verdict: 'NOT_APPLICABLE — recent window only, never full history',
          sample: { checked: orderIds.length, missing: missingOrders },
          caveat: 'DB holds the synced window, not the full order archive. Missing from sample = data loss; matching tail ≠ completeness.',
        },
        customers: {
          source_total: sourceCustomers,
          db_total: dbCustomers,
          source_precision: sourceCustomerPrecision,
          total_verdict: sourceCustomers === null ? 'NOT_VERIFIED' : (sourceCustomers === dbCustomers ? 'MATCH' : 'DIFFERS'),
          sample: { checked: customerIds.length, missing: missingCustomers },
        },
      },
      reconciliation_counters: {
        missing_products: missingProducts.length,
        missing_orders: missingOrders.length,
        missing_customers: missingCustomers.length,
        duplicates: null,
        mapping_errors: null,
        note: 'Totals-only sampling. Duplicate/mapping detection requires per-row diff — not executed in this build.',
      },
      disclaimer: 'MATCH is evidence only for the compared/sampled surfaces of one store. It is not a certificate of universal coverage.',
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'reconciliation_failed', error_code: error?.code || error?.name || 'reconciliation_error' });
  }
}

module.exports = { getShopifyStoreReconciliation };
