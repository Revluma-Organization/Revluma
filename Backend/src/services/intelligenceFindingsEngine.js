'use strict';

/**
 * Phase 3 finding rules. Pure, deterministic and side-effect free.
 * Inputs MUST be computed from verified, organization-scoped source records.
 * No finding is emitted for missing, stale, or insufficient evidence.
 */
const { narrativeGuardrailErrors } = require('./revClaimGuardrails');
const TYPES = Object.freeze({
  INTEGRATION_FAILURE: 'integration_failure',
  REVENUE_CHANGE: 'revenue_change',
  ORDER_VOLUME_CHANGE: 'order_volume_change',
  RETURNING_CUSTOMER_CHANGE: 'returning_customer_change',
  REFUND_INCREASE: 'refund_increase',
  NO_RECENT_ORDERS: 'no_recent_orders',
  STOREFRONT_DOMAIN_UNCONFIGURED: 'storefront_domain_unconfigured',
  ABANDONED_CHECKOUTS_OPEN: 'abandoned_checkouts_open',
  INVENTORY_STOCKOUTS: 'inventory_stockouts',
  NO_STOREFRONT_EVENTS: 'no_storefront_events',
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
const finding = (type, scope, severity, title, description, evidence, action) => {
  const unsafe = narrativeGuardrailErrors(`${title} ${description} ${action?.guidance || ''}`);
  if (unsafe.length) throw new Error(`Unsafe finding language: ${unsafe.join(', ')}`);
  return {
    type, scope, severity, title, description, evidence,
    action: action ? { ...action, action_state: 'recommended', executed: false,
      execution_status: 'not_requested', merchant_confirmation: 'not_confirmed',
      independent_verification: 'unverified' } : action,
    lifecycle: 'open', detected_at: new Date().toISOString(),
    dedupe_key: [type, scope.storeId, scope.segment || 'all', evidence.currentStart || 'current', evidence.currentEnd || 'current'].join(':'),
  };
};
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
    'Compared with an equal-length previous period using recorded orders in the same currency. This change does not establish its cause or the amount of recoverable revenue.',
    { ...evidence, delta_pct: Number((delta * 100).toFixed(2)), source: 'orders' },
    { label: 'Investigate in Command Center', route: '/dashboard', guidance: 'Compare order count and average order value across the two periods. Check product availability and checkout activity where independently verified. Do not assume a cause from revenue movement alone.', measurement: 'Compare order count, recorded revenue, and average order value over a subsequent equal-length period in the same currency.' });
}
function detectOrderVolumeChange({ scope, evidence, minimumOrders = 10, minimumRelativeChange = 0.25 }) {
  if (!scope?.organizationId || !scope?.storeId || !evidenceReady(evidence, minimumOrders)) return null;
  if (!Number.isInteger(evidence.currentCount) || !Number.isInteger(evidence.previousCount) ||
      evidence.previousCount <= 0) return null;
  const delta = (evidence.currentCount - evidence.previousCount) / evidence.previousCount;
  if (Math.abs(delta) < minimumRelativeChange) return null;
  const direction = delta < 0 ? 'decreased' : 'increased';
  return finding(TYPES.ORDER_VOLUME_CHANGE, scope, delta < 0 ? 'high' : 'medium',
    `Verified order volume ${direction} ${Math.round(Math.abs(delta) * 100)}%`,
    'Completed-order records changed across equal-length, certified historical windows. The change alone does not establish why purchases changed.',
    { ...evidence, delta_pct: Number((delta * 100).toFixed(2)), source: 'orders' },
    { label: 'Investigate in Command Center', route: '/dashboard',
      guidance: 'Compare product-level orders, recorded revenue and availability. Investigate checkout activity only where independently verified.',
      measurement: 'Compare completed-order counts across the next equivalent period.' });
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
    { label: 'Investigate in Command Center', route: '/dashboard', guidance: 'Compare returning-buyer counts and prior purchase history for both periods. Do not infer why buyers did not return.', measurement: 'Compare verified returning-buyer purchase share over the next equivalent period.' });
}
function detectRefundIncrease({ scope, evidence, minimumTransactions = 1, minimumRelativeChange = 0.25 }) {
  if (!scope?.organizationId || !scope?.storeId || !evidenceReady(evidence, minimumTransactions) ||
      evidence.source !== 'order_transactions' || evidence.refund_coverage_complete !== true) return null;
  if (!validNumber(evidence.currentRefundTotal) || !validNumber(evidence.previousRefundTotal) ||
      evidence.currentRefundTotal < 0 || evidence.previousRefundTotal <= 0) return null;
  const delta = (evidence.currentRefundTotal - evidence.previousRefundTotal) / evidence.previousRefundTotal;
  if (delta < minimumRelativeChange) return null;
  return finding(TYPES.REFUND_INCREASE, scope, 'high',
    `Verified refund value increased ${Math.round(delta * 100)}%`,
    'Successful refund transactions increased between equal-length periods in the same currency, using refund transaction dates. This observation does not establish why refunds increased.',
    { ...evidence, delta_pct: Number((delta * 100).toFixed(2)) },
    { label: 'Investigate refund evidence', route: '/dashboard',
      guidance: "Review the refund transactions in the current period. Compare affected orders, products and recorded refund reasons with the previous period to determine whether the increase is concentrated in a particular product or issue.",
      measurement: 'Compare successful refund transaction value using the same transaction-date attribution and currency in the next equivalent period.' });
}
function detectNoRecentOrders({ scope, evidence }) {
  if (!scope?.organizationId || !scope?.storeId || !evidence ||
      evidence.verified !== true || evidence.complete !== true ||
      !iso(evidence.currentStart) || !iso(evidence.currentEnd) ||
      !iso(evidence.previousStart) || !iso(evidence.previousEnd) ||
      !Number.isInteger(evidence.currentCount) || !Number.isInteger(evidence.previousCount) ||
      evidence.currentCount !== 0 || evidence.previousCount < 0) return null;
  const zeroBothWindows = evidence.previousCount === 0;
  const periodDays = Number.isInteger(evidence.periodDays) && evidence.periodDays > 0 ? evidence.periodDays : 7;
  const totalWindowDays = zeroBothWindows ? periodDays * 2 : periodDays;
  const severity = zeroBothWindows ? 'critical' : 'high';
  const item = finding(
    TYPES.NO_RECENT_ORDERS,
    scope,
    severity,
    `No verified orders recorded in the last ${totalWindowDays} days`,
    `Certified Shopify order history records zero completed live orders across the verified ${totalWindowDays}-day window. This observation records the absence of completed sales and does not establish whether traffic, merchandising, or checkout setup explains the zero-order period.`,
    { ...evidence, source: 'orders' },
    {
      label: 'Investigate in Rev Intelligence',
      route: '/dashboard/rev-intell',
      guidance: 'Verify storefront availability, run a live test checkout on an active product, and inspect acquisition channels in Shopify Admin to confirm shoppers can reach and purchase products.',
      measurement: 'Track verified completed-order counts across the next equivalent period.',
    }
  );
  item.dedupe_key = `${TYPES.NO_RECENT_ORDERS}:${scope.storeId}:current`;
  return item;
}

