// src/services/businessHealth.js
// Task 218 — canonical business-health contract (rev-business-health-v1).
//
// ONE authoritative, typed, versioned contract for the Command Center. It is a
// PURE composition of existing, already-validated authorities — it never
// recomputes revenue, never re-derives integration state, and never invents a
// metric:
//   • integration indicator  -> rev-integration-state-v1 (Task 213), passed in
//                               the bundle and mapped, never re-derived.
//   • revenue                -> authoritative net order totals (orders.total is
//                               NET: gross minus refunded, per
//                               shopifyOrderFinancials financial rules).
//   • orders                 -> persisted order records.
//   • checkouts              -> persisted abandoned_carts / checkout semantics.
//   • product availability   -> product + inventory snapshot.
//
// CORE PRINCIPLE (Task 218 §8): business health is NEVER conflated with data
// availability / integration health. Every indicator therefore carries TWO
// independent axes:
//   • `status`        — business severity (healthy/attention/deteriorating/
//                       critical/insufficient_history).
//   • `data_quality`  — coverage + freshness (complete/partial/stale/unknown/
//                       unavailable/unsupported).
//
// Separation rule (documented, unit-tested): business severity (`status`) is
// ASSERTED ONLY when the indicator's coverage is `complete`. When coverage is
// partial/stale/unavailable/unsupported, the indicator still reports the value
// we DO have plus its `data_quality`, but `status` is `insufficient_history` —
// we do not manufacture a business judgment from data we cannot certify. A
// revenue decline is `status: deteriorating` with `data_quality: complete`; a
// store with no history is `status: insufficient_history` with
// `data_quality: unavailable`; a failed order sync is expressed on the
// INTEGRATION indicator and as the affected indicators' `data_quality:
// stale/partial`, NOT by erasing verified history.
//
// This module is PURE (no I/O): `buildBusinessHealth(bundle, now)` computes the
// contract from a pre-fetched `bundle`. `businessHealthRepository.js` is the
// thin, tenant-scoped I/O layer that fetches the bundle (store, reporting
// period, canonical integration state, order/checkout/inventory aggregates).
// Pure computation keeps every classification rule unit-testable.

'use strict';

const BUSINESS_HEALTH_CONTRACT_VERSION = 'rev-business-health-v1';

// Business severity (what the merchant's business is doing). A lack of detected
// issues is NOT sufficient for `healthy` — healthy requires complete, current,
// covered evidence AND a non-adverse signal.
const BUSINESS_STATUS = {
  HEALTHY: 'healthy',
  ATTENTION: 'attention',
  DETERIORATING: 'deteriorating',
  CRITICAL: 'critical',
  INSUFFICIENT_HISTORY: 'insufficient_history',
};

// Data quality (how much we can reliably assess). Independent of business state.
const DATA_QUALITY = {
  COMPLETE: 'complete',
  PARTIAL: 'partial',
  STALE: 'stale',
  UNKNOWN: 'unknown',
  UNAVAILABLE: 'unavailable',
  UNSUPPORTED: 'unsupported',
};

const INDICATOR_CATEGORY = {
  REVENUE: 'revenue',
  ORDERS: 'orders',
  CHECKOUTS: 'checkouts',
  PRODUCT_AVAILABILITY: 'product_availability',
  INTEGRATION: 'integration',
};

// Which canonical sync domains bound each business indicator's coverage.
// Coverage is derived from the canonical integration state's per-domain
// synchronization freshness (Task 213) — never re-measured here.
const INDICATOR_DOMAINS = Object.freeze({
  revenue: Object.freeze(['orders']),
  orders: Object.freeze(['orders']),
  checkouts: Object.freeze(['abandoned_checkouts']),
  product_availability: Object.freeze(['products', 'inventory']),
});

// Documented, metric-specific classification thresholds (Task 218 §8 — new
// thresholds are documented and unit-tested; no arbitrary magic numbers).
const THRESHOLDS = Object.freeze({
  revenue: Object.freeze({ critical_pct: -40, deteriorating_pct: -10 }),
  orders: Object.freeze({ critical_pct: -50, deteriorating_pct: -20 }),
  product: Object.freeze({ critical_oos_pct: 50, deteriorating_oos_pct: 20 }),
});

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v) => typeof v === 'string';
const iso = (d) => (d instanceof Date ? d.toISOString() : d);

// Round a money value to 2dp WITHOUT fabricating precision. Returns null when
// the input is null/undefined (unknown); never a fabricated 0.
function money(v) {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'string' ? Number(v) : v;
  if (!isNum(n)) return null;
  return Math.round(n * 100) / 100;
}

// Percent change vs a comparison base. Returns null (not a fabricated 0) when
// either side is unknown or the base is 0 (a change from zero is not a
// meaningful percentage).
function pctChange(base, current) {
  if (!isNum(base) || !isNum(current) || base === 0) return null;
  return Math.round(((current - base) / base) * 1000) / 10; // 1dp
}

