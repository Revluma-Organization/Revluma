'use strict';

/**
 * Trusted-only issuance boundary. A completed generic Shopify sync does not
 * constitute proof of historical completeness. Callers must provide an
 * independently verified ingestion manifest, never merchant-supplied data.
 */
const isDate = value => value instanceof Date && Number.isFinite(value.getTime());
const uuid = value => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const TRUSTED_SOURCE = 'shopify_verified_history_v1';

function validateCoverageManifest(manifest) {
  if (!manifest || manifest.source !== TRUSTED_SOURCE ||
      !uuid(manifest.organizationId) || !uuid(manifest.storeId) ||
      typeof manifest.runId !== 'string' || !/^[a-zA-Z0-9_-]{12,120}$/.test(manifest.runId) ||
      !isDate(manifest.start) || !isDate(manifest.end) || manifest.end <= manifest.start ||
      manifest.end > new Date() ||
      manifest.paginationComplete !== true ||
      manifest.orderReadScopeVerified !== true ||
      manifest.historicalAccessVerified !== true ||
      manifest.refundsAndCancellationsReconciled !== true ||
      manifest.persistedOrdersVerified !== true ||
      manifest.noKnownIngestionGaps !== true ||
      manifest.customerLifetimeVerified !== false) {
    throw Object.assign(new Error('Historical coverage cannot be certified from incomplete evidence'), {
      code: 'ORDER_COVERAGE_UNVERIFIED',
    });
  }
  return true;
}

async function certifyOrderCoverage(prisma, manifest) {
  validateCoverageManifest(manifest);
  const store = await prisma.stores.findFirst({
    where: { id: manifest.storeId, organization_id: manifest.organizationId, platform: 'shopify' },
    select: { id: true },
  });
  if (!store) throw Object.assign(new Error('Store ownership cannot be verified'), { code: 'ORDER_COVERAGE_STORE_NOT_FOUND' });
  return prisma.intelligence_order_coverage.upsert({
    where: { store_id: store.id },
    create: {
      store_id: store.id, organization_id: manifest.organizationId,
      coverage_start: manifest.start, coverage_end: manifest.end,
      customer_lifetime_verified: false,
      source: TRUSTED_SOURCE, source_run_id: manifest.runId,
    },
    update: {
      organization_id: manifest.organizationId,
      coverage_start: manifest.start, coverage_end: manifest.end,
      certified_at: new Date(), customer_lifetime_verified: false,
      source: TRUSTED_SOURCE, source_run_id: manifest.runId,
    },
  });
}

module.exports = { TRUSTED_SOURCE, validateCoverageManifest, certifyOrderCoverage };
