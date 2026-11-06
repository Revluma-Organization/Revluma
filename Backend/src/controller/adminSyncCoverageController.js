/**
 * Admin-only, read-only data-coverage report for one Shopify store.
 * Never returns tokens or customer PII. Every domain is derived from the
 * capability catalog (what could be built) fused with the sync ledger
 * (what actually happened). Nothing is COMPLETE because a scope exists.
 */
'use strict';

const { prisma } = require('../configs/database');
const ledger = require('../services/syncDomainState');
const { DOMAIN_CAPABILITIES, rowStatus } = require('../services/domainCatalog');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getShopifyStoreSyncCoverage(req, res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  try {
    const { storeId } = req.params;
    if (!UUID_RE.test(String(storeId || ''))) {
      return res.status(400).json({ success: false, error: 'store_id_must_be_a_uuid' });
    }
    const store = await prisma.stores.findFirst({
      where: { id: storeId, platform: 'shopify' },
      select: {
        id: true, organization_id: true, shop_domain: true, status: true,
        last_synced_at: true, granted_scopes: true,
      },
    });
    if (!store) {
      return res.status(404).json({ success: false, error: 'store_not_found' });
    }
    const rows = await ledger.snapshot(store.id);
    const byName = Object.fromEntries(rows.map(row => [row.domain, row]));
    const recordedScopes = String(store.granted_scopes || '')
      .split(',')
      .map(scope => scope.trim())
      .filter(Boolean);

    const domains = DOMAIN_CAPABILITIES.map(capability => {
      const row = byName[capability.domain] || null;
      const status = rowStatus(capability, row);
      const missingScopes = capability.required_scopes.filter(scope => !recordedScopes.includes(scope));
      return {
        domain: capability.domain,
        label: capability.label,
        status,
        implementation: capability.implementation,
        required_scopes: capability.required_scopes,
        recorded_granted_scopes: recordedScopes,
        missing_scopes: missingScopes,
        additional_approval: capability.additional_approval || null,
        restrictions: capability.restrictions,
        records_discovered: row?.records_discovered ?? null,
        records_inserted: row?.records_inserted ?? null,
        records_updated: row?.records_updated ?? null,
        records_deleted: row?.records_deleted ?? null,
        pages_completed: row?.pages_completed ?? null,
        pagination_complete: row?.pagination_complete ?? false,
        retry_count: row?.retry_count ?? 0,
        error_code: row?.error_code ?? null,
        last_attempted_at: row?.last_attempted_at ?? null,
        last_succeeded_at: row?.last_succeeded_at ?? null,
        freshness_seconds: row?.freshness_seconds ?? null,
        reason: !capability.implementation || capability.implementation !== 'implemented'
          ? (capability.restrictions[0] || 'domain not implemented in this build')
          : !row
            ? 'acquisition implemented; no sync has recorded this domain yet'
            : (status === 'FAILED' || status === 'DEGRADED')
              ? (row.error_code || 'sync degraded or failed; see error_code')
              : null,
      };
    });
    const implementedDomains = domains.filter(d => d.implementation === 'implemented');
    const incompleteImplemented = implementedDomains.filter(d => d.status !== 'COMPLETE');
    return res.status(200).json({
      success: true,
      store: {
        id: store.id,
        organization_id: store.organization_id,
        shop_domain: store.shop_domain,
        platform_status: store.status,
        last_synced_at: store.last_synced_at,
        granted_scopes_recorded: recordedScopes.length,
      },
      completeness: incompleteImplemented.length === 0 ? 'complete' : 'partial',
      completeness_basis: 'all implemented domains must report COMPLETE (ok + pagination_complete); NOT_IMPLEMENTED domains are listed but never silently masked',
      unknown_or_unimplemented_domains: domains.filter(d => d.status !== 'COMPLETE').map(d => d.domain),
      domains,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'coverage_failed', error_code: error?.code || error?.name || 'coverage_error' });
  }
}

module.exports = { getShopifyStoreSyncCoverage, rowStatus };