function strOrNull(v) {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function strList(v) {
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
}

// --- Coverage (the data-availability axis) ---------------------------------
// Pure. Given the canonical integration state's per-domain synchronization map
// and the set of domains that bound an indicator, return whether that
// indicator's evidence is complete, and the resulting data_quality.
//   usable domain  = state 'succeeded' with freshness 'fresh' or 'aging'.
//   complete       = every bounding domain is usable.
//   stale          = we have data from a succeeded sync but it is no longer
//                    current (at least one domain 'stale') with no usable gap.
//   unavailable    = none of the bounding domains has ever synchronized.
//   partial        = some but not all domains usable / a domain failed/partial.
//   unknown        = no bounding evidence at all (e.g. no integration state).
// Usability is based on FRESHNESS (the age of the last SUCCESSFUL sync), not on
// the latest attempt's state. A domain whose latest attempt failed but whose
// last successful sync is still fresh provides usable data; the failure itself
// belongs to the INTEGRATION indicator (the separation principle), not to the
// business indicator's data quality.
function domainCoverage(domains, domainSet, now) {
  const hasAnyDomain = isObj(domains) && Object.keys(domains).length > 0;
  const perDomain = domainSet.map((domain) => {
    const st = hasAnyDomain && isObj(domains[domain]) ? domains[domain] : null;
    const state = st && typeof st.state === 'string' ? st.state : 'never_synchronized';
    const freshness = st && isObj(st.freshness) && typeof st.freshness.state === 'string'
      ? st.freshness.state
      : 'never_synchronized';
    const usable = freshness === 'fresh' || freshness === 'aging';
    return {
      domain, state, freshness, usable,
      last_succeeded_at: st && st.last_succeeded_at ? st.last_succeeded_at : null,
    };
  });

  const total = domainSet.length;
  const usableCount = perDomain.filter((d) => d.usable).length;
  const neverCount = perDomain.filter((d) => d.freshness === 'never_synchronized').length;
  const staleCount = perDomain.filter((d) => d.freshness === 'stale').length;

  const complete = usableCount === total;
  let data_quality;
  if (complete) data_quality = DATA_QUALITY.COMPLETE;
  else if (neverCount === total) data_quality = DATA_QUALITY.UNAVAILABLE;
  else if (usableCount === 0 && staleCount > 0) data_quality = DATA_QUALITY.STALE;
  else if (usableCount === 0) data_quality = DATA_QUALITY.UNKNOWN;
  else data_quality = DATA_QUALITY.PARTIAL;

  const blocking = perDomain.filter((d) => !d.usable);
  let reason;
  if (complete) reason = `All bounding synchronization domains are current: ${domainSet.join(', ')}.`;
  else if (data_quality === DATA_QUALITY.UNAVAILABLE) reason = `None of the required synchronization domains has ever succeeded: ${domainSet.join(', ')}.`;
  else if (data_quality === DATA_QUALITY.STALE) reason = `Synchronized data is present but older than the domain freshness policy: ${blocking.map((d) => d.domain).join(', ')}.`;
  else reason = `Incomplete coverage — not current domains: ${blocking.map((d) => `${d.domain} (${d.state}/${d.freshness})`).join(', ')}.`;

  return { complete, data_quality, reason, domains: perDomain };
}

function baseIndicator(id, category, title, now) {
  return {
    id,
    category,
    status: BUSINESS_STATUS.INSUFFICIENT_HISTORY,
    data_quality: DATA_QUALITY.UNKNOWN,
    title,
    explanation: '',
    value: null,
    comparison_value: null,
    change_pct: null,
    metric_definition: null,
    currency: null,
    reporting_period: null,
    comparison_period: null,
    timezone: null,
    source_evidence: [],
    last_verified_at: null,
    freshness: DATA_QUALITY.UNKNOWN,
    coverage: { complete: false, data_quality: DATA_QUALITY.UNKNOWN, reason: 'no evidence', domains: [] },
    confidence: null,
    limitations: [],
    next_step: null,
    status_changed_at: iso(now),
    value_components: null,
  };
}

// When coverage is not complete we do not assert business severity: report the
// value we have (or nothing) plus the data_quality, with a clear reason.
function markInsufficient(ind, coverage, note, nextStep) {
  ind.status = BUSINESS_STATUS.INSUFFICIENT_HISTORY;
  ind.data_quality = coverage.data_quality;
  ind.freshness = coverage.data_quality;
  ind.coverage = coverage;
  ind.explanation = note || `Business state is not asserted because coverage is ${coverage.data_quality} (${coverage.reason})`;
  if (nextStep) ind.next_step = nextStep;
  return ind;
}

// The data source itself is absent (e.g. a partial-fetch failure, or a store
// with no records at all): the VALUE is unavailable, independent of what the
// sync coverage says. We never fall back to a fabricated default.
function markAbsent(ind, coverage, note, nextStep) {
  ind.status = BUSINESS_STATUS.INSUFFICIENT_HISTORY;
  ind.data_quality = DATA_QUALITY.UNAVAILABLE;
  ind.freshness = DATA_QUALITY.UNAVAILABLE;
  ind.coverage = coverage;
  ind.explanation = note || 'No data was available for this indicator.';
  if (nextStep) ind.next_step = nextStep;
  return ind;
}

// --- Revenue ---------------------------------------------------------------
// Reuses shopifyOrderFinancials semantics (net = gross - authoritative refunds,
// null = unknown, 0 = genuine zero, 2dp). Gross/net/refunds/discounts are
// preserved as distinct components. Currency boundaries are respected.
function buildRevenueIndicator(b, now) {
  const ind = baseIndicator('revenue_health', INDICATOR_CATEGORY.REVENUE, 'Revenue health', now);
  const rp = b.reportingPeriod;
  ind.timezone = rp.timezone;
  ind.reporting_period = rp.current;
  ind.comparison_period = rp.comparison;
  ind.metric_definition = 'Net sales = sum of authoritative net order totals (gross minus refunded amounts) in the store reporting currency over the period.';
  ind.source_evidence = ['orders', 'order_refunds'];

  const coverage = domainCoverage(b.integrationDomains, INDICATOR_DOMAINS.revenue, now);
  ind.coverage = coverage;
  ind.data_quality = coverage.data_quality;
  ind.freshness = coverage.data_quality;
  ind.last_verified_at = mostRecentVerified(coverage.domains);

  const r = b.revenue;
  const cur = isObj(r) && isObj(r.current) ? r.current : null;
  const cmp = isObj(r) && isObj(r.comparison) ? r.comparison : null;

  if (!cur) {
    return markAbsent(ind, coverage,
      'Revenue evidence is not available for this store.',
      'Check order synchronization coverage, then reassess.');
  }

  const currency = strOrNull(cur.currency);
  ind.currency = currency;
  ind.value = money(cur.net); // null = unknown, 0 = genuine zero
  ind.value_components = {
    net: money(cur.net),
    gross: money(cur.gross),
    refunds: money(cur.refunds),
    discounts: cur && 'discounts' in cur ? money(cur.discounts) : null,
    order_count: isNum(cur.order_count) ? cur.order_count : null,
  };

  let crossCurrency = false;
  if (cmp && strOrNull(cmp.currency) && currency && strOrNull(cmp.currency) !== currency) crossCurrency = true;
  if (crossCurrency) {
    ind.limitations = ind.limitations.concat([`Comparison period spans a different currency (${strOrNull(cmp.currency)} vs ${currency}); a change is not computed across currency boundaries.`]);
  }
  ind.comparison_value = cmp ? money(cmp.net) : null;
  ind.change_pct = !crossCurrency && isNum(cmp ? cmp.net : null) ? pctChange(cmp.net, cur.net) : null;

  if (coverage.data_quality !== DATA_QUALITY.COMPLETE) {
    return markInsufficient(ind, coverage,
      `Revenue coverage is ${coverage.data_quality} (${coverage.reason}); a business state is not asserted. Net sales of ${ind.value === null ? 'unknown amount' : `${ind.value} ${currency || ''}`.trim()} for the period are shown for context only.`,
      'Wait for complete, current order synchronization, then reassess.');
  }

  const change = ind.change_pct;
  if (!cmp || change === null) {
    ind.status = BUSINESS_STATUS.INSUFFICIENT_HISTORY;
    ind.explanation = crossCurrency
      ? 'Revenue is reported for the period only; no change is computed because the comparison period spans a different currency.'
      : 'No valid comparison period exists; revenue is reported for the period only, without a change classification.';
    if (!crossCurrency) ind.limitations = ind.limitations.concat(['Insufficient history for a revenue change classification.']);
    return ind;
  }
  if (change <= THRESHOLDS.revenue.critical_pct) {
    ind.status = BUSINESS_STATUS.CRITICAL;
    ind.explanation = `Net sales fell ${Math.abs(change)}% versus the comparison period. The cause is not asserted.`;
    ind.next_step = 'Investigate revenue drivers (orders, refunds, discounts) with Rev Intelligence.';
  } else if (change <= THRESHOLDS.revenue.deteriorating_pct) {
    ind.status = BUSINESS_STATUS.DETERIORATING;
    ind.explanation = `Net sales fell ${Math.abs(change)}% versus the comparison period. The cause is not asserted.`;
    ind.next_step = 'Investigate revenue drivers with Rev Intelligence.';
  } else if (change < 0) {
    ind.status = BUSINESS_STATUS.ATTENTION;
    ind.explanation = `Net sales eased ${Math.abs(change)}% versus the comparison period.`;
  } else {
    ind.status = BUSINESS_STATUS.HEALTHY;
    ind.explanation = change > 0
      ? `Net sales grew ${change}% versus the comparison period.`
      : 'Net sales are stable versus the comparison period.';
  }
  ind.limitations = strList(b.revenueLimitations);
  return ind;
}

// --- Orders ----------------------------------------------------------------
function buildOrderIndicator(b, now) {
  const ind = baseIndicator('order_health', INDICATOR_CATEGORY.ORDERS, 'Order health', now);
  const rp = b.reportingPeriod;
  ind.timezone = rp.timezone;
  ind.reporting_period = rp.current;
  ind.comparison_period = rp.comparison;
  ind.metric_definition = 'Order count = distinct persisted orders (deduplicated by external order id) ordered in the store timezone over the period.';
  ind.source_evidence = ['orders'];

  const coverage = domainCoverage(b.integrationDomains, INDICATOR_DOMAINS.orders, now);
  ind.coverage = coverage;
  ind.data_quality = coverage.data_quality;
  ind.freshness = coverage.data_quality;
  ind.last_verified_at = mostRecentVerified(coverage.domains);

  const o = b.orders;
  const cur = isObj(o) && isObj(o.current) ? o.current : null;
  const cmp = isObj(o) && isObj(o.comparison) ? o.comparison : null;

  if (!cur) {
    return markAbsent(ind, coverage,
      'Order evidence is not available for this store.',
      'Check order synchronization coverage.');
  }

  ind.value = isNum(cur.count) ? cur.count : null;
  ind.value_components = {
    count: isNum(cur.count) ? cur.count : null,
    cancelled: isNum(cur.cancelled_count) ? cur.cancelled_count : null,
    refunded: isNum(cur.refunded_count) ? cur.refunded_count : null,
  };
  ind.comparison_value = cmp && isNum(cmp.count) ? cmp.count : null;
  ind.change_pct = isNum(ind.comparison_value) && isNum(cur.count) ? pctChange(cmp.count, cur.count) : null;

  if (coverage.data_quality !== DATA_QUALITY.COMPLETE) {
    return markInsufficient(ind, coverage,
      `Order coverage is ${coverage.data_quality} (${coverage.reason}); a business state is not asserted. The count shown (${ind.value}) is context only and should not be read as the true order volume.`,
      'Wait for complete, current order synchronization, then reassess.');
  }

  const change = ind.change_pct;
  if (!cmp || change === null) {
    if (isNum(cur.count) && cur.count === 0) {
      ind.status = BUSINESS_STATUS.HEALTHY;
      ind.explanation = 'Zero orders were verified for the period under complete coverage. This is an observed result, not missing data, and is not by itself a problem.';
      ind.limitations = ['A verified zero order count is distinguished from a missing order count.'];
    } else {
      ind.status = BUSINESS_STATUS.INSUFFICIENT_HISTORY;
      ind.explanation = 'Orders are present but no valid comparison period exists for a change classification.';
      ind.limitations = ['Insufficient history for an order-volume change classification.'];
    }
    return ind;
  }
  if (change <= THRESHOLDS.orders.critical_pct) {
    ind.status = BUSINESS_STATUS.CRITICAL;
    ind.explanation = `Order volume fell ${Math.abs(change)}% versus the comparison period. Cause is not asserted.`;
    ind.next_step = 'Investigate order volume with Rev Intelligence.';
  } else if (change <= THRESHOLDS.orders.deteriorating_pct) {
    ind.status = BUSINESS_STATUS.DETERIORATING;
    ind.explanation = `Order volume fell ${Math.abs(change)}% versus the comparison period. Cause is not asserted.`;
    ind.next_step = 'Investigate order volume with Rev Intelligence.';
  } else if (change < 0) {
    ind.status = BUSINESS_STATUS.ATTENTION;
    ind.explanation = `Order volume eased ${Math.abs(change)}% versus the comparison period.`;
  } else {
    ind.status = BUSINESS_STATUS.HEALTHY;
    ind.explanation = change > 0 ? `Order volume grew ${change}% versus the comparison period.` : 'Order volume is stable versus the comparison period.';
  }
  ind.limitations = strList(b.orderLimitations);
  return ind;
}

// --- Checkouts -------------------------------------------------------------
// Actual abandoned_carts / checkout semantics. Never assumes all incomplete
// checkouts are abandoned; never computes conversion without a valid
// denominator; abandoned value is exposure, NOT confirmed lost revenue.
function buildCheckoutIndicator(b, now) {
  const ind = baseIndicator('checkout_health', INDICATOR_CATEGORY.CHECKOUTS, 'Checkout health', now);
  const rp = b.reportingPeriod;
  ind.timezone = rp.timezone;
  ind.reporting_period = rp.current;
  ind.comparison_period = rp.comparison;
  ind.metric_definition = 'Abandoned checkouts = checkouts carrying a verified abandoned status from the source. Value is at-risk exposure, not confirmed lost revenue.';
  ind.source_evidence = ['abandoned_carts'];

  const coverage = domainCoverage(b.integrationDomains, INDICATOR_DOMAINS.checkouts, now);
  ind.coverage = coverage;
  ind.data_quality = coverage.data_quality;
  ind.freshness = coverage.data_quality;
  ind.last_verified_at = mostRecentVerified(coverage.domains);

  const c = b.checkouts;
  const cur = isObj(c) && isObj(c.current) ? c.current : null;

  if (!cur) {
    return markAbsent(ind, coverage,
      'Checkout evidence is not available for this store; no abandonment or conversion metric is manufactured.',
      'Review integration authorization for checkout access.');
  }

  ind.currency = strOrNull(cur.currency);
  ind.value = isNum(cur.abandoned_count) ? cur.abandoned_count : null;
  ind.value_components = {
    abandoned_count: isNum(cur.abandoned_count) ? cur.abandoned_count : null,
    completed_count: isNum(cur.completed_count) ? cur.completed_count : null,
    at_risk_value: money(cur.at_risk_value),
  };

  // Conversion only with a valid denominator (completed + abandoned > 0).
  const denom = (isNum(cur.completed_count) ? cur.completed_count : 0) + (isNum(cur.abandoned_count) ? cur.abandoned_count : 0);
  ind.conversion_rate = denom > 0 && isNum(cur.completed_count) ? Math.round((cur.completed_count / denom) * 1000) / 10 : null;

  if (coverage.data_quality !== DATA_QUALITY.COMPLETE) {
    return markInsufficient(ind, coverage,
      `Checkout coverage is ${coverage.data_quality} (${coverage.reason}); a business state is not asserted. Not every incomplete checkout is treated as abandoned.`,
      'Wait for complete, current checkout synchronization, then reassess.');
  }

  const atRisk = money(cur.at_risk_value);
  if (isNum(cur.abandoned_count) && cur.abandoned_count > 0 && atRisk !== null && atRisk > 0) {
    ind.status = BUSINESS_STATUS.ATTENTION;
    ind.explanation = `${cur.abandoned_count} checkouts were verified abandoned (${atRisk} at risk in ${ind.currency || 'the store currency'}). This is at-risk exposure, not confirmed lost revenue.`;
    ind.next_step = 'Review the cart-recovery signal and checkout friction with Rev Intelligence.';
  } else {
    ind.status = BUSINESS_STATUS.HEALTHY;
    ind.explanation = isNum(cur.abandoned_count) && cur.abandoned_count === 0
      ? 'No checkouts were verified abandoned for the period.'
      : 'Checkout activity is present without a material abandonment signal.';
  }
  ind.limitations = strList(b.checkoutLimitations).concat(['Abandoned checkout value is exposure, not confirmed lost revenue.']);
  return ind;
}

// --- Product availability --------------------------------------------------
// Product status vs inventory quantity; verified-zero vs unavailable; no
// historical-stockout inference; snapshot-only when no history.
function buildProductAvailabilityIndicator(b, now) {
  const ind = baseIndicator('product_availability_health', INDICATOR_CATEGORY.PRODUCT_AVAILABILITY, 'Product availability', now);
  const rp = b.reportingPeriod;
  ind.timezone = rp.timezone;
  ind.reporting_period = rp.current;
  ind.metric_definition = 'Products available for sale vs. unavailable, plus out-of-stock products from the current synchronized inventory snapshot.';
  ind.source_evidence = ['products', 'inventory_levels'];

  const coverage = domainCoverage(b.integrationDomains, INDICATOR_DOMAINS.product_availability, now);
  ind.coverage = coverage;
  ind.data_quality = coverage.data_quality;
  ind.freshness = coverage.data_quality;

  const snap = isObj(b.productAvailability) && isObj(b.productAvailability.snapshot) ? b.productAvailability.snapshot : null;
  if (snap && snap.synced_at) ind.last_verified_at = snap.synced_at;

  if (!snap) {
    return markAbsent(ind, coverage,
      'No product/inventory snapshot is available for the store; availability is not assessed.',
      'Check product and inventory synchronization coverage.');
  }

  const available = isNum(snap.available_count) ? snap.available_count : 0;
  const unavailable = isNum(snap.unavailable_count) ? snap.unavailable_count : 0;
  const oos = isNum(snap.out_of_stock_count) ? snap.out_of_stock_count : 0;
  // Total verified products INCLUDES the out-of-stock set (the denominator for
  // the out-of-stock share).
  const total = available + unavailable + oos;
  ind.value = isNum(snap.available_count) ? snap.available_count : null;
  ind.value_components = {
    available_count: isNum(snap.available_count) ? snap.available_count : null,
    unavailable_count: isNum(snap.unavailable_count) ? snap.unavailable_count : null,
    out_of_stock_count: isNum(snap.out_of_stock_count) ? snap.out_of_stock_count : null,
  };

  if (total === 0) {
    return markInsufficient(ind, coverage,
      'No products were verified for the store; availability is not classified (this is not read as an out-of-stock condition).',
      'Confirm product catalog synchronization.');
  }

  if (coverage.data_quality !== DATA_QUALITY.COMPLETE) {
    return markInsufficient(ind, coverage,
      `Product/inventory coverage is ${coverage.data_quality} (${coverage.reason}); a business state is not asserted. The snapshot is shown for context only.`,
      'Wait for complete, current product and inventory synchronization, then reassess.');
  }

  if (oos > 0) {
    const share = Math.round((oos / Math.max(total, 1)) * 100);
    ind.status = share >= THRESHOLDS.product.critical_oos_pct
      ? BUSINESS_STATUS.CRITICAL
      : (share >= THRESHOLDS.product.deteriorating_oos_pct ? BUSINESS_STATUS.DETERIORATING : BUSINESS_STATUS.ATTENTION);
    ind.explanation = `${oos} product(s) are verified out of stock in the current snapshot (${share}% of ${total}). Historical stockouts are not inferred from this snapshot.`;
    ind.next_step = 'Review replenishment for out-of-stock products.';
  } else {
    ind.status = BUSINESS_STATUS.HEALTHY;
    ind.explanation = 'No products are verified out of stock in the current snapshot.';
  }
  // Snapshot-only limitation (Task 218 §6): no historical inventory claim.
  ind.limitations = strList(b.productLimitations).concat([
    'This indicator reflects the current inventory snapshot only; historical stockouts or lost demand are not inferred without genuine history.',
  ]);
  return ind;
}

// --- Integration -----------------------------------------------------------
// Composes rev-integration-state-v1 (Task 213) — never re-derived. A connected
// account is NOT automatically "fully synchronized".
const INTEGRATION_STATE_TO_BUSINESS = Object.freeze({
  connected: BUSINESS_STATUS.HEALTHY,
  synchronizing: BUSINESS_STATUS.ATTENTION,
  limited_access: BUSINESS_STATUS.ATTENTION,
  needs_attention: BUSINESS_STATUS.ATTENTION,
  sync_partial: BUSINESS_STATUS.ATTENTION,
  sync_failed: BUSINESS_STATUS.DETERIORATING,
  disconnected: BUSINESS_STATUS.CRITICAL,
  authorization_required: BUSINESS_STATUS.CRITICAL,
  authorization_expired: BUSINESS_STATUS.CRITICAL,
  authorization_revoked: BUSINESS_STATUS.CRITICAL,
  unsupported: BUSINESS_STATUS.INSUFFICIENT_HISTORY,
  unknown: BUSINESS_STATUS.INSUFFICIENT_HISTORY,
});

function buildIntegrationIndicator(b, now) {
  const ind = baseIndicator('integration_health', INDICATOR_CATEGORY.INTEGRATION, 'Integration & synchronization', now);
  const rp = b.reportingPeriod;
  ind.timezone = rp.timezone;
  ind.reporting_period = rp.current;
  ind.metric_definition = 'Connection, authorization, and synchronization state from the canonical rev-integration-state-v1 contract (Task 213). A connected account is not automatically fully synchronized.';
  ind.source_evidence = ['stores', 'store_sync_domain_states', 'webhook_registrations', 'webhook_deliveries', 'intelligence_order_coverage'];

  const state = isObj(b.integration) && typeof b.integration.overall_status === 'string' ? b.integration : null;
  if (!state) {
    ind.status = BUSINESS_STATUS.INSUFFICIENT_HISTORY;
    ind.data_quality = DATA_QUALITY.UNKNOWN;
    ind.freshness = DATA_QUALITY.UNKNOWN;
    ind.coverage = { complete: false, data_quality: DATA_QUALITY.UNKNOWN, reason: 'No integration state was available to evaluate.', domains: [] };
    ind.explanation = 'Integration state is not available; connection and synchronization are not asserted.';
    ind.limitations = ['Integration state could not be evaluated.'];
    return ind;
  }

  ind.value = state.overall_status;
  ind.status = INTEGRATION_STATE_TO_BUSINESS[state.overall_status] || BUSINESS_STATUS.INSUFFICIENT_HISTORY;
  ind.data_quality = state.overall_status === 'unknown' ? DATA_QUALITY.UNKNOWN : DATA_QUALITY.COMPLETE;
  ind.freshness = ind.data_quality;
  ind.coverage = {
    complete: state.overall_status !== 'unknown',
    data_quality: ind.data_quality,
    reason: state.status_reason ? `Canonical integration state: ${state.overall_status} (${state.status_reason}).` : 'Canonical integration state evaluated.',
    domains: [],
  };
  ind.last_verified_at = state.evaluated_at || null;
  const sync = isObj(state.synchronization) ? state.synchronization : {};
  ind.value_components = {
    overall_status: state.overall_status,
    authorization_verification: isObj(state.authorization) ? state.authorization.verification : null,
    last_succeeded_sync: sync.last_succeeded_at || null,
    running_domains: Array.isArray(sync.running_domains) ? sync.running_domains : [],
    failed_domains: Array.isArray(sync.failed_domains) ? sync.failed_domains : [],
    partial_domains: Array.isArray(sync.partial_domains) ? sync.partial_domains : [],
  };
  ind.explanation = strOrNull(state.status_explanation) || `Integration state is ${state.overall_status}.`;
  ind.limitations = strList(state.limitations || []);
  ind.next_step = strOrNull(state.recommended_next_step);
  if (state.overall_status === 'connected') {
    ind.limitations = ind.limitations.concat(['Connected does not guarantee all resources are fully synchronized.']);
  }
  return ind;
}

function mostRecentVerified(domains) {
  const times = (domains || [])
    .map((d) => (d && d.last_succeeded_at ? new Date(d.last_succeeded_at).getTime() : null))
    .filter((t) => Number.isFinite(t));
  if (!times.length) return null;
  return new Date(Math.max(...times)).toISOString();
}

// ---------------------------------------------------------------------------
// Top-level builder.
// ---------------------------------------------------------------------------

function overallBusinessStatus(indicators) {
  const rank = {
    [BUSINESS_STATUS.CRITICAL]: 4,
    [BUSINESS_STATUS.DETERIORATING]: 3,
    [BUSINESS_STATUS.ATTENTION]: 2,
    [BUSINESS_STATUS.HEALTHY]: 1,
    [BUSINESS_STATUS.INSUFFICIENT_HISTORY]: 0,
  };
  let worst = null;
  for (const ind of indicators) {
    if (ind.status === BUSINESS_STATUS.INSUFFICIENT_HISTORY) continue;
    if (!worst || (rank[ind.status] || 0) > (rank[worst] || 0)) worst = ind.status;
  }
  return worst || BUSINESS_STATUS.INSUFFICIENT_HISTORY;
}

function buildAffectedNote(byCategory, dq) {
  const notes = [];
  const integ = byCategory.integration;
  if (integ && ['sync_failed', 'disconnected', 'authorization_revoked', 'authorization_expired', 'authorization_required'].includes(integ.value)) {
    notes.push(`Integration is ${integ.value}; revenue, order, checkout and product indicators may reflect stale or incomplete data. Verified historical values are preserved, not erased.`);
  }
  for (const cat of dq.unavailable) {
    if (cat !== 'integration') notes.push(`${cat.replace(/_/g, ' ')} evidence is unavailable for this period; that indicator is shown as unavailable, not suppressed.`);
  }
  for (const cat of dq.partial) {
    notes.push(`${cat.replace(/_/g, ' ')} coverage is partial; its business state is not asserted from incomplete data.`);
  }
  return notes.length > 0 ? notes : null;
}

function buildBusinessHealth(bundle, now = new Date()) {
  const b = bundle || {};
  const nowD = now instanceof Date ? now : new Date(now);
  const reportingPeriod = isObj(b.reportingPeriod) ? b.reportingPeriod : {
    current: { label: 'last_7_days', start: null, end: null },
    comparison: { label: 'previous_7_days', start: null, end: null },
    timezone: (b.store && typeof b.store.iana_timezone === 'string') ? b.store.iana_timezone : 'UTC',
    period_basis: 'rolling_7d_utc',
  };

  // The canonical integration state's per-domain synchronization map drives
  // coverage for every data-bound indicator. Absent (no store / disconnected)
  // -> domainCoverage yields 'unavailable'.
  const integrationState = isObj(b.integration) ? b.integration : null;
  const integrationDomains = integrationState && isObj(integrationState.synchronization) && isObj(integrationState.synchronization.domains)
    ? integrationState.synchronization.domains
    : null;

  const ctx = { ...b, reportingPeriod, integration: integrationState, integrationDomains };
  const indicators = [
    buildRevenueIndicator(ctx, nowD),
    buildOrderIndicator(ctx, nowD),
    buildCheckoutIndicator(ctx, nowD),
    buildProductAvailabilityIndicator(ctx, nowD),
    buildIntegrationIndicator(ctx, nowD),
  ];

  const byCategory = {};
  for (const ind of indicators) byCategory[ind.category] = ind;

  const businessStatus = overallBusinessStatus(indicators);
  const dataQualitySummary = {
    complete: indicators.filter((i) => i.data_quality === DATA_QUALITY.COMPLETE).map((i) => i.category),
    partial: indicators.filter((i) => i.data_quality === DATA_QUALITY.PARTIAL).map((i) => i.category),
    stale: indicators.filter((i) => i.data_quality === DATA_QUALITY.STALE).map((i) => i.category),
    unavailable: indicators.filter((i) => i.data_quality === DATA_QUALITY.UNAVAILABLE).map((i) => i.category),
    unsupported: indicators.filter((i) => i.data_quality === DATA_QUALITY.UNSUPPORTED).map((i) => i.category),
    unknown: indicators.filter((i) => i.data_quality === DATA_QUALITY.UNKNOWN).map((i) => i.category),
  };

  return {
    contract_version: BUSINESS_HEALTH_CONTRACT_VERSION,
    organization_id: (b.store && b.store.organization_id) || null,
    store_id: (b.store && b.store.id) || null,
    shop_domain: (b.store && b.store.shop_domain) || null,
    generated_at: iso(nowD),
    reporting_period: reportingPeriod,
    business_status: businessStatus,
    business_status_explanation: businessStatus === BUSINESS_STATUS.INSUFFICIENT_HISTORY
      ? 'Sufficient, complete, current evidence is not available to classify overall business health; each indicator is shown with its individual data-quality context.'
      : `The most severe supported business state across complete indicators is ${businessStatus}.`,
    indicators,
    by_category: byCategory,
    data_quality: dataQualitySummary,
    affected_indicators_note: buildAffectedNote(byCategory, dataQualitySummary),
  };
}

// ---------------------------------------------------------------------------
// Fail-closed validator (API boundary). Returns an array of problem strings.
// ---------------------------------------------------------------------------

const VALID_BUSINESS = new Set(Object.values(BUSINESS_STATUS));
const VALID_DQ = new Set(Object.values(DATA_QUALITY));
const VALID_CAT = new Set(Object.values(INDICATOR_CATEGORY));
const REQUIRED_CATEGORIES = Object.values(INDICATOR_CATEGORY);

function validateIndicator(ind, cat) {
  const problems = [];
  if (!isObj(ind)) return [`indicator ${cat} is not an object`];
  if (typeof ind.id !== 'string' || ind.id.length === 0) problems.push(`${cat}.id missing`);
  if (ind.category !== cat) problems.push(`${cat}.category mismatch`);
  if (!VALID_BUSINESS.has(ind.status)) problems.push(`${cat}.status invalid: ${ind.status}`);
  if (!VALID_DQ.has(ind.data_quality)) problems.push(`${cat}.data_quality invalid: ${ind.data_quality}`);
  if (typeof ind.title !== 'string') problems.push(`${cat}.title missing`);
  // value is a number for the data indicators and a state string for the
  // integration indicator; both are valid, unknown (null) is valid.
  if (ind.value !== null && ind.value !== undefined && !isNum(ind.value) && !isStr(ind.value)) {
    problems.push(`${cat}.value must be number, string, or null`);
  }
  if (ind.change_pct !== null && ind.change_pct !== undefined && !isNum(ind.change_pct)) problems.push(`${cat}.change_pct must be number or null`);
  if (ind.currency !== null && ind.currency !== undefined && typeof ind.currency !== 'string') problems.push(`${cat}.currency must be string or null`);
  if (ind.freshness !== undefined && !VALID_DQ.has(ind.freshness)) problems.push(`${cat}.freshness invalid: ${ind.freshness}`);
  if (ind.coverage !== undefined && !isObj(ind.coverage)) problems.push(`${cat}.coverage must be an object`);
  if (ind.value_components !== null && ind.value_components !== undefined && !isObj(ind.value_components)) problems.push(`${cat}.value_components must be object or null`);
  if (ind.limitations !== undefined && !Array.isArray(ind.limitations)) problems.push(`${cat}.limitations must be an array`);
  if (ind.source_evidence !== undefined && !Array.isArray(ind.source_evidence)) problems.push(`${cat}.source_evidence must be an array`);
  return problems;
}

function validateBusinessHealth(obj) {
  const problems = [];
  if (!isObj(obj)) return ['business health is not an object'];
  if (obj.contract_version !== BUSINESS_HEALTH_CONTRACT_VERSION) {
    problems.push(`contract_version must be ${BUSINESS_HEALTH_CONTRACT_VERSION}`);
  }
  if (typeof obj.organization_id !== 'string' || typeof obj.store_id !== 'string') problems.push('organization_id/store_id must be present');
  if (!VALID_BUSINESS.has(obj.business_status)) problems.push(`business_status invalid: ${obj.business_status}`);
  if (!Array.isArray(obj.indicators)) {
    problems.push('indicators must be an array');
  } else {
    if (obj.indicators.length !== REQUIRED_CATEGORIES.length) {
      problems.push(`indicators must be an array of ${REQUIRED_CATEGORIES.length}`);
    }
    const seen = new Set();
    for (const ind of obj.indicators) {
      const cat = ind && ind.category;
      if (!VALID_CAT.has(cat)) { problems.push(`unknown indicator category: ${cat}`); continue; }
      if (seen.has(cat)) { problems.push(`duplicate indicator category: ${cat}`); continue; }
      seen.add(cat);
      problems.push(...validateIndicator(ind, cat));
    }
    for (const cat of REQUIRED_CATEGORIES) if (!seen.has(cat)) problems.push(`missing indicator category: ${cat}`);
  }
  if (obj.data_quality !== undefined && !isObj(obj.data_quality)) problems.push('data_quality must be an object');
  return problems;
}

module.exports = {
  BUSINESS_HEALTH_CONTRACT_VERSION,
  BUSINESS_STATUS,
  DATA_QUALITY,
  INDICATOR_CATEGORY,
  INDICATOR_DOMAINS,
  THRESHOLDS,
  domainCoverage,
  buildBusinessHealth,
  validateBusinessHealth,
};