function detectStorefrontDomainUnconfigured({ scope, evidence }) {
  if (!scope?.organizationId || !scope?.storeId || !evidence ||
      evidence.verified !== true || evidence.complete !== true ||
      typeof evidence.primaryDomainHost !== 'string' ||
      !/\.myshopify\.com$/i.test(evidence.primaryDomainHost.trim()) ||
      evidence.customDomainCount !== 0 ||
      !iso(evidence.observed_at)) return null;
  const item = finding(
    TYPES.STOREFRONT_DOMAIN_UNCONFIGURED,
    scope,
    'high',
    'Storefront still uses a .myshopify.com primary domain',
    `Synchronized Shopify store records show ${evidence.primaryDomainHost.trim()} as the primary domain with zero custom domains connected. This reflects current domain configuration only and does not establish traffic or conversion impact.`,
    { ...evidence, source: 'store_profiles', storeId: scope.storeId },
    {
      label: 'Configure custom domain',
      route: '/dashboard/rev-intell',
      guidance: 'Connect a branded custom domain in Shopify Admin (Settings -> Domains), assign it as the primary storefront domain, and verify SSL certificate activation.',
      measurement: 'Confirm a custom primary domain appears in synchronized store domain records.',
    }
  );
  item.dedupe_key = `${TYPES.STOREFRONT_DOMAIN_UNCONFIGURED}:${scope.storeId}:current`;
  return item;
}

