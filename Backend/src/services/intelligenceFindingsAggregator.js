'use strict';
const {
  TYPES,
  EVALUATION_STATES,
  SIGNAL_CATEGORIES,
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
  prioritizeFindings,
} = require('./intelligenceFindingsEngine');

const { TRUSTED_SOURCE } = require('./intelligenceOrderCoverage');

const DAY = 86400000;
const STALE_THRESHOLD_MS = 48 * 3600_000;
const UNFULFILLED_AGE_HOURS = 48;
const EXCLUDED_RECOVERY_STATUSES = new Set(['cancelled', 'canceled', 'voided', 'deleted']);
const UNFULFILLED_STATUSES = new Set(['UNFULFILLED', 'PARTIALLY_FULFILLED', 'IN_PROGRESS', 'ON_HOLD']);

const windowIso = ms => new Date(ms).toISOString();
const sameCurrency = rows => [...new Set(rows.map(row => row.currency))];
const safeNumber = value => Number(value);
const verifiedSync = store => ['active', 'connected'].includes(store.status) && Boolean(store.last_synced_at);

function isoOrNull(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function domainFreshness(row, now) {
  if (!row) return { state: EVALUATION_STATES.NOT_EVALUATED, syncedAt: null, errorCode: null };
  const status = String(row.status || '').toLowerCase();
  const capability = String(row.capability_state || '').toLowerCase();
  const syncedAt = isoOrNull(row.last_succeeded_at);
  if (status === 'failed' || status === 'error') {
    return {
      state: EVALUATION_STATES.EVALUATION_FAILED,
      syncedAt,
      errorCode: row.error_code || 'SYNC_FAILED',
    };
  }
  if (['unauthorized', 'missing_scope', 'unsupported', 'blocked_by_auth_or_unsupported'].includes(status) ||
      ['unauthorized', 'missing_scope', 'unsupported'].includes(capability)) {
    return {
      state: EVALUATION_STATES.NOT_EVALUATED,
      syncedAt,
      errorCode: row.error_code || capability || status,
    };
  }
  if (status === 'ok' || status === 'succeeded') {
    if (!syncedAt) return { state: EVALUATION_STATES.NOT_EVALUATED, syncedAt: null, errorCode: null };
    const ageMs = now.getTime() - Date.parse(syncedAt);
    if (ageMs > STALE_THRESHOLD_MS) {
      return { state: EVALUATION_STATES.STALE, syncedAt, errorCode: null };
    }
    return { state: 'fresh', syncedAt, errorCode: null };
  }
  return { state: EVALUATION_STATES.NOT_EVALUATED, syncedAt, errorCode: row.error_code || null };
}

function summarizeSignals(signals, { now, periodDays }) {
  const counts = {
    total_signals: signals.length,
    evaluated_count: 0,
    verified_findings_count: 0,
    not_detected_count: 0,
    not_evaluated_count: 0,
    failed_count: 0,
    stale_count: 0,
  };
  for (const sig of signals) {
    if (sig.state === EVALUATION_STATES.VERIFIED) {
      counts.evaluated_count += 1;
      counts.verified_findings_count += 1;
    } else if (sig.state === EVALUATION_STATES.NOT_DETECTED) {
      counts.evaluated_count += 1;
      counts.not_detected_count += 1;
    } else if (sig.state === EVALUATION_STATES.NOT_EVALUATED) {
      counts.not_evaluated_count += 1;
    } else if (sig.state === EVALUATION_STATES.EVALUATION_FAILED) {
      counts.failed_count += 1;
    } else if (sig.state === EVALUATION_STATES.STALE) {
      counts.stale_count += 1;
    }
  }
  const incomplete = counts.not_evaluated_count > 0 || counts.failed_count > 0 || counts.stale_count > 0;
  return {
    contract_version: 'signal-evaluation-coverage-v1',
    evaluated_at: now.toISOString(),
    period_days: periodDays,
    complete: !incomplete && counts.total_signals > 0,
    incomplete,
    summary: counts,
    signals,
  };
}

/**
 * Pure read-only signal evaluation coverage summary built from synchronized
 * domain states, coverage records, and active verified findings. Used by
 * Command Center so every read transparently distinguishes evaluated signals
 * from unevaluated, failed, or stale categories without performing writes.
 */
function buildSignalEvaluationSummary({
  store = null,
  domainRows = [],
  storeProfile = null,
  coverage = null,
  activeFindings = [],
  now = new Date(),
  periodDays = 7,
} = {}) {
  const byDomain = new Map((domainRows || []).map(row => [row.domain, row]));
  const findingTypes = new Set((activeFindings || []).map(item => item.type));
  const evaluatedAtIso = now.toISOString();

  if (!store) {
    const signals = [
      { id: 'storefront_readiness', label: 'Storefront readiness', category: SIGNAL_CATEGORIES.STOREFRONT_READINESS, state: EVALUATION_STATES.NOT_EVALUATED, finding_types: [], source: 'store_profiles, store_domains', last_evaluated_at: null, reason: 'No connected store is available to evaluate.' },
      { id: 'traffic_acquisition', label: 'Traffic & acquisition', category: SIGNAL_CATEGORIES.TRAFFIC_ACQUISITION, state: EVALUATION_STATES.NOT_EVALUATED, finding_types: [], source: 'analytics.reports', last_evaluated_at: null, reason: 'No connected store is available to evaluate.' },
      { id: 'sales_revenue', label: 'Sales & revenue', category: SIGNAL_CATEGORIES.SALES_REVENUE, state: EVALUATION_STATES.NOT_EVALUATED, finding_types: [], source: 'orders', last_evaluated_at: null, reason: 'No connected store is available to evaluate.' },
      { id: 'conversion_purchasing', label: 'Conversion & purchasing', category: SIGNAL_CATEGORIES.CONVERSION_PURCHASING, state: EVALUATION_STATES.NOT_EVALUATED, finding_types: [], source: 'abandoned_carts', last_evaluated_at: null, reason: 'No connected store is available to evaluate.' },
      { id: 'product_inventory', label: 'Product & inventory', category: SIGNAL_CATEGORIES.PRODUCT_INVENTORY, state: EVALUATION_STATES.NOT_EVALUATED, finding_types: [], source: 'products, inventory_levels', last_evaluated_at: null, reason: 'No connected store is available to evaluate.' },
      { id: 'customer_fulfillment', label: 'Customer & fulfillment', category: SIGNAL_CATEGORIES.CUSTOMER_FULFILLMENT, state: EVALUATION_STATES.NOT_EVALUATED, finding_types: [], source: 'orders, order_fulfillments, order_refunds', last_evaluated_at: null, reason: 'No connected store is available to evaluate.' },
    ];
    return summarizeSignals(signals, { now, periodDays });
  }

  const signals = [];

  // 1. Storefront readiness
  const domainCheck = domainFreshness(byDomain.get('store_domains'), now);
  const storefrontFindings = [TYPES.STOREFRONT_DOMAIN_UNCONFIGURED, TYPES.PRODUCTS_UNPUBLISHED_OR_UNAVAILABLE].filter(t => findingTypes.has(t));
  if (storefrontFindings.length > 0) {
    signals.push({
      id: 'storefront_readiness',
      label: 'Storefront readiness',
      category: SIGNAL_CATEGORIES.STOREFRONT_READINESS,
      state: EVALUATION_STATES.VERIFIED,
      finding_types: storefrontFindings,
      source: 'store_profiles, store_domains',
      last_evaluated_at: domainCheck.syncedAt || evaluatedAtIso,
      reason: 'Verified storefront readiness issue detected from synchronized domain and catalog records.',
    });
  } else if (domainCheck.state === EVALUATION_STATES.EVALUATION_FAILED) {
    signals.push({
      id: 'storefront_readiness',
      label: 'Storefront readiness',
      category: SIGNAL_CATEGORIES.STOREFRONT_READINESS,
      state: EVALUATION_STATES.EVALUATION_FAILED,
      finding_types: [],
      source: 'store_domains',
      last_evaluated_at: domainCheck.syncedAt,
      reason: `Store domain synchronization failed (${domainCheck.errorCode || 'sync error'}).`,
    });
  } else if (domainCheck.state === EVALUATION_STATES.STALE) {
    signals.push({
      id: 'storefront_readiness',
      label: 'Storefront readiness',
      category: SIGNAL_CATEGORIES.STOREFRONT_READINESS,
      state: EVALUATION_STATES.STALE,
      finding_types: [],
      source: 'store_domains',
      last_evaluated_at: domainCheck.syncedAt,
      reason: 'Store domain data is older than 48 hours and needs re-verification.',
    });
  } else if (domainCheck.state === 'fresh' || storeProfile) {
    signals.push({
      id: 'storefront_readiness',
      label: 'Storefront readiness',
      category: SIGNAL_CATEGORIES.STOREFRONT_READINESS,
      state: EVALUATION_STATES.NOT_DETECTED,
      finding_types: [],
      source: 'store_profiles, store_domains',
      last_evaluated_at: domainCheck.syncedAt || isoOrNull(storeProfile?.synced_at) || evaluatedAtIso,
      reason: 'Synchronized storefront domain and catalog readiness records evaluated with no open issues.',
    });
  } else {
    signals.push({
      id: 'storefront_readiness',
      label: 'Storefront readiness',
      category: SIGNAL_CATEGORIES.STOREFRONT_READINESS,
      state: EVALUATION_STATES.NOT_EVALUATED,
      finding_types: [],
      source: 'store_domains',
      last_evaluated_at: null,
      reason: 'Store domain and profile records have not yet been synchronized.',
    });
  }

  // 2. Traffic & acquisition
  const analyticsCheck = domainFreshness(byDomain.get('analytics.reports'), now);
  const trafficFindings = [TYPES.NO_RECORDED_TRAFFIC].filter(t => findingTypes.has(t));
  if (trafficFindings.length > 0) {
    signals.push({
      id: 'traffic_acquisition',
      label: 'Traffic & acquisition',
      category: SIGNAL_CATEGORIES.TRAFFIC_ACQUISITION,
      state: EVALUATION_STATES.VERIFIED,
      finding_types: trafficFindings,
      source: 'analytics.reports',
      last_evaluated_at: analyticsCheck.syncedAt || evaluatedAtIso,
      reason: 'Verified analytics telemetry recorded zero storefront sessions during the evaluated period.',
    });
  } else if (analyticsCheck.state === EVALUATION_STATES.EVALUATION_FAILED) {
    signals.push({
      id: 'traffic_acquisition',
      label: 'Traffic & acquisition',
      category: SIGNAL_CATEGORIES.TRAFFIC_ACQUISITION,
      state: EVALUATION_STATES.EVALUATION_FAILED,
      finding_types: [],
      source: 'analytics.reports',
      last_evaluated_at: analyticsCheck.syncedAt,
      reason: `Shopify Analytics retrieval failed (${analyticsCheck.errorCode || 'sync error'}); missing analytics access is never treated as zero traffic.`,
    });
  } else if (analyticsCheck.state === EVALUATION_STATES.STALE) {
    signals.push({
      id: 'traffic_acquisition',
      label: 'Traffic & acquisition',
      category: SIGNAL_CATEGORIES.TRAFFIC_ACQUISITION,
      state: EVALUATION_STATES.STALE,
      finding_types: [],
      source: 'analytics.reports',
      last_evaluated_at: analyticsCheck.syncedAt,
      reason: 'Storefront analytics evidence is older than 48 hours.',
    });
  } else if (analyticsCheck.state === 'fresh') {
    signals.push({
      id: 'traffic_acquisition',
      label: 'Traffic & acquisition',
      category: SIGNAL_CATEGORIES.TRAFFIC_ACQUISITION,
      state: EVALUATION_STATES.NOT_DETECTED,
      finding_types: [],
      source: 'analytics.reports',
      last_evaluated_at: analyticsCheck.syncedAt,
      reason: 'Verified storefront analytics evaluated with active session activity recorded.',
    });
  } else {
    signals.push({
      id: 'traffic_acquisition',
      label: 'Traffic & acquisition',
      category: SIGNAL_CATEGORIES.TRAFFIC_ACQUISITION,
      state: EVALUATION_STATES.NOT_EVALUATED,
      finding_types: [],
      source: 'analytics.reports',
      last_evaluated_at: null,
      reason: 'Shopify Analytics access or storefront session tracking is not available for this store plan or connection.',
    });
  }

  // 3. Sales & revenue
  const ordersCheck = domainFreshness(byDomain.get('orders'), now);
  const salesFindings = [TYPES.NO_RECENT_ORDERS, TYPES.REVENUE_CHANGE, TYPES.ORDER_VOLUME_CHANGE].filter(t => findingTypes.has(t));
  const hasCertifiedOrders = Boolean(coverage && coverage.source === TRUSTED_SOURCE && coverage.source_run_id);
  if (salesFindings.length > 0) {
    signals.push({
      id: 'sales_revenue',
      label: 'Sales & revenue',
      category: SIGNAL_CATEGORIES.SALES_REVENUE,
      state: EVALUATION_STATES.VERIFIED,
      finding_types: salesFindings,
      source: 'orders',
      last_evaluated_at: ordersCheck.syncedAt || evaluatedAtIso,
      reason: 'Verified order history surfaced an open sales or order volume signal.',
    });
  } else if (ordersCheck.state === EVALUATION_STATES.EVALUATION_FAILED) {
    signals.push({
      id: 'sales_revenue',
      label: 'Sales & revenue',
      category: SIGNAL_CATEGORIES.SALES_REVENUE,
      state: EVALUATION_STATES.EVALUATION_FAILED,
      finding_types: [],
      source: 'orders',
      last_evaluated_at: ordersCheck.syncedAt,
      reason: `Order synchronization failed (${ordersCheck.errorCode || 'sync error'}).`,
    });
  } else if (ordersCheck.state === EVALUATION_STATES.STALE) {
    signals.push({
      id: 'sales_revenue',
      label: 'Sales & revenue',
      category: SIGNAL_CATEGORIES.SALES_REVENUE,
      state: EVALUATION_STATES.STALE,
      finding_types: [],
      source: 'orders',
      last_evaluated_at: ordersCheck.syncedAt,
      reason: 'Order synchronization data is older than 48 hours.',
    });
  } else if (ordersCheck.state === 'fresh' && (hasCertifiedOrders || !coverage)) {
    signals.push({
      id: 'sales_revenue',
      label: 'Sales & revenue',
      category: SIGNAL_CATEGORIES.SALES_REVENUE,
      state: EVALUATION_STATES.NOT_DETECTED,
      finding_types: [],
      source: 'orders',
      last_evaluated_at: ordersCheck.syncedAt,
      reason: 'Certified order history evaluated with no threshold-crossing sales anomalies.',
    });
  } else {
    signals.push({
      id: 'sales_revenue',
      label: 'Sales & revenue',
      category: SIGNAL_CATEGORIES.SALES_REVENUE,
      state: EVALUATION_STATES.NOT_EVALUATED,
      finding_types: [],
      source: 'orders',
      last_evaluated_at: ordersCheck.syncedAt,
      reason: 'Certified historical order coverage is not yet complete for the evaluation window.',
    });
  }

  // 4. Conversion & purchasing
  const checkoutCheck = domainFreshness(byDomain.get('abandoned_checkouts'), now);
  const conversionFindings = [TYPES.TRAFFIC_WITHOUT_ORDERS, TYPES.ABANDONED_CHECKOUTS_OPEN].filter(t => findingTypes.has(t));
  if (conversionFindings.length > 0) {
    signals.push({
      id: 'conversion_purchasing',
      label: 'Conversion & purchasing',
      category: SIGNAL_CATEGORIES.CONVERSION_PURCHASING,
      state: EVALUATION_STATES.VERIFIED,
      finding_types: conversionFindings,
      source: 'abandoned_carts, orders',
      last_evaluated_at: checkoutCheck.syncedAt || ordersCheck.syncedAt || evaluatedAtIso,
      reason: 'Verified checkout or purchasing funnel signal detected.',
    });
  } else if (checkoutCheck.state === EVALUATION_STATES.EVALUATION_FAILED) {
    signals.push({
      id: 'conversion_purchasing',
      label: 'Conversion & purchasing',
      category: SIGNAL_CATEGORIES.CONVERSION_PURCHASING,
      state: EVALUATION_STATES.EVALUATION_FAILED,
      finding_types: [],
      source: 'abandoned_checkouts',
      last_evaluated_at: checkoutCheck.syncedAt,
      reason: `Abandoned checkout sync failed (${checkoutCheck.errorCode || 'sync error'}).`,
    });
  } else if (checkoutCheck.state === EVALUATION_STATES.STALE) {
    signals.push({
      id: 'conversion_purchasing',
      label: 'Conversion & purchasing',
      category: SIGNAL_CATEGORIES.CONVERSION_PURCHASING,
      state: EVALUATION_STATES.STALE,
      finding_types: [],
      source: 'abandoned_checkouts',
      last_evaluated_at: checkoutCheck.syncedAt,
      reason: 'Abandoned checkout records are older than 48 hours.',
    });
  } else if (checkoutCheck.state === 'fresh') {
    signals.push({
      id: 'conversion_purchasing',
      label: 'Conversion & purchasing',
      category: SIGNAL_CATEGORIES.CONVERSION_PURCHASING,
      state: EVALUATION_STATES.NOT_DETECTED,
      finding_types: [],
      source: 'abandoned_checkouts',
      last_evaluated_at: checkoutCheck.syncedAt,
      reason: 'Synchronized checkout records evaluated with no open abandonment signals.',
    });
  } else {
    signals.push({
      id: 'conversion_purchasing',
      label: 'Conversion & purchasing',
      category: SIGNAL_CATEGORIES.CONVERSION_PURCHASING,
      state: EVALUATION_STATES.NOT_EVALUATED,
      finding_types: [],
      source: 'abandoned_checkouts',
      last_evaluated_at: null,
      reason: 'Checkout abandonment records have not yet been synchronized.',
    });
  }

  // 5. Product & inventory
  const inventoryCheck = domainFreshness(byDomain.get('inventory'), now);
  const productsCheck = domainFreshness(byDomain.get('products'), now);
  const inventoryFindings = [TYPES.INVENTORY_STOCKOUTS, TYPES.PRODUCTS_UNPUBLISHED_OR_UNAVAILABLE].filter(t => findingTypes.has(t));
  if (inventoryFindings.length > 0) {
    signals.push({
      id: 'product_inventory',
      label: 'Product & inventory',
      category: SIGNAL_CATEGORIES.PRODUCT_INVENTORY,
      state: EVALUATION_STATES.VERIFIED,
      finding_types: inventoryFindings,
      source: 'products, inventory_levels',
      last_evaluated_at: inventoryCheck.syncedAt || productsCheck.syncedAt || evaluatedAtIso,
      reason: 'Verified inventory stockout or catalog availability issue detected.',
    });
  } else if (inventoryCheck.state === EVALUATION_STATES.EVALUATION_FAILED || productsCheck.state === EVALUATION_STATES.EVALUATION_FAILED) {
    signals.push({
      id: 'product_inventory',
      label: 'Product & inventory',
      category: SIGNAL_CATEGORIES.PRODUCT_INVENTORY,
      state: EVALUATION_STATES.EVALUATION_FAILED,
      finding_types: [],
      source: 'products, inventory',
      last_evaluated_at: inventoryCheck.syncedAt || productsCheck.syncedAt,
      reason: 'Product or inventory synchronization failed.',
    });
  } else if (inventoryCheck.state === EVALUATION_STATES.STALE || productsCheck.state === EVALUATION_STATES.STALE) {
    signals.push({
      id: 'product_inventory',
      label: 'Product & inventory',
      category: SIGNAL_CATEGORIES.PRODUCT_INVENTORY,
      state: EVALUATION_STATES.STALE,
      finding_types: [],
      source: 'products, inventory',
      last_evaluated_at: inventoryCheck.syncedAt || productsCheck.syncedAt,
      reason: 'Product or inventory snapshots are older than 48 hours.',
    });
  } else if (inventoryCheck.state === 'fresh' || productsCheck.state === 'fresh') {
    signals.push({
      id: 'product_inventory',
      label: 'Product & inventory',
      category: SIGNAL_CATEGORIES.PRODUCT_INVENTORY,
      state: EVALUATION_STATES.NOT_DETECTED,
      finding_types: [],
      source: 'products, inventory_levels',
      last_evaluated_at: inventoryCheck.syncedAt || productsCheck.syncedAt,
      reason: 'Product catalog and inventory levels evaluated with no zero-stock alerts.',
    });
  } else {
    signals.push({
      id: 'product_inventory',
      label: 'Product & inventory',
      category: SIGNAL_CATEGORIES.PRODUCT_INVENTORY,
      state: EVALUATION_STATES.NOT_EVALUATED,
      finding_types: [],
      source: 'products, inventory',
      last_evaluated_at: null,
      reason: 'Product and inventory snapshots are not yet synchronized or authorized.',
    });
  }

  // 6. Customer & fulfillment
  const fulfillCheck = domainFreshness(byDomain.get('fulfillments'), now);
  const refundCheck = domainFreshness(byDomain.get('refunds'), now);
  const fulfillmentFindings = [
    TYPES.UNFULFILLED_ORDERS_BACKLOG,
    TYPES.REFUND_INCREASE,
    TYPES.RETURNING_CUSTOMER_CHANGE,
  ].filter(t => findingTypes.has(t));
  if (fulfillmentFindings.length > 0) {
    signals.push({
      id: 'customer_fulfillment',
      label: 'Customer & fulfillment',
      category: SIGNAL_CATEGORIES.CUSTOMER_FULFILLMENT,
      state: EVALUATION_STATES.VERIFIED,
      finding_types: fulfillmentFindings,
      source: 'orders, order_fulfillments, order_refunds',
      last_evaluated_at: fulfillCheck.syncedAt || refundCheck.syncedAt || evaluatedAtIso,
      reason: 'Verified fulfillment, refund, or customer purchasing signal detected.',
    });
  } else if (fulfillCheck.state === EVALUATION_STATES.EVALUATION_FAILED || refundCheck.state === EVALUATION_STATES.EVALUATION_FAILED) {
    signals.push({
      id: 'customer_fulfillment',
      label: 'Customer & fulfillment',
      category: SIGNAL_CATEGORIES.CUSTOMER_FULFILLMENT,
      state: EVALUATION_STATES.EVALUATION_FAILED,
      finding_types: [],
      source: 'fulfillments, refunds',
      last_evaluated_at: fulfillCheck.syncedAt || refundCheck.syncedAt,
      reason: 'Fulfillment or refund synchronization failed.',
    });
  } else if (fulfillCheck.state === EVALUATION_STATES.STALE || refundCheck.state === EVALUATION_STATES.STALE) {
    signals.push({
      id: 'customer_fulfillment',
      label: 'Customer & fulfillment',
      category: SIGNAL_CATEGORIES.CUSTOMER_FULFILLMENT,
      state: EVALUATION_STATES.STALE,
      finding_types: [],
      source: 'fulfillments, refunds',
      last_evaluated_at: fulfillCheck.syncedAt || refundCheck.syncedAt,
      reason: 'Fulfillment or refund records are older than 48 hours.',
    });
  } else if (fulfillCheck.state === 'fresh' || refundCheck.state === 'fresh') {
    signals.push({
      id: 'customer_fulfillment',
      label: 'Customer & fulfillment',
      category: SIGNAL_CATEGORIES.CUSTOMER_FULFILLMENT,
      state: EVALUATION_STATES.NOT_DETECTED,
      finding_types: [],
      source: 'fulfillments, refunds',
      last_evaluated_at: fulfillCheck.syncedAt || refundCheck.syncedAt,
      reason: 'Fulfillment and refund records evaluated with no backlog or spike detected.',
    });
  } else {
    signals.push({
      id: 'customer_fulfillment',
      label: 'Customer & fulfillment',
      category: SIGNAL_CATEGORIES.CUSTOMER_FULFILLMENT,
      state: EVALUATION_STATES.NOT_EVALUATED,
      finding_types: [],
      source: 'fulfillments, refunds',
      last_evaluated_at: null,
      reason: 'Fulfillment and refund domains are not yet synchronized.',
    });
  }

  return summarizeSignals(signals, { now, periodDays });
}

/**
 * Read-only candidate evaluation across all supported commerce signal
 * categories. Never fabricates zero traffic when analytics failed or is
 * unavailable, and never emits findings from stale or unverified records.
 */
async function evaluateOrganizationFindings(prisma, organizationId, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const periodDays = options.periodDays || 7;
  const analyticsByStore = options.analyticsByStore || {};
  const currentEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const currentStart = currentEnd - periodDays * DAY;
  const previousStart = currentStart - periodDays * DAY;
  const observedAtIso = now.toISOString();

  const stores = await prisma.stores.findMany({
    where: { organization_id: organizationId },
    select: { id: true, status: true, last_synced_at: true, platform: true, shop_domain: true },
  });

  const candidates = [];
  const diagnostics = [];
  let primarySignalEvaluation = null;

  for (const store of stores) {
    const scope = { organizationId, storeId: store.id };
    const storeCandidates = [];
    const registrationFailures = await prisma.webhook_registrations.count({
      where: { store_id: store.id, status: 'failed' },
    });
    const integration = detectIntegrationFailure({
      scope,
      store: {
        ...store,
        status: store.status === 'active' ? 'connected' : store.status,
        setup_status: registrationFailures > 0 ? 'failed' : null,
      },
      now,
      maxSyncAgeMinutes: Number.POSITIVE_INFINITY,
    });
    if (integration) {
      integration.evidence.failed_webhook_registrations = registrationFailures;
      storeCandidates.push(integration);
    }

    const domainRows = prisma.store_sync_domain_states && typeof prisma.store_sync_domain_states.findMany === 'function'
      ? await prisma.store_sync_domain_states.findMany({
          where: { store_id: store.id },
          select: { domain: true, status: true, capability_state: true, last_succeeded_at: true, error_code: true, pagination_complete: true },
        }).catch(() => [])
      : [];
    const domainByKey = new Map((domainRows || []).map(row => [row.domain, row]));

    if (!verifiedSync(store) || registrationFailures > 0) {
      diagnostics.push({ storeId: store.id, status: 'insufficient_sync_verification' });
      candidates.push(...storeCandidates);
      if (!primarySignalEvaluation) {
        primarySignalEvaluation = buildSignalEvaluationSummary({
          store,
          domainRows,
          activeFindings: storeCandidates,
          now,
          periodDays,
        });
      }
      continue;
    }

    // ------------------------------------------------------------------
    // A. Storefront readiness (primary domain + catalog publishing)
    // ------------------------------------------------------------------
    let storeProfile = null;
    if (prisma.store_profiles && typeof prisma.store_profiles.findFirst === 'function') {
      storeProfile = await prisma.store_profiles.findFirst({
        where: { store_id: store.id },
        select: { primary_domain_host: true, myshopify_domain: true, primary_domain_ssl: true, currency_code: true, synced_at: true },
      });
    }

    const domainSync = domainByKey.get('store_domains') ? domainFreshness(domainByKey.get('store_domains'), now) : null;
    const domainAllowed = !domainSync || domainSync.state === 'fresh';

    if (domainAllowed && storeProfile && typeof storeProfile.primary_domain_host === 'string') {
      const domains = prisma.store_domains && typeof prisma.store_domains.findMany === 'function'
        ? await prisma.store_domains.findMany({
            where: { store_id: store.id },
            select: { host: true, kind: true, ssl_enabled: true, synced_at: true },
          })
        : [];
      const customDomainCount = domains.filter(
        d => d && String(d.kind || '').toLowerCase() !== 'myshopify' && !/\.myshopify\.com$/i.test(String(d.host || '').trim())
      ).length;
      const totalDomainsCount = Math.max(domains.length, 1);
      if (/\.myshopify\.com$/i.test(storeProfile.primary_domain_host.trim()) && customDomainCount === 0) {
        storeCandidates.push(detectStorefrontDomainUnconfigured({
          scope,
          evidence: {
            verified: true,
            complete: true,
            source: 'store_profiles',
            storeId: store.id,
            primaryDomainHost: storeProfile.primary_domain_host.trim(),
            sslEnabled: storeProfile.primary_domain_ssl ?? null,
            customDomainCount: 0,
            totalDomainsCount,
            observed_at: observedAtIso,
          },
        }));
      }
    }

    let activeProductsCount = null;
    let totalProductsCount = null;
    const productsSync = domainByKey.get('products') ? domainFreshness(domainByKey.get('products'), now) : null;
    const productsAllowed = !productsSync || productsSync.state === 'fresh';
    if (productsAllowed && prisma.products && typeof prisma.products.count === 'function') {
      activeProductsCount = await prisma.products.count({
        where: { store_id: store.id, status: 'active' },
      });
      totalProductsCount = await prisma.products.count({
        where: { store_id: store.id },
      }).catch(() => activeProductsCount);
      const inactiveProductsCount = Math.max(0, (totalProductsCount ?? 0) - (activeProductsCount ?? 0));
      if (totalProductsCount > 0 && (activeProductsCount === 0 || (inactiveProductsCount >= 3 && inactiveProductsCount / totalProductsCount >= 0.5))) {
        storeCandidates.push(detectProductsUnpublishedOrUnavailable({
          scope,
          evidence: {
            verified: true,
            complete: true,
            source: 'products',
            storeId: store.id,
            totalProductsCount,
            activeProductsCount,
            inactiveProductsCount,
            observed_at: observedAtIso,
          },
        }));
      }
    }

    // ------------------------------------------------------------------
    // B. Traffic & acquisition (STRICT: never fabricate zero traffic!)
    // ------------------------------------------------------------------
    const analyticsSyncRow = domainByKey.get('analytics.reports');
    const analyticsCheck = analyticsSyncRow ? domainFreshness(analyticsSyncRow, now) : { state: EVALUATION_STATES.NOT_EVALUATED, syncedAt: null, errorCode: null };
    const providedAnalytics = analyticsByStore[store.id] || null;
    let verifiedSessions = null;
    let trafficEvaluated = false;
    let trafficSource = 'analytics.reports';

    if (providedAnalytics && providedAnalytics.status === 'ok' && Number.isInteger(providedAnalytics.sessions) && providedAnalytics.sessions >= 0) {
      trafficEvaluated = true;
      verifiedSessions = providedAnalytics.sessions;
      trafficSource = providedAnalytics.source || 'shopify_analytics';
    } else if (analyticsCheck.state === 'fresh' && prisma.events && typeof prisma.events.count === 'function') {
      trafficEvaluated = true;
      verifiedSessions = await prisma.events.count({
        where: { store_id: store.id, created_at: { gte: new Date(currentStart), lt: new Date(currentEnd) } },
      });
      trafficSource = 'analytics.reports';
    }

    const deferredTrafficDiagnostic = !trafficEvaluated
      ? (analyticsCheck.state === EVALUATION_STATES.EVALUATION_FAILED
        ? { storeId: store.id, status: 'traffic_analytics_evaluation_failed', error_code: analyticsCheck.errorCode }
        : analyticsCheck.state === EVALUATION_STATES.STALE
          ? { storeId: store.id, status: 'traffic_analytics_stale' }
          : (analyticsSyncRow ? { storeId: store.id, status: 'traffic_analytics_not_evaluated' } : null))
      : null;

    if (trafficEvaluated && verifiedSessions === 0) {
      storeCandidates.push(detectNoRecordedTraffic({
        scope,
        evidence: {
          verified: true,
          complete: true,
          analyticsAccessVerified: true,
          source: trafficSource,
          storeId: store.id,
          verifiedSessions: 0,
          windowDays: periodDays,
          currentStart: windowIso(currentStart),
          currentEnd: windowIso(currentEnd),
          observed_at: observedAtIso,
        },
      }));
    }

    // ------------------------------------------------------------------
    // D (part 1). Open abandoned checkouts (last 30 days)
    // ------------------------------------------------------------------
    let openAbandonedCount = 0;
    const checkoutSync = domainByKey.get('abandoned_checkouts') ? domainFreshness(domainByKey.get('abandoned_checkouts'), now) : null;
    const checkoutAllowed = !checkoutSync || checkoutSync.state === 'fresh';
    if (checkoutAllowed && prisma.abandoned_carts && typeof prisma.abandoned_carts.findMany === 'function') {
      const checkoutWindowDays = 30;
      const checkoutSince = new Date(now.getTime() - checkoutWindowDays * DAY);
      const recentCarts = await prisma.abandoned_carts.findMany({
        where: { store_id: store.id, abandoned_at: { gte: checkoutSince } },
        select: { status: true, cart_value: true, currency: true, abandoned_at: true },
      });
      const openCarts = recentCarts.filter(c => String(c.status || '').toLowerCase() === 'abandoned');
      const completedCarts = recentCarts.filter(c => String(c.status || '').toLowerCase() === 'recovered');
      openAbandonedCount = openCarts.length;
      const openCurrencies = sameCurrency(openCarts.filter(c => c.currency));
      const cartCurrency = openCurrencies.length === 1
        ? openCurrencies[0]
        : (openCurrencies.length === 0 && storeProfile?.currency_code ? storeProfile.currency_code : null);
      if (openCarts.length > 0 && cartCurrency) {
        const openValue = openCarts.reduce((sum, c) => sum + (Number.isFinite(safeNumber(c.cart_value)) ? Math.max(0, safeNumber(c.cart_value)) : 0), 0);
        storeCandidates.push(detectOpenAbandonedCheckouts({
          scope,
          evidence: {
            verified: true,
            complete: true,
            source: 'abandoned_carts',
            storeId: store.id,
            openAbandonedCount: openCarts.length,
            openAbandonedValue: Number(openValue.toFixed(2)),
            completedAfterCheckoutCount: completedCarts.length,
            currency: cartCurrency,
            windowDays: checkoutWindowDays,
            observed_at: observedAtIso,
          },
        }));
      }
    }

    // ------------------------------------------------------------------
    // E. Zero-stock inventory levels (current synchronized snapshot)
    // ------------------------------------------------------------------
    const inventorySync = domainByKey.get('inventory') ? domainFreshness(domainByKey.get('inventory'), now) : null;
    const inventoryAllowed = !inventorySync || inventorySync.state === 'fresh';
    if (inventoryAllowed && prisma.inventory_levels && typeof prisma.inventory_levels.findMany === 'function') {
      const levels = await prisma.inventory_levels.findMany({
        where: { store_id: store.id },
        select: { quantities: true, synced_at: true },
      });
      if (levels.length > 0) {
        let zeroStockCount = 0;
        let inStockCount = 0;
        for (const row of levels) {
          const q = row?.quantities && typeof row.quantities === 'object' ? row.quantities : {};
          const avail = Number(q.available);
          if (Number.isFinite(avail) && avail <= 0) zeroStockCount += 1;
          else if (Number.isFinite(avail) && avail > 0) inStockCount += 1;
        }
        if (zeroStockCount > 0) {
          storeCandidates.push(detectInventoryStockouts({
            scope,
            evidence: {
              verified: true,
              complete: true,
              source: 'inventory_levels',
              storeId: store.id,
              zeroStockCount,
              totalLevelsCount: levels.length,
              inStockCount,
              inventory_history_available: false,
              observed_at: observedAtIso,
            },
          }));
        }
      }
    }

    // ------------------------------------------------------------------
    // C & F. Certified order history, sales, conversion, fulfillment & refunds
    // ------------------------------------------------------------------
    const coverage = await prisma.intelligence_order_coverage.findFirst({
      where: {
        store_id: store.id,
        organization_id: organizationId,
        coverage_start: { lte: new Date(previousStart) },
        coverage_end: { gte: new Date(currentEnd) },
      },
      select: { source: true, source_run_id: true, certified_at: true, customer_lifetime_verified: true },
    });

    if (!coverage || coverage.source !== TRUSTED_SOURCE || !coverage.source_run_id) {
      diagnostics.push({ storeId: store.id, status: 'order_history_completeness_unverified' });
      if (deferredTrafficDiagnostic) diagnostics.push(deferredTrafficDiagnostic);
      candidates.push(...storeCandidates);
      if (!primarySignalEvaluation) {
        primarySignalEvaluation = buildSignalEvaluationSummary({
          store,
          domainRows,
          storeProfile,
          coverage: null,
          activeFindings: storeCandidates,
          now,
          periodDays,
        });
      }
      continue;
    }

    diagnostics.push({
      storeId: store.id,
      status: 'checkout_funnel_coverage_unverified',
      available_source: 'abandoned_carts',
      missing_evidence: ['complete_checkout_starts', 'consistent_checkout_completions', 'checkout_event_coverage'],
    });
    if (deferredTrafficDiagnostic) diagnostics.push(deferredTrafficDiagnostic);

    if (prisma.order_transactions && prisma.store_sync_domain_states && typeof prisma.store_sync_domain_states.findFirst === 'function') {
      const refundSync = await prisma.store_sync_domain_states.findFirst({
        where: {
          store_id: store.id,
          domain: 'refunds',
          status: 'ok',
          pagination_complete: true,
          last_succeeded_at: { gte: new Date(currentEnd) },
        },
        select: { id: true, last_succeeded_at: true },
      });
      if (refundSync) {
        const transactions = await prisma.order_transactions.findMany({
          where: {
            store_id: store.id,
            kind: 'refund',
            status: { in: ['success', 'succeeded'] },
            processed_at: { gte: new Date(previousStart), lt: new Date(currentEnd) },
          },
          select: { external_id: true, external_order_id: true, amount: true, currency: true, processed_at: true },
        });
        const refundCurrencies = sameCurrency(transactions);
        if (transactions.length && refundCurrencies.length === 1) {
          const currentRefunds = transactions.filter(row => row.processed_at.getTime() >= currentStart);
          const previousRefunds = transactions.filter(row => row.processed_at.getTime() < currentStart);
          const refundValue = rows => rows.reduce((sum, row) => sum + Math.abs(safeNumber(row.amount)), 0);
          storeCandidates.push(detectRefundIncrease({
            scope,
            evidence: {
              verified: true,
              complete: true,
              source: 'order_transactions',
              refund_coverage_complete: true,
              refund_sync_run_id: refundSync.id,
              coverage_source: coverage.source,
              coverage_run_id: coverage.source_run_id,
              currency: refundCurrencies[0],
              currentStart: windowIso(currentStart),
              currentEnd: windowIso(currentEnd),
              previousStart: windowIso(previousStart),
              previousEnd: windowIso(currentStart),
              currentCount: currentRefunds.length,
              previousCount: previousRefunds.length,
              currentRefundTotal: refundValue(currentRefunds),
              previousRefundTotal: refundValue(previousRefunds),
            },
          }));
        } else if (transactions.length) diagnostics.push({ storeId: store.id, status: 'refund_currency_not_comparable' });
      } else diagnostics.push({ storeId: store.id, status: 'refund_history_completeness_unverified' });
    }

    const orders = await prisma.orders.findMany({
      where: { store_id: store.id, ordered_at: { gte: new Date(previousStart), lt: new Date(currentEnd) } },
      select: { customer_id: true, total: true, currency: true, ordered_at: true, recovery_status: true, refunded_total: true, display_fulfillment_status: true },
    });

    const netValue = (o) => safeNumber(o.total) - safeNumber(o.refunded_total || 0);
    const liveOrders = orders.filter(o => !EXCLUDED_RECOVERY_STATUSES.has(String(o.recovery_status || '').toLowerCase()));
    const current = liveOrders.filter(o => o.ordered_at.getTime() >= currentStart);
    const previous = liveOrders.filter(o => o.ordered_at.getTime() < currentStart);

    // Fulfillment backlog check (non-cancelled live orders older than 48h still unfulfilled)
    const fulfillSync = domainByKey.get('fulfillments') ? domainFreshness(domainByKey.get('fulfillments'), now) : null;
    if (fulfillSync && fulfillSync.state === 'fresh') {
      const backlogCutoff = now.getTime() - UNFULFILLED_AGE_HOURS * 3600_000;
      const agedUnfulfilled = liveOrders.filter(
        o => UNFULFILLED_STATUSES.has(String(o.display_fulfillment_status || '').toUpperCase()) &&
          o.ordered_at.getTime() <= backlogCutoff
      );
      if (agedUnfulfilled.length > 0) {
        storeCandidates.push(detectUnfulfilledOrdersBacklog({
          scope,
          evidence: {
            verified: true,
            complete: true,
            source: 'orders',
            storeId: store.id,
            unfulfilledOrdersCount: agedUnfulfilled.length,
            ageThresholdHours: UNFULFILLED_AGE_HOURS,
            observed_at: observedAtIso,
          },
        }));
      }
    }

    // D (part 2). Traffic recorded alongside 0 completed orders (Scenario 5)
    if (current.length === 0 && trafficEvaluated && verifiedSessions > 0) {
      storeCandidates.push(detectTrafficWithoutOrders({
        scope,
        evidence: {
          verified: true,
          complete: true,
          analyticsAccessVerified: true,
          source: trafficSource,
          storeId: store.id,
          verifiedSessions,
          currentOrdersCount: 0,
          openAbandonedCount,
          coverage_source: coverage.source,
          coverage_run_id: coverage.source_run_id,
          windowDays: periodDays,
          currentStart: windowIso(currentStart),
          currentEnd: windowIso(currentEnd),
          observed_at: observedAtIso,
        },
      }));
    }

    // C. Certified zero-order window detection (Scenario 4)
    if (current.length === 0 && (activeProductsCount === null || activeProductsCount > 0 || storeProfile)) {
      let lastOrderAt = null;
      if (typeof prisma.orders.findFirst === 'function') {
        const latest = await prisma.orders.findFirst({
          where: { store_id: store.id, NOT: { recovery_status: { in: ['cancelled', 'canceled', 'voided', 'deleted'] } } },
          orderBy: { ordered_at: 'desc' },
          select: { ordered_at: true },
        }).catch(() => null);
        if (latest?.ordered_at) lastOrderAt = new Date(latest.ordered_at).toISOString();
      }
      const orderCurrency = (liveOrders[0]?.currency || storeProfile?.currency_code || 'USD').toUpperCase();
      // Emit no_recent_orders when either active catalog exists OR storeProfile/explicit zero-order check applies
      if (activeProductsCount !== null || storeProfile !== null || trafficEvaluated) {
        storeCandidates.push(detectNoRecentOrders({
          scope,
          evidence: {
            verified: true,
            complete: true,
            currency: orderCurrency,
            coverage_source: coverage.source,
            coverage_run_id: coverage.source_run_id,
            currentStart: windowIso(currentStart),
            currentEnd: windowIso(currentEnd),
            previousStart: windowIso(previousStart),
            previousEnd: windowIso(currentStart),
            currentCount: 0,
            previousCount: previous.length,
            activeProductsCount: activeProductsCount ?? 0,
            trafficEvaluated,
            verifiedSessions,
            lastOrderAt,
            periodDays,
            observed_at: observedAtIso,
          },
        }));
      }
    }

    const currencies = sameCurrency(liveOrders);
    if (currencies.length !== 1 || !liveOrders.length) {
      diagnostics.push({ storeId: store.id, status: 'mixed_currency_or_no_orders' });
      candidates.push(...storeCandidates);
      if (!primarySignalEvaluation) {
        primarySignalEvaluation = buildSignalEvaluationSummary({
          store,
          domainRows,
          storeProfile,
          coverage,
          activeFindings: storeCandidates.filter(Boolean),
          now,
          periodDays,
        });
      }
      continue;
    }

    const evidence = {
      verified: true,
      complete: true,
      currency: currencies[0],
      coverage_source: coverage.source,
      coverage_run_id: coverage.source_run_id,
      currentStart: windowIso(currentStart),
      currentEnd: windowIso(currentEnd),
      previousStart: windowIso(previousStart),
      previousEnd: windowIso(currentStart),
      currentCount: current.length,
      previousCount: previous.length,
      currentRevenue: current.reduce((sum, o) => sum + netValue(o), 0),
      previousRevenue: previous.reduce((sum, o) => sum + netValue(o), 0),
    };
    storeCandidates.push(detectRevenueChange({ scope, evidence }));
    storeCandidates.push(detectOrderVolumeChange({ scope, evidence }));

    if (!coverage.customer_lifetime_verified) {
      diagnostics.push({ storeId: store.id, status: 'customer_lifetime_history_unverified' });
      candidates.push(...storeCandidates);
      if (!primarySignalEvaluation) {
        primarySignalEvaluation = buildSignalEvaluationSummary({
          store,
          domainRows,
          storeProfile,
          coverage,
          activeFindings: storeCandidates.filter(Boolean),
          now,
          periodDays,
        });
      }
      continue;
    }

    const currentBuyers = [...new Set(current.map(o => o.customer_id))];
    const previousBuyers = [...new Set(previous.map(o => o.customer_id))];
    const allBuyers = [...new Set([...currentBuyers, ...previousBuyers])];
    const earliest = await prisma.orders.groupBy({
      by: ['customer_id'],
      where: { store_id: store.id, customer_id: { in: allBuyers }, ordered_at: { lt: new Date(currentEnd) } },
      _min: { ordered_at: true },
    });
    const firstPurchase = new Map(earliest.map(x => [x.customer_id, x._min.ordered_at?.getTime()]));
    const returning = (buyers, start) => buyers.filter(id => firstPurchase.get(id) < start).length;
    storeCandidates.push(detectReturningCustomerChange({
      scope,
      evidence: {
        ...evidence,
        currentCount: currentBuyers.length,
        previousCount: previousBuyers.length,
        currentReturning: returning(currentBuyers, currentStart),
        previousReturning: returning(previousBuyers, currentStart),
      },
    }));

    candidates.push(...storeCandidates);
    if (!primarySignalEvaluation) {
      primarySignalEvaluation = buildSignalEvaluationSummary({
        store,
        domainRows,
        storeProfile,
        coverage,
        activeFindings: storeCandidates.filter(Boolean),
        now,
        periodDays,
      });
    }
  }

  return {
    findings: prioritizeFindings(candidates),
    diagnostics,
    signal_evaluation: primarySignalEvaluation || buildSignalEvaluationSummary({ store: null, now, periodDays }),
    evaluated_at: now.toISOString(),
    period_days: periodDays,
  };
}

module.exports = {
  evaluateOrganizationFindings,
  buildSignalEvaluationSummary,
};
