/**
 * Admin-only, read-only UNIVERSAL coverage report (message-6 §10).
 * Registry × granted-scopes × sync ledger. No PII, no tokens.
 */
'use strict';

const { prisma } = require('../configs/database');
const ledger = require('../services/syncDomainState');
const { REGISTRY } = require('../services/resourceRegistry');
const { universalRow, LEDGER_DOMAIN_BY_ID, STATUS } = require('../services/universalCoverage');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getShopifyStoreUniversalCoverage(req, res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  try {
    const { storeId } = req.params;
    if (!UUID_RE.test(String(storeId || ''))) {
      return res.status(400).json({ success: false, error: 'store_id_must_be_a_uuid' });
    }
    const store = await prisma.stores.findFirst({
      where: { id: storeId, platform: 'shopify' },
      select: { id: true, organization_id: true, shop_domain: true, status: true, last_synced_at: true, granted_scopes: true },
    });
    if (!store) return res.status(404).json({ success: false, error: 'store_not_found' });

    const rows = await ledger.snapshot(store.id);
    const byDomain = Object.fromEntries(rows.map(row => [row.domain, row]));
    const grantedScopes = String(store.granted_scopes || '').split(',').map(x => x.trim()).filter(Boolean);
    const finalResources = REGISTRY.map(entry => universalRow(entry, LEDGER_DOMAIN_BY_ID[entry.id] ? (byDomain[LEDGER_DOMAIN_BY_ID[entry.id]] || null) : null, grantedScopes));

    const counts = {};
    for (const r of finalResources) counts[r.status] = (counts[r.status] || 0) + 1;
    const implementedStatuses = new Set([STATUS.IMPLEMENTED_VERIFIED, STATUS.IMPLEMENTED_UNVERIFIED]);
    const implemented = finalResources.filter(r => implementedStatuses.has(r.status));
    const verified = finalResources.filter(r => r.status === STATUS.IMPLEMENTED_VERIFIED);

    return res.status(200).json({
      success: true,
      report: 'universal_coverage_v2026-11-06.v1',
      store: {
        id: store.id,
        organization_id: store.organization_id,
        shop_domain: store.shop_domain,
        platform_status: store.status,
        last_synced_at: store.last_synced_at,
        granted_scopes_recorded: grantedScopes.length,
      },
      certification: {
        // Honest top line (message-6): zero of these numbers are asserted "complete".
        total_registered_resources: finalResources.length,
        implemented_in_this_build: implemented.length,
        production_verified_for_this_store_now: verified.length,
        not_implemented: finalResources.filter(r => r.status === STATUS.NOT_IMPLEMENTED).length,
        requiring_additional_scopes: finalResources.filter(r => r.status === STATUS.REQUIRES_ADDITIONAL_SCOPES).length,
        requiring_app_approval: finalResources.filter(r => r.status === STATUS.REQUIRES_APP_APPROVAL).length,
        plan_restricted: finalResources.filter(r => r.status === STATUS.PLAN_RESTRICTED).length,
        access_denied_or_platform_unavailable: finalResources.filter(r => [STATUS.ACCESS_DENIED, STATUS.UNAVAILABLE_PLATFORM].includes(r.status)).length,
        sync_failed_or_reconciliation_failed: finalResources.filter(r => [STATUS.SYNC_FAILED, STATUS.RECONCILIATION_FAILED].includes(r.status)).length,
        status_counts: counts,
      },
      disclaimer: 'Inventory coverage is per resource; SUBSET of Shopify cannot be certified from one dev store. Merchant-consent, app approval, plan and API-version limits always apply and are surfaced per row.',
      resources: finalResources,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'universal_coverage_failed', error_code: error?.code || error?.name || 'universal_coverage_error' });
  }
}

module.exports = { getShopifyStoreUniversalCoverage };