function detectOpenAbandonedCheckouts({ scope, evidence }) {
  if (!scope?.organizationId || !scope?.storeId || !evidence ||
      evidence.verified !== true || evidence.complete !== true ||
      !Number.isInteger(evidence.openAbandonedCount) || evidence.openAbandonedCount < 1 ||
      !validNumber(evidence.openAbandonedValue) || evidence.openAbandonedValue < 0 ||
      !iso(evidence.observed_at)) return null;
  const count = evidence.openAbandonedCount;
  const windowDays = Number.isInteger(evidence.windowDays) && evidence.windowDays > 0 ? evidence.windowDays : 30;
  const severity = count >= 5 ? 'high' : 'medium';
  const item = finding(
    TYPES.ABANDONED_CHECKOUTS_OPEN,
    scope,
    severity,
    `${count} open abandoned ${count === 1 ? 'checkout' : 'checkouts'} recorded without completed orders`,
    `Synchronized checkout records show ${count} open abandoned ${count === 1 ? 'checkout' : 'checkouts'} over the past ${windowDays} days. Checkout records do not establish total storefront visits, checkout conversion rate, or how much recorded cart value would convert.`,
    { ...evidence, source: 'abandoned_carts', storeId: scope.storeId },
    {
      label: 'Review abandoned checkouts',
      route: '/dashboard/rev-intell',
      guidance: 'Inspect recent abandoned checkouts in Shopify Admin for shipping rate gaps, payment method issues, or checkout friction, and verify whether automated checkout reminder emails are active.',
      measurement: 'Compare open abandoned checkout counts alongside completed orders across the next equivalent period.',
    }
  );
  item.dedupe_key = `${TYPES.ABANDONED_CHECKOUTS_OPEN}:${scope.storeId}:current`;
  return item;
}

function detectInventoryStockouts({ scope, evidence }) {
  if (!scope?.organizationId || !scope?.storeId || !evidence ||
      evidence.verified !== true || evidence.complete !== true ||
      !Number.isInteger(evidence.zeroStockCount) || evidence.zeroStockCount < 1 ||
      !Number.isInteger(evidence.totalLevelsCount) || evidence.totalLevelsCount < 1 ||
      !iso(evidence.observed_at)) return null;
  const zeroCount = evidence.zeroStockCount;
  const totalCount = evidence.totalLevelsCount;
  const ratio = zeroCount / totalCount;
  const severity = zeroCount >= 5 || ratio >= 0.2 ? 'high' : 'medium';
  const item = finding(
    TYPES.INVENTORY_STOCKOUTS,
    scope,
    severity,
    `${zeroCount} inventory ${zeroCount === 1 ? 'level shows' : 'levels show'} zero available stock`,
    `Current synchronized inventory snapshots record ${zeroCount} of ${totalCount} tracked inventory levels at zero or below available units. This reflects the latest stock snapshot only and does not assert historical stockouts or estimate missed demand.`,
    { ...evidence, source: 'inventory_levels', storeId: scope.storeId },
    {
      label: 'Review zero-stock inventory',
      route: '/dashboard/rev-intell',
      guidance: 'Audit zero-stock SKUs in Shopify Admin (Products -> Inventory) to confirm whether active listings need replenishment, incoming transfers, or archiving.',
      measurement: 'Track the count of zero-stock inventory levels after replenishment updates synchronize.',
    }
  );
  item.dedupe_key = `${TYPES.INVENTORY_STOCKOUTS}:${scope.storeId}:current`;
  return item;
}

function detectNoStorefrontEvents({ scope, evidence }) {
  if (!scope?.organizationId || !scope?.storeId || !evidence ||
      evidence.verified !== true || evidence.complete !== true ||
      evidence.recordedEventsCount !== 0 ||
      !iso(evidence.observed_at)) return null;
  const windowDays = Number.isInteger(evidence.windowDays) && evidence.windowDays > 0 ? evidence.windowDays : 30;
  const item = finding(
    TYPES.NO_STOREFRONT_EVENTS,
    scope,
    'medium',
    'No storefront traffic or visitor events recorded',
    `Revluma has recorded zero storefront visitor or session events over the last ${windowDays} days. Without recorded storefront activity or active event capture, pre-checkout funnel diagnostics remain unavailable.`,
    { ...evidence, source: 'events', storeId: scope.storeId },
    {
      label: 'Verify storefront traffic and tracking',
      route: '/dashboard/rev-intell',
      guidance: 'Confirm the storefront is published and accessible to shoppers, check traffic sources in Shopify Analytics, and verify storefront event tracking is enabled on the active theme.',
      measurement: 'Verify incoming storefront session events appear in synchronized event records.',
    }
  );
  item.dedupe_key = `${TYPES.NO_STOREFRONT_EVENTS}:${scope.storeId}:current`;
  return item;
}

function prioritizeFindings(findings) {
  return findings.filter(Boolean).sort((a, b) =>
    (SEVERITIES[b.severity] || 0) - (SEVERITIES[a.severity] || 0) ||
    a.dedupe_key.localeCompare(b.dedupe_key));
}
module.exports = {
  TYPES,
  detectIntegrationFailure,
  detectRevenueChange,
  detectReturningCustomerChange,
  detectOrderVolumeChange,
  detectRefundIncrease,
  detectNoRecentOrders,
  detectStorefrontDomainUnconfigured,
  detectOpenAbandonedCheckouts,
  detectInventoryStockouts,
  detectNoStorefrontEvents,
  prioritizeFindings,
};
