'use strict';

/**
 * Phase 3 finding rules. Pure, deterministic and side-effect free.
 * Inputs MUST be computed from verified, organization-scoped source records.
 * No finding is emitted for missing, stale, or insufficient evidence.
 */
const TYPES = Object.freeze({
  INTEGRATION_FAILURE: 'integration_failure',
  REVENUE_CHANGE: 'revenue_change',
  RETURNING_CUSTOMER_CHANGE: 'returning_customer_change',
});
const SEVERITIES = Object.freeze({ critical: 4, high: 3, medium: 2, low: 1 });
const validNumber = value => typeof value === 'number' && Number.isFinite(value);
const iso = value => { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString() : null; };
const evidenceReady = (evidence, minCount = 1) =>
  evidence && evidence.verified === true && evidence.complete === true &&
  iso(evidence.currentStart) && iso(evidence.currentEnd) &&
  iso(evidence.previousStart) && iso(evidence.previousEnd) &&
  validNumber(evidence.currentCount) && validNumber(evidence.previousCount) &&
  evidence.currentCount >= minCount && evidence.previousCount >= minCount &&
  evidence.currency && typeof evidence.currency === 'string' &&
  evidence.currentEnd > evidence.currentStart &&
  evidence.previousEnd > evidence.previousStart &&
  new Date(evidence.previousEnd) <= new Date(evidence.currentStart) &&
  (new Date(evidence.currentEnd) - new Date(evidence.currentStart)) ===
    (new Date(evidence.previousEnd) - new Date(evidence.previousStart));
const finding = (type, scope, severity, title, description, evidence, action) => ({
  type, scope, severity, title, description, evidence,
  action, lifecycle: 'open', detected_at: new Date().toISOString(),
  dedupe_key: [type, scope.storeId, scope.segment || 'all', evidence.currentStart || 'current', evidence.currentEnd || 'current'].join(':'),
});
function detectIntegrationFailure({ scope, store, now = new Date(), maxSyncAgeMinutes = 120 }) {
  if (!scope?.organizationId || !scope?.storeId || !store || store.id !== scope.storeId) return null;
  const setupFailed = store.setup_status === 'failed' || store.sync_status === 'failed';
  const disconnected = store.status === 'failed' || store.status === 'disconnected';
  const lastSync = iso(store.last_synced_at);
  const stale = store.status === 'connected' && lastSync &&
    new Date(now).getTime() - new Date(lastSync).getTime() > maxSyncAgeMinutes * 60000;
  if (!setupFailed && !disconnected && !stale) return null;
  const reason = setupFailed ? 'Store setup or synchronization failed' :
    disconnected ? 'Store connection is unavailable' : 'Store synchronization is overdue';
  return finding(TYPES.INTEGRATION_FAILURE, scope, 'high', reason,
    'Review the store connection and its latest recorded setup/sync status.',
    { source: 'stores', storeId: store.id, status: store.status, setup_status: store.setup_status || null,
      sync_status: store.sync_status || null, last_synced_at: lastSync, observed_at: iso(now),
      verified: true, stale: Boolean(stale) },
    { label: 'Review integration', route: '/dashboard/integrations' });
}
function detectRevenueChange({ scope, evidence, minimumOrders = 10, minimumRelativeChange = 0.25 }) {
  if (!scope?.organizationId || !scope?.storeId || !evidenceReady(evidence, minimumOrders)) return null;
  if (!validNumber(evidence.currentRevenue) || !validNumber(evidence.previousRevenue) ||
      evidence.currentRevenue < 0 || evidence.previousRevenue <= 0) return null;
  const delta = (evidence.currentRevenue - evidence.previousRevenue) / evidence.previousRevenue;
  if (Math.abs(delta) < minimumRelativeChange) return null;
  const direction = delta < 0 ? 'decreased' : 'increased';
  return finding(TYPES.REVENUE_CHANGE, scope, delta < 0 ? 'high' : 'medium',
    `Verified revenue ${direction} ${Math.round(Math.abs(delta) * 100)}%`,
    'Compared with an equal-length previous period using recorded orders in the same currency.',
    { ...evidence, delta_pct: Number((delta * 100).toFixed(2)), source: 'orders' },
    { label: 'Investigate orders', route: '/dashboard/analytics' });
}
function detectReturningCustomerChange({ scope, evidence, minimumCustomers = 20, minimumPointChange = 10 }) {
  if (!scope?.organizationId || !scope?.storeId || !evidenceReady(evidence, minimumCustomers)) return null;
  if (![evidence.currentReturning, evidence.previousReturning].every(validNumber) ||
      evidence.currentReturning < 0 || evidence.previousReturning < 0 ||
      evidence.currentReturning > evidence.currentCount ||
      evidence.previousReturning > evidence.previousCount) return null;
  const currentRate = 100 * evidence.currentReturning / evidence.currentCount;
  const previousRate = 100 * evidence.previousReturning / evidence.previousCount;
  const pointChange = currentRate - previousRate;
  if (Math.abs(pointChange) < minimumPointChange) return null;
  const direction = pointChange < 0 ? 'declined' : 'increased';
  return finding(TYPES.RETURNING_CUSTOMER_CHANGE, scope, pointChange < 0 ? 'high' : 'medium',
    `Returning-customer purchase share ${direction}`,
    'The share of purchasing customers with verified prior purchase history changed between equal-length periods.',
    { ...evidence, current_rate_pct: Number(currentRate.toFixed(2)),
      previous_rate_pct: Number(previousRate.toFixed(2)),
      change_percentage_points: Number(pointChange.toFixed(2)), source: 'orders' },
    { label: 'Investigate customers', route: '/dashboard/customers' });
}
function prioritizeFindings(findings) {
  return findings.filter(Boolean).sort((a, b) =>
    (SEVERITIES[b.severity] || 0) - (SEVERITIES[a.severity] || 0) ||
    a.dedupe_key.localeCompare(b.dedupe_key));
}
module.exports = { TYPES, detectIntegrationFailure, detectRevenueChange,
  detectReturningCustomerChange, prioritizeFindings };
