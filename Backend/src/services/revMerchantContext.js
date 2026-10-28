'use strict';

// Builds a bounded read-only context from organization-scoped, verified records.
const EVIDENCE_KEYS = new Set([
  'verified', 'complete', 'currency', 'currentCount', 'previousCount',
  'currentRevenue', 'previousRevenue', 'currentStart', 'currentEnd',
  'previousStart', 'previousEnd', 'failed_webhook_registrations',
  'coverage_source', 'coverage_run_id',
]);
function boundedEvidence(evidence) {
  return Object.fromEntries(Object.entries(evidence).filter(([key, value]) =>
    EVIDENCE_KEYS.has(key) && (
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value)) ||
      (typeof value === 'string' && value.length <= 100)
    )
  ));
}
function compactEvidence(evidence) {
  const result = {};
  for (const [key, value] of Object.entries(boundedEvidence(evidence))) {
    const next = JSON.stringify({ ...result, [key]: value });
    if (next.length <= 290) result[key] = value;
  }
  return JSON.stringify(result);
}
async function buildMerchantContext(prisma, organizationId) {
  if (!organizationId) throw new TypeError('organizationId is required');
  const stores = await prisma.stores.findMany({
    where: { organization_id: organizationId },
    select: { id: true, platform: true, shop_domain: true, status: true, last_synced_at: true },
    take: 20,
  });
  const findings = await prisma.intelligence_findings.findMany({
    where: { organization_id: organizationId, status: 'open' },
    orderBy: [{ detected_at: 'desc' }],
    take: 10,
    select: { id: true, store_id: true, type: true, severity: true, title: true,
      description: true, evidence: true, detected_at: true },
  });
  const allowedStores = new Set(stores.map(s => s.id));
  return {
    schema_version: 'rev-merchant-context-v1',
    observed_at: new Date().toISOString(),
    stores: stores.map(s => ({
      id: s.id, platform: s.platform, shop_domain: s.shop_domain,
      connection_status: s.status, last_synced_at: s.last_synced_at,
    })),
    verified_findings: findings.filter(f => allowedStores.has(f.store_id) && f.evidence?.verified === true)
      .slice(0, 5).map(f => ({
        id: f.id, store_id: f.store_id, type: f.type, severity: f.severity,
        title: String(f.title || '').slice(0, 180),
        description: String(f.description || '').slice(0, 400),
        detected_at: f.detected_at,
        evidence_summary: compactEvidence(f.evidence),
      })),
    limitations: ['Connection does not prove complete order coverage.',
      'No verified checkout abandonment rate is available in this context.',
      'No findings does not prove the store has no issues.'],
  };
}
module.exports = { buildMerchantContext, boundedEvidence };
