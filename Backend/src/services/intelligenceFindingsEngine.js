'use strict';

/**
 * Deterministic commerce signal and finding rules. Pure and side-effect free.
 * Inputs MUST be computed from verified, organization-scoped source records.
 * No finding is emitted for missing, stale, failed, or insufficient evidence.
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
  PRODUCTS_UNPUBLISHED_OR_UNAVAILABLE: 'products_unpublished_or_unavailable',
  NO_RECORDED_TRAFFIC: 'no_recorded_traffic',
  TRAFFIC_WITHOUT_ORDERS: 'traffic_without_orders',
  ABANDONED_CHECKOUTS_OPEN: 'abandoned_checkouts_open',
  INVENTORY_STOCKOUTS: 'inventory_stockouts',
  UNFULFILLED_ORDERS_BACKLOG: 'unfulfilled_orders_backlog',
  NO_STOREFRONT_EVENTS: 'no_storefront_events',
});

const EVALUATION_STATES = Object.freeze({
  VERIFIED: 'verified',
  NOT_DETECTED: 'not_detected',
  NOT_EVALUATED: 'not_evaluated',
  EVALUATION_FAILED: 'evaluation_failed',
  STALE: 'stale',
});

const SIGNAL_CATEGORIES = Object.freeze({
  STOREFRONT_READINESS: 'storefront_readiness',
  TRAFFIC_ACQUISITION: 'traffic_acquisition',
  SALES_REVENUE: 'sales_revenue',
  CONVERSION_PURCHASING: 'conversion_purchasing',
  PRODUCT_INVENTORY: 'product_inventory',
  CUSTOMER_FULFILLMENT: 'customer_fulfillment',
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
    evaluation_state: EVALUATION_STATES.VERIFIED,
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
  const droppedFromActiveSales = evidence.previousCount >= 3;
  const severity = droppedFromActiveSales ? 'critical' : 'high';
  const trafficNote = evidence.trafficEvaluated === true && evidence.verifiedSessions === 0
    ? ' Verified analytics also recorded zero sessions during this period, so this cannot be treated as a proven checkout conversion issue.'
    : ' Traffic data was not independently verified for this period, so this observation does not establish whether acquisition or conversion explains the absence of sales.';
  const item = finding(
    TYPES.NO_RECENT_ORDERS,
    scope,
    severity,
    'No recorded sales during the evaluated period',
    `Certified Shopify order history records 0 completed live orders across the verified ${totalWindowDays}-day evaluation window.${trafficNote}`,
    { ...evidence, totalWindowDays, source: 'orders' },
    {
      label: 'Investigate in Rev Intelligence',
      route: '/dashboard/rev-intell',
      guidance: 'Confirm storefront availability and run a live test checkout on an active product, then verify whether acquisition channels are sending visitors to the store.',
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
  const host = evidence.primaryDomainHost.trim();
  const item = finding(
    TYPES.STOREFRONT_DOMAIN_UNCONFIGURED,
    scope,
    'medium',
    'Your storefront still uses a Shopify subdomain',
    `Your primary storefront domain is currently ${host} with 0 custom domains connected in synchronized Shopify domain records. This reflects domain configuration only and does not establish traffic or conversion impact.`,
    { ...evidence, primaryDomainHost: host, source: 'store_profiles', storeId: scope.storeId },
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

function detectProductsUnpublishedOrUnavailable({ scope, evidence }) {
  if (!scope?.organizationId || !scope?.storeId || !evidence ||
      evidence.verified !== true || evidence.complete !== true ||
      !Number.isInteger(evidence.totalProductsCount) || evidence.totalProductsCount < 1 ||
      !Number.isInteger(evidence.activeProductsCount) || evidence.activeProductsCount < 0 ||
      !Number.isInteger(evidence.inactiveProductsCount) || evidence.inactiveProductsCount < 0 ||
      !iso(evidence.observed_at)) return null;
  const zeroActive = evidence.activeProductsCount === 0;
  const inactiveShare = evidence.inactiveProductsCount / evidence.totalProductsCount;
  if (!zeroActive && (evidence.inactiveProductsCount < 3 || inactiveShare < 0.5)) return null;
  const severity = zeroActive ? 'high' : 'medium';
  const title = zeroActive
    ? 'No catalog products are currently active for storefront purchase'
    : `${evidence.inactiveProductsCount} of ${evidence.totalProductsCount} catalog products are not active`;
  const description = zeroActive
    ? `Synchronized Shopify product records show ${evidence.totalProductsCount} catalog items with 0 active listings. Shoppers cannot purchase unpublished or draft listings.`
    : `Synchronized Shopify product records show ${evidence.inactiveProductsCount} of ${evidence.totalProductsCount} catalog listings are draft, archived, or non-active. This reflects current catalog status only and does not estimate demand.`;
  const item = finding(
    TYPES.PRODUCTS_UNPUBLISHED_OR_UNAVAILABLE,
    scope,
    severity,
    title,
    description,
    { ...evidence, source: 'products', storeId: scope.storeId },
    {
      label: 'Review product publishing status',
      route: '/dashboard/rev-intell',
      guidance: 'Review product status and Online Store sales channel publishing in Shopify Admin (Products) to verify intended items are active and discoverable.',
      measurement: 'Confirm active published product counts update after the next catalog sync.',
    }
  );
  item.dedupe_key = `${TYPES.PRODUCTS_UNPUBLISHED_OR_UNAVAILABLE}:${scope.storeId}:current`;
  return item;
}

function detectNoRecordedTraffic({ scope, evidence }) {
  if (!scope?.organizationId || !scope?.storeId || !evidence ||
      evidence.verified !== true || evidence.complete !== true ||
      evidence.analyticsAccessVerified !== true ||
      evidence.verifiedSessions !== 0 ||
      !iso(evidence.currentStart) || !iso(evidence.currentEnd) ||
      !iso(evidence.observed_at)) return null;
  const windowDays = Number.isInteger(evidence.windowDays) && evidence.windowDays > 0 ? evidence.windowDays : 7;
  const item = finding(
    TYPES.NO_RECORDED_TRAFFIC,
    scope,
    'high',
    'No recorded storefront traffic',
    `Verified analytics recorded 0 storefront sessions during the ${windowDays}-day evaluation period (${evidence.currentStart.slice(0, 10)} to ${evidence.currentEnd.slice(0, 10)}). This reflects recorded analytics telemetry and does not establish why acquisition channels produced no sessions.`,
    { ...evidence, source: evidence.source || 'analytics', storeId: scope.storeId },
    {
      label: 'Investigate acquisition and storefront reach',
      route: '/dashboard/rev-intell',
      guidance: 'Verify the storefront is publicly accessible without password protection, inspect acquisition channels and marketing links, and confirm storefront analytics tracking is firing on live pages.',
      measurement: 'Monitor verified storefront session counts across the next equivalent period.',
    }
  );
  item.dedupe_key = `${TYPES.NO_RECORDED_TRAFFIC}:${scope.storeId}:current`;
  return item;
}

function detectTrafficWithoutOrders({ scope, evidence }) {
  if (!scope?.organizationId || !scope?.storeId || !evidence ||
      evidence.verified !== true || evidence.complete !== true ||
      evidence.analyticsAccessVerified !== true ||
      !Number.isInteger(evidence.verifiedSessions) || evidence.verifiedSessions < 1 ||
      evidence.currentOrdersCount !== 0 ||
      !iso(evidence.currentStart) || !iso(evidence.currentEnd) ||
      !iso(evidence.observed_at)) return null;
  const windowDays = Number.isInteger(evidence.windowDays) && evidence.windowDays > 0 ? evidence.windowDays : 7;
  const checkoutContext = Number.isInteger(evidence.openAbandonedCount) && evidence.openAbandonedCount > 0
    ? ` Synchronized checkout records also show ${evidence.openAbandonedCount} open abandoned ${evidence.openAbandonedCount === 1 ? 'checkout' : 'checkouts'} in the recent window.`
    : '';
  const item = finding(
    TYPES.TRAFFIC_WITHOUT_ORDERS,
    scope,
    'high',
    'Storefront traffic recorded with zero completed orders',
    `Verified analytics recorded ${evidence.verifiedSessions} storefront ${evidence.verifiedSessions === 1 ? 'session' : 'sessions'} alongside 0 completed live orders across the ${windowDays}-day evaluation period.${checkoutContext} This indicates a potential conversion concern to investigate, but does not establish a specific technical or merchandising root cause.`,
    { ...evidence, source: evidence.source || 'analytics', storeId: scope.storeId },
    {
      label: 'Investigate purchasing funnel',
      route: '/dashboard/rev-intell',
      guidance: 'Inspect product pages, cart additions, shipping rates, and payment checkout steps in Shopify Admin and run a live checkout verification to isolate where shoppers exit.',
      measurement: 'Compare verified sessions against completed live orders over the next equivalent period.',
    }
  );
  item.dedupe_key = `${TYPES.TRAFFIC_WITHOUT_ORDERS}:${scope.storeId}:current`;
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

function detectUnfulfilledOrdersBacklog({ scope, evidence }) {
  if (!scope?.organizationId || !scope?.storeId || !evidence ||
      evidence.verified !== true || evidence.complete !== true ||
      !Number.isInteger(evidence.unfulfilledOrdersCount) || evidence.unfulfilledOrdersCount < 1 ||
      !iso(evidence.observed_at)) return null;
  const count = evidence.unfulfilledOrdersCount;
  const ageHours = Number.isInteger(evidence.ageThresholdHours) && evidence.ageThresholdHours > 0 ? evidence.ageThresholdHours : 48;
  const severity = count >= 5 ? 'high' : 'medium';
  const item = finding(
    TYPES.UNFULFILLED_ORDERS_BACKLOG,
    scope,
    severity,
    `${count} live ${count === 1 ? 'order remains' : 'orders remain'} unfulfilled past ${ageHours} hours`,
    `Synchronized order and fulfillment records show ${count} non-cancelled ${count === 1 ? 'order' : 'orders'} still marked unfulfilled or partially fulfilled more than ${ageHours} hours after order placement. This records current fulfillment status and does not assert carrier or warehouse root cause.`,
    { ...evidence, ageThresholdHours: ageHours, source: 'orders', storeId: scope.storeId },
    {
      label: 'Review unfulfilled orders',
      route: '/dashboard/rev-intell',
      guidance: 'Review open unfulfilled orders in Shopify Admin (Orders -> Unfulfilled) to verify picking, shipping labels, and fulfillment location assignments.',
      measurement: 'Confirm aged unfulfilled order counts decrease after fulfillment updates synchronize.',
    }
  );
  item.dedupe_key = `${TYPES.UNFULFILLED_ORDERS_BACKLOG}:${scope.storeId}:current`;
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
  return [...findings].filter(Boolean).sort((a, b) =>
    (SEVERITIES[b.severity] || 0) - (SEVERITIES[a.severity] || 0) ||
    String(a.type).localeCompare(String(b.type)) ||
    String(a.dedupe_key).localeCompare(String(b.dedupe_key)));
}

module.exports = {
  TYPES,
  EVALUATION_STATES,
  SIGNAL_CATEGORIES,
  SEVERITIES,
  detectIntegrationFailure,
  detectRevenueChange,
  detectOrderVolumeChange,
  detectReturningCustomerChange,
  detectRefundIncrease,
  detectNoRecentOrders,
  detectStorefrontDomainUnconfigured,
  detectProductsUnpublishedOrUnavailable,
  detectNoRecordedTraffic,
  detectTrafficWithoutOrders,
  detectOpenAbandonedCheckouts,
  detectInventoryStockouts,
  detectUnfulfilledOrdersBacklog,
  detectNoStorefrontEvents,
  prioritizeFindings,
};
