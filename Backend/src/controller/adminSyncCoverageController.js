/**
 * Admin-only, read-only per-domain sync coverage for one Shopify store.
 * Never returns tokens or customer data. Reports which commerce data
 * domains succeeded, failed or never ran, with freshness seconds.
 */
'use strict';

const { prisma } = require('../configs/database');
const ledger = require('../services/syncDomainState');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUIRED_DOMAINS = ['products', 'customers', 'orders', 'abandoned_checkouts'];

async function getShopifyStoreSyncCoverage(req, res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  try {
    const { storeId } = req.params;
    if (!UUID_RE.test(String(storeId || ''))) {
      return res.status(400).json({ success: false, error: 'store_id_must_be_a_uuid' });
    }
    const store = await prisma.stores.findFirst({
      where: { id: storeId, platform: 'shopify' },
      select: { id: true, organization_id: true, shop_domain: true, status: true, last_synced_at: true },
    });
    if (!store) {
      return res.status(404).json({ success: false, error: 'store_not_found' });
    }
    const rows = await ledger.snapshot(store.id);
    const byDomain = Object.fromEntries(rows.map(row => [row.domain, row]));
    const incomplete = REQUIRED_DOMAINS.filter(domain => {
      const row = byDomain[domain];
      return !row || row.status !== 'ok' || row.pagination_complete !== true;
    });
    return res.status(200).json({
      success: true,
      store: {
        id: store.id,
        organization_id: store.organization_id,
        shop_domain: store.shop_domain,
        platform_status: store.status,
        last_synced_at: store.last_synced_at,
      },
      completeness: incomplete.length === 0 ? 'complete' : 'partial',
      incomplete_required_domains: incomplete,
      domains: rows.map(row => ({
        domain: row.domain,
        status: row.status,
        records_discovered: row.records_discovered,
        records_inserted: row.records_inserted,
        records_updated: row.records_updated,
        records_deleted: row.records_deleted,
        pages_completed: row.pages_completed,
        pagination_complete: row.pagination_complete,
        retry_count: row.retry_count,
        error_code: row.error_code,
        last_attempted_at: row.last_attempted_at,
        last_succeeded_at: row.last_succeeded_at,
        freshness_seconds: row.freshness_seconds,
      })),
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'coverage_failed', error_code: error?.code || error?.name || 'coverage_error' });
  }
}

module.exports = { getShopifyStoreSyncCoverage, REQUIRED_DOMAINS };
