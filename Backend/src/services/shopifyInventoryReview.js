'use strict';
const { detectAvailabilityTransitions } = require('./shopifyInventoryChanges');

// Tenant-scoped read-only investigation. Returns evidence, not alerts.
async function reviewInventoryChanges(prisma, organizationId, storeId) {
  const store = await prisma.stores.findFirst({
    where: { id: storeId, organization_id: organizationId, platform: 'shopify' },
    select: { id: true },
  });
  if (!store) throw Object.assign(new Error('Shopify store not found for organization'), { code: 'INVENTORY_STORE_UNAUTHORIZED' });
  const runs = await prisma.shopify_inventory_observation_runs.findMany({
    where: {
      organization_id: organizationId, store_id: storeId,
      scope_verified: true, catalog_complete: true, variants_complete: true,
    },
    orderBy: [{ observed_at: 'desc' }, { created_at: 'desc' }],
    take: 2,
  });
  if (runs.length < 2) return { status: 'insufficient_history', transitions: [], merchantAlertEligible: false };
  const rows = await prisma.shopify_inventory_observations.findMany({
    where: { organization_id: organizationId, store_id: storeId, observation_id: { in: runs.map(run => run.id) } },
  });
  const toObservation = run => {
    const byProduct = new Map();
    const runRows = rows.filter(row => row.observation_id === run.id);
    if (runRows.length !== run.variant_count) return null;
    for (const row of runRows) {
      if (!byProduct.has(row.product_external_id)) {
        byProduct.set(row.product_external_id, {
          productId: row.product_external_id, title: row.product_title,
          status: row.product_status, variants: [],
        });
      }
      byProduct.get(row.product_external_id).variants.push({
        variantId: row.variant_external_id,
        availableForSale: row.available_for_sale,
        inventoryQuantity: row.inventory_quantity,
        inventoryPolicy: row.inventory_policy,
      });
    }
    return {
      storeId, observedAt: run.observed_at.toISOString(),
      scopeVerified: true, catalogPaginationComplete: true, variantPaginationComplete: true,
      products: [...byProduct.values()],
    };
  };
  const current = toObservation(runs[0]), previous = toObservation(runs[1]);
  if (!current || !previous) return { status: 'incomplete_history', transitions: [], merchantAlertEligible: false };
  const comparison = detectAvailabilityTransitions(previous, current);
  return {
    status: comparison.verified ? 'verified_observation_comparison' : 'unverified_observation_comparison',
    transitions: comparison.transitions,
    merchantAlertEligible: false,
  };
}
module.exports = { reviewInventoryChanges };
