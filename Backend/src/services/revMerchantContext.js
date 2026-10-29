'use strict';

// Builds a bounded read-only context from organization-scoped, verified records.
const { TRUSTED_SOURCE } = require('./intelligenceOrderCoverage');
const FINANCIAL_FINDING_TYPES = new Set(['revenue_change', 'order_volume_change', 'returning_customer_change']);
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
function certifiedFinding(finding) {
  const evidence = finding?.evidence;
  if (!evidence || evidence.verified !== true) return false;
  if (finding.type === 'integration_failure') return evidence.source === 'stores' && evidence.storeId === finding.store_id;
  if (!FINANCIAL_FINDING_TYPES.has(finding.type)) return false; // Fail closed for unknown finding contracts.
  if (evidence.complete !== true || evidence.coverage_source !== TRUSTED_SOURCE ||
      typeof evidence.coverage_run_id !== 'string' || !evidence.coverage_run_id.trim()) return false;
  const { previousStart, previousEnd, currentStart, currentEnd } = evidence;
  if (![previousStart, previousEnd, currentStart, currentEnd].every(validDate)) return false;
  const ps = Date.parse(previousStart), pe = Date.parse(previousEnd);
  const cs = Date.parse(currentStart), ce = Date.parse(currentEnd);
  if (!(ps < pe && pe <= cs && cs < ce && pe - ps === ce - cs)) return false;
  if (typeof evidence.currency !== 'string' || !/^[A-Z]{3}$/.test(evidence.currency)) return false;
  if (![evidence.currentCount, evidence.previousCount].every(n => Number.isInteger(n) && n >= 0)) return false;
  if (finding.type === 'revenue_change' &&
      ![evidence.currentRevenue, evidence.previousRevenue].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0)) return false;
  if (finding.type === 'returning_customer_change' &&
      ![evidence.currentReturning, evidence.previousReturning].every(n => Number.isInteger(n) && n >= 0)) return false;
  return true;
}
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
    // Python's normalizer permits only three nested levels; array entries
    // must be primitive strings rather than nested objects.
    stores: stores.slice(0, 8).map(s =>
      ['store', String(s.id || '').slice(0, 36),
        String(s.platform || '').slice(0, 24),
        String(s.status || '').slice(0, 24),
        s.last_synced_at ? new Date(s.last_synced_at).toISOString() : 'never_synced'].join(' | ')),
    verified_findings: findings.filter(f =>
      allowedStores.has(f.store_id) && certifiedFinding(f))
      .slice(0, 5).map(f =>
        ['finding', String(f.id || '').slice(0, 36),
          String(f.type || '').slice(0, 40),
          String(f.severity || '').slice(0, 16),
          compactEvidence(f.evidence)].join(' | ').slice(0, 300)),
    limitations: ['Connection does not prove complete order coverage.',
      'No verified checkout abandonment rate is available in this context.',
      'No findings does not prove the store has no issues.'],
  };
}
module.exports = { buildMerchantContext, boundedEvidence, certifiedFinding };
