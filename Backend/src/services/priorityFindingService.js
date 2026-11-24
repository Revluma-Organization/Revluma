'use strict';

// Task 217 — Command Center projection of the canonical finding-priority-v1
// and rev-recommendation-v1 semantics. No score, model call, commerce write,
// or client-supplied evidence is involved. The persisted finding remains the
// source of truth; this module only validates, classifies and presents it.
const { certifiedFinding } = require('./revMerchantContext');

const CONTRACT_VERSION = 'command-center-priority-finding-v1';
const PRIORITY_METHOD_VERSION = 'finding-priority-v1';
const RECOMMENDATION_CONTRACT_VERSION = 'rev-recommendation-v1';
const SEVERITY = { critical: 0, high: 1, medium: 2, low: 3 };
const CURRENT_LIFECYCLE = new Set(['open', 'acknowledged']);
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const finite = value => value !== null && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null;
const iso = value => {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
const timestamp = value => {
  const text = iso(value);
  return text ? Date.parse(text) : null;
};
const text = (value, max = 1000) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

function findingPeriod(evidence) {
  const start = iso(evidence.previousStart || evidence.observed_at);
  const end = iso(evidence.currentEnd || evidence.observed_at);
  if (!start || !end) return { kind: 'unavailable', timezone: 'UTC', start: null, end: null,
    current_start: iso(evidence.currentStart), current_end: iso(evidence.currentEnd),
    comparison_start: iso(evidence.previousStart), comparison_end: iso(evidence.previousEnd) };
  return { kind: evidence.currentStart ? 'equal_length_utc_windows' : 'point_observation', timezone: 'UTC',
    start, end, current_start: iso(evidence.currentStart), current_end: end,
    comparison_start: iso(evidence.previousStart), comparison_end: iso(evidence.previousEnd) };
}

function freshnessFor(finding, now, resource) {
  const evidence = object(finding.evidence);
  const verifiedAt = timestamp(finding.updated_at) || timestamp(finding.detected_at);
  const observedAt = timestamp(evidence.observed_at) || timestamp(evidence.currentEnd) || verifiedAt;
  const ageSeconds = verifiedAt === null ? null : Math.max(0, (now.getTime() - verifiedAt) / 1000);
  const failed = resource && ['retrieval_failed', 'unauthorized', 'not_synchronized', 'unsupported'].includes(resource.availability);
  const stale = failed || resource?.freshness === 'stale' || observedAt === null ||
    now.getTime() - observedAt > 48 * 3600_000;
  return {
    state: stale ? 'stale' : ageSeconds === null ? 'unknown' : ageSeconds <= 3600 ? 'fresh' : ageSeconds <= 86400 ? 'aging' : 'stale',
    as_of: iso(verifiedAt), observed_at: iso(observedAt), age_seconds: ageSeconds,
    policy: 'finding-reverification-48h',
    supports_current_claim: !stale && ageSeconds !== null && ageSeconds <= 86400,
    reason: failed ? 'The latest source retrieval or authorization does not support a current claim.' :
      stale ? 'The finding evidence is outside the current re-verification policy.' : null,
  };
}

const STORE_SIGNAL_TYPES = new Set([
  'storefront_domain_unconfigured',
  'products_unpublished_or_unavailable',
  'no_recorded_traffic',
  'traffic_without_orders',
  'abandoned_checkouts_open',
  'inventory_stockouts',
  'unfulfilled_orders_backlog',
  'no_storefront_events',
]);

const SIGNAL_CATEGORY_FOR_TYPE = {
  storefront_domain_unconfigured: 'storefront_readiness',
  products_unpublished_or_unavailable: 'storefront_readiness',
  no_recorded_traffic: 'traffic_acquisition',
  no_storefront_events: 'traffic_acquisition',
  no_recent_orders: 'sales_revenue',
  revenue_change: 'sales_revenue',
  order_volume_change: 'sales_revenue',
  traffic_without_orders: 'conversion_purchasing',
  abandoned_checkouts_open: 'conversion_purchasing',
  inventory_stockouts: 'product_inventory',
  unfulfilled_orders_backlog: 'customer_fulfillment',
  refund_increase: 'customer_fulfillment',
  returning_customer_change: 'customer_fulfillment',
  integration_failure: 'storefront_readiness',
};

// Higher operational urgency / commercial impact tier ranks first within equal severity.
const IMPACT_URGENCY_RANK = {
  integration_failure: 0,
  traffic_without_orders: 1,
  no_recent_orders: 2,
  revenue_change: 3,
  order_volume_change: 4,
  no_recorded_traffic: 5,
  products_unpublished_or_unavailable: 6,
  abandoned_checkouts_open: 7,
  refund_increase: 8,
  unfulfilled_orders_backlog: 9,
  inventory_stockouts: 10,
  storefront_domain_unconfigured: 11,
  returning_customer_change: 12,
  no_storefront_events: 13,
};

function resourceIdForFindingType(type) {
  if (type === 'refund_increase') return 'order.refunds';
  if (type === 'storefront_domain_unconfigured') return 'shop.identity';
  if (type === 'products_unpublished_or_unavailable') return 'products';
  if (type === 'abandoned_checkouts_open') return 'abandoned-checkouts';
  if (type === 'inventory_stockouts') return 'inventory.levels';
  if (type === 'unfulfilled_orders_backlog') return 'orders';
  if (type === 'no_recorded_traffic') return 'analytics.reports';
  if (type === 'traffic_without_orders') return 'orders';
  if (type === 'integration_failure' || type === 'no_storefront_events') return null;
  return 'orders';
}

function limitationsFor(finding, freshness, resource) {
  const evidence = object(finding.evidence);
  const limits = [];
  if (finding.type === 'storefront_domain_unconfigured') {
    limits.push('Domain configuration reflects synchronized Shopify settings and does not measure traffic or conversion impact.');
  } else if (finding.type === 'products_unpublished_or_unavailable') {
    limits.push('Catalog product statuses reflect synchronized Shopify admin records and do not measure storefront demand or channel publishing outside Shopify.');
  } else if (finding.type === 'no_recorded_traffic') {
    limits.push('Verified analytics returned zero sessions for this window, but does not identify whether marketing campaigns, SEO, or storefront routing caused the absence of visits.');
  } else if (finding.type === 'traffic_without_orders') {
    limits.push('Verified storefront sessions and zero completed orders do not by themselves establish whether checkout errors, pricing, shipping, or product fit prevented purchases.');
  } else if (finding.type === 'no_recent_orders') {
    limits.push(
      evidence.trafficEvaluated
        ? 'Zero completed orders over this window does not establish whether acquisition channels, pricing, or checkout friction caused the absence of sales.'
        : 'Traffic data was not verified for this window; zero completed orders does not distinguish zero storefront traffic from a conversion or checkout issue.'
    );
  } else if (finding.type === 'abandoned_checkouts_open') {
    limits.push('Abandoned checkout records do not establish total storefront visits, checkout conversion rate, or how much cart value would convert.');
  } else if (finding.type === 'inventory_stockouts') {
    limits.push('Current inventory snapshots do not establish historical stockout duration or missed demand.');
  } else if (finding.type === 'unfulfilled_orders_backlog') {
    limits.push('Fulfillment status reflects synchronized Shopify order states and does not include carrier-side delays not yet synced back to Shopify.');
  } else if (finding.type === 'no_storefront_events') {
    limits.push('Zero recorded storefront events can reflect either zero storefront visits or inactive storefront event instrumentation.');
  } else if (finding.type !== 'integration_failure') {
    limits.push('The observed change does not establish its underlying cause.');
  }
  if (finding.type === 'revenue_change') limits.push('Recorded net sales are not an estimate of recoverable revenue.');
  if (finding.type === 'refund_increase') limits.push('Refund adjustments do not establish the shopper or product reason for the refunds.');
  if (finding.type === 'returning_customer_change') limits.push('Purchase-share movement does not establish buyer intent or churn.');
  if (freshness.state === 'stale') limits.push('Historical evidence remains recorded, but current store conditions have not been re-verified.');
  if (resource && resource.availability !== 'available' && resource.reason) limits.push(resource.reason);
  if (evidence.inventory_history_available === false) limits.push('Inventory history is unavailable; no stockout history is asserted.');
  if (evidence.contradictory === true) limits.push('Contradictory source evidence is unresolved; the affected conclusion is not verified.');
  if (evidence.coverage_complete === false || evidence.complete === false) limits.push('Source coverage is incomplete for this comparison.');
  return [...new Set(limits.filter(Boolean))].slice(0, 10);
}

function assessFinding(finding, { now = new Date(), resource = null } = {}) {
  const evidence = object(finding?.evidence);
  const freshness = freshnessFor(finding || {}, now, resource);
  const lifecycle = text(finding?.status, 20) || 'unknown';
  const lifecycleCurrent = CURRENT_LIFECYCLE.has(lifecycle);
  const certified = certifiedFinding(finding);
  const contradictions = evidence.contradictory === true;
  const current = lifecycleCurrent && certified && freshness.supports_current_claim && !contradictions &&
    (!resource || resource.availability === 'available');
  const currentValidity = !lifecycleCurrent ? `historical_${lifecycle}` : !certified ? 'evidence_unverified' :
    contradictions ? 'contradictory_evidence' : !freshness.supports_current_claim || (resource && resource.availability !== 'available') ? 'stale_unreverified' : 'current_evidence_verified';
  let confidence = 'unable_to_determine';
  const confidenceReasons = [];
  if (!certified) {
    confidence = 'insufficient_evidence';
    confidenceReasons.push('The source evidence or comparable-period contract is not certified complete.');
  } else if (currentValidity === 'current_evidence_verified') {
    confidence = freshness.state === 'fresh' && (evidence.coverage_run_id || STORE_SIGNAL_TYPES.has(finding.type)) ? 'high' : 'moderate';
    confidenceReasons.push(
      STORE_SIGNAL_TYPES.has(finding.type)
        ? 'Verified directly from synchronized store records.'
        : 'Verified source evidence with certified comparison coverage.'
    );
    confidenceReasons.push(`Evidence freshness is ${freshness.state}.`);
    if (finding.type === 'integration_failure') confidenceReasons.push('Confidence applies to the recorded integration state, not to unavailable commerce performance.');
  } else {
    confidence = 'low';
    confidenceReasons.push(`Current validity is ${currentValidity.replaceAll('_', ' ')}.`);
  }
  if (contradictions) confidenceReasons.push('Cross-source consistency is unresolved.');
  return { eligible: current, current_validity: currentValidity, lifecycle_state: lifecycle,
    freshness, confidence, confidence_rationale: confidenceReasons,
    coverage: { state: certified && !contradictions ? 'complete' : evidence.complete === false ? 'incomplete' : 'unknown',
      complete: certified && !contradictions, source: text(evidence.coverage_source, 100), run_id: text(evidence.coverage_run_id, 160) },
    limitations: limitationsFor(finding || {}, freshness, resource) };
}

function priorityRank(finding, assessment) {
  const evidence = object(finding.evidence);
  const hasMeasuredSample = evidence.currentCount !== null && evidence.currentCount !== undefined;
  const confidenceRank = { high: 0, moderate: 1, low: 2, insufficient_evidence: 3, unable_to_determine: 4 }[assessment.confidence] ?? 4;
  return [
    SEVERITY[finding.severity] ?? 4,
    { fresh: 0, aging: 1, stale: 2, unknown: 3 }[assessment.freshness.state] ?? 3,
    hasMeasuredSample ? 0 : 1,
    confidenceRank,
    IMPACT_URGENCY_RANK[finding.type] ?? 20,
    -(timestamp(finding.updated_at) || timestamp(finding.detected_at) || 0),
    String(finding.id),
  ];
}

function dedupeFindings(findings) {
  const groups = new Map();
  for (const finding of findings) {
    const key = finding.dedupe_key ? `${finding.store_id}:${finding.dedupe_key}` : `id:${finding.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(finding);
  }
  return [...groups.values()].map(group => {
    const sorted = [...group].sort((a, b) => (timestamp(b.updated_at) || 0) - (timestamp(a.updated_at) || 0) || String(a.id).localeCompare(String(b.id)));
    return { finding: sorted[0], duplicates: sorted.slice(1).map(item => item.id) };
  });
}

function prioritizedFindings(findings, { now = new Date(), resourcesByStore = new Map() } = {}) {
  const excluded = [];
  let candidates = [];
  for (const finding of findings.filter(Boolean)) {
    const entry = { finding, duplicates: [] };
    const state = resourcesByStore instanceof Map ? resourcesByStore.get(entry.finding.store_id) : resourcesByStore?.[entry.finding.store_id];
    const capabilities = state?.capabilities || [];
    const resourceId = resourceIdForFindingType(entry.finding.type);
    const capability = resourceId ? capabilities.find(item => item.id === resourceId) : null;
    const resource = capability ? { availability: capability.operational ? capability.sync_state === 'failed' ? 'retrieval_failed' : capability.authorization === 'missing_scope' ? 'unauthorized' : capability.freshness === 'stale' ? 'stale' : 'available' : 'unauthorized', freshness: capability.freshness, reason: capability.limited_reasons?.[0] || null } : null;
    const assessment = assessFinding(entry.finding, { now, resource });
    if (!assessment.eligible) {
      excluded.push({ finding_id: entry.finding.id, title: entry.finding.title, reason: assessment.current_validity, duplicates: entry.duplicates });
      continue;
    }
    candidates.push({ finding: entry.finding, assessment, duplicates: entry.duplicates });
  }
  // Deduplicate only after validity assessment. A malformed or stale duplicate
  // must never displace the current verified representative of the same issue.
  candidates = dedupeFindings(candidates.map(candidate => candidate.finding)).map(group => {
    const selected = candidates.find(candidate => candidate.finding.id === group.finding.id);
    return { ...selected, duplicates: group.duplicates };
  });
  candidates.sort((a, b) => {
    const left = priorityRank(a.finding, a.assessment), right = priorityRank(b.finding, b.assessment);
    for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
    return 0;
  });
  const tie = candidates.length > 1 && priorityRank(candidates[0].finding, candidates[0].assessment).slice(0, 3)
    .join('|') === priorityRank(candidates[1].finding, candidates[1].assessment).slice(0, 3).join('|') ? {
    finding_ids: [candidates[0].finding.id, candidates[1].finding.id],
    statement: 'The leading findings have equal severity, freshness and measured-sample status. Stable finding ID order is used only for display; it does not imply greater impact.',
  } : null;
  return { candidates, excluded, tie };
}

const RECOMMENDATIONS = {
  integration_failure: ['Review Shopify authorization and the latest synchronization status for this store. Resolve the recorded connection or sync failure before relying on current-period conclusions.',
    'The recorded integration problem prevents verification of newer commerce evidence.', 'Confirm a successful synchronization and then re-check this finding against refreshed evidence.'],
  revenue_change: ["Compare order count and average order value for this finding's two equal-length periods, then review products with the largest verified completed-order change.",
    'The verified revenue movement identifies where to investigate, but does not establish its cause or recoverable revenue.', 'Repeat the same currency-separated comparison over a subsequent equal-length period and check whether the recorded difference persists.'],
  order_volume_change: ['Review product-level completed-order counts for the two recorded periods and compare current availability for products with the largest verified change.',
    'Order-volume movement narrows the affected products; current stock does not prove historical availability or causation.', 'Compare completed-order counts over the next equivalent period and document any independently verified operational change.'],
  returning_customer_change: ['Compare verified returning-buyer counts and prior-purchase coverage for both periods before reviewing repeat-purchase cadence.',
    'The purchasing-customer share changed, but the evidence does not explain buyer intent or churn.', 'Recalculate the same returning-buyer share after an equivalent period with certified customer-order history.'],
  refund_increase: ["Review the refund transactions in this finding's current period in Shopify Admin. Compare their affected orders, products and recorded refund reasons with the previous period to see whether the increase is concentrated in a particular product or issue.",
    'The refund increase identifies recorded adjustment activity, not its cause or a recoverable revenue amount.', 'Compare refund value using the same transaction-date attribution and currency in the next equivalent period.'],
  no_recent_orders: ['Verify storefront availability, run a live test checkout on an active product, and inspect acquisition channels in Shopify Admin to confirm shoppers can reach and purchase products.',
    'Certified order history shows zero completed sales across this window, signaling an urgent acquisition or checkout readiness check.', 'Track verified completed-order counts across the next equivalent period.'],
  storefront_domain_unconfigured: ['Connect a branded custom domain in Shopify Admin (Settings -> Domains), set it as the primary domain, and confirm SSL certificate provisioning.',
    'Using a default .myshopify.com primary domain signals an incomplete public storefront launch configuration.', 'Confirm that a custom primary domain appears in synchronized store domain records after the next sync.'],
  products_unpublished_or_unavailable: ['Review draft and archived products in Shopify Admin (Products) and publish ready listings to the Online Store sales channel.',
    'Unpublished or inactive catalog products cannot be discovered or purchased by storefront visitors.', 'Confirm active product counts increase in synchronized catalog records after publishing updates.'],
  no_recorded_traffic: ['Verify that the storefront is live and unblocked (no password gate), check acquisition campaigns, and inspect referrer channels in Shopify Analytics.',
    'Verified analytics recorded zero storefront sessions during the evaluated period, limiting any chance of organic or paid conversion.', 'Confirm verified session counts rise above zero over the next equivalent evaluation window.'],
  traffic_without_orders: ['Walk through the product page, cart, shipping calculation, and payment checkout flow in Shopify to verify shoppers can complete purchases without friction or blockers.',
    'Verified sessions reached the storefront while zero orders completed, warranting direct inspection of product presentation and checkout flow without assuming a technical fault.', 'Compare completed orders alongside verified sessions over the next equivalent window.'],
  abandoned_checkouts_open: ['Inspect recent open abandoned checkouts in Shopify Admin for shipping rate surprises, payment method gaps, or checkout friction, and verify whether automated checkout reminder emails are active.',
    'Open abandoned checkouts highlight active shopper intent that did not complete checkout, without assuming conversion rate.', 'Compare open abandoned checkout counts alongside completed orders across the next equivalent window.'],
  inventory_stockouts: ['Audit zero-stock SKUs in Shopify Admin (Products -> Inventory) to confirm whether active listings need replenishment, incoming transfers, or archiving.',
    'Zero available units on tracked inventory levels can block purchases on active listings until stock is updated.', 'Confirm zero-stock inventory counts decrease after replenishment updates synchronize.'],
  unfulfilled_orders_backlog: ['Review aged unfulfilled orders in Shopify Admin (Orders -> Unfulfilled) to verify shipping labels, warehouse dispatch, or inventory holds.',
    'Orders unfulfilled past 48 hours increase shipping delay risk and customer support volume.', 'Confirm the aged unfulfilled order count clears after fulfillment records synchronize.'],
  no_storefront_events: ['Confirm the storefront is published and accessible to shoppers, check traffic sources in Shopify Analytics, and verify storefront event tracking is active on the live theme.',
    'Zero recorded visitor or session events means either no traffic is reaching the storefront or event instrumentation is inactive.', 'Verify incoming storefront session events appear in synchronized event records.'],
};
function recommendationForFinding(finding, assessment) {
  const template = RECOMMENDATIONS[finding.type];
  if (!template) return { available: false, step: null, rationale: null, expected_result: null, validation_method: null,
    prerequisites: ['A finding-specific recommendation is unavailable. Review the authoritative evidence before deciding what to do.'], read_only: true, executed: false };
  const current = assessment.eligible;
  return { contract_version: RECOMMENDATION_CONTRACT_VERSION, available: current,
    step: current ? template[0] : null, rationale: current ? template[1] : null,
    expected_result: current ? 'Identify whether the observed condition is concentrated in specific store settings, products, or channels and verify changes after the next sync.' : null,
    validation_method: current ? template[2] : null,
    prerequisites: current ? [] : ['Restore fresh, verified source evidence before treating this as a current recommendation.'],
    lifecycle_state: current ? 'presented' : 'invalidated', read_only: true, executed: false, execution_status: 'not_requested' };
}

function observationFor(finding) {
  const e = object(finding.evidence);
  const money = (value, label, period) => ({ label, value: finite(value), unit: 'money', currency: text(e.currency, 3), period, availability: finite(value) === null || !e.currency ? 'unknown' : 'available' });
  const count = (value, label, period) => ({ label, value: finite(value), unit: 'count', currency: null, period, availability: finite(value) === null ? 'unknown' : 'available' });
  const statusObs = (value, label, period = 'observation') => ({ label, value: text(value, 120), unit: 'status', currency: null, period, availability: text(value, 120) ? 'available' : 'unknown' });
  if (finding.type === 'revenue_change') return [money(e.currentRevenue, 'Current net sales', 'current'), money(e.previousRevenue, 'Previous net sales', 'comparison'), count(e.currentCount, 'Current completed orders', 'current'), count(e.previousCount, 'Previous completed orders', 'comparison')];
  if (finding.type === 'refund_increase') return [money(e.currentRefundTotal, 'Current refund value', 'current'), money(e.previousRefundTotal, 'Previous refund value', 'comparison'), count(e.currentCount, 'Current refund transactions', 'current'), count(e.previousCount, 'Previous refund transactions', 'comparison')];
  if (finding.type === 'order_volume_change') return [count(e.currentCount, 'Current completed orders', 'current'), count(e.previousCount, 'Previous completed orders', 'comparison')];
  if (finding.type === 'returning_customer_change') return [count(e.currentReturning, 'Current returning buyers', 'current'), count(e.previousReturning, 'Previous returning buyers', 'comparison'), count(e.currentCount, 'Current purchasing customers', 'current'), count(e.previousCount, 'Previous purchasing customers', 'comparison')];
  if (finding.type === 'integration_failure') return [statusObs(e.status, 'Recorded store status'), count(e.failed_webhook_registrations, 'Failed webhook registrations', 'observation')];
  if (finding.type === 'no_recent_orders') {
    const items = [
      count(e.currentCount, 'Current 7d completed orders', 'current'),
      count(e.previousCount, 'Previous 7d completed orders', 'comparison'),
    ];
    if (finite(e.activeProductsCount) !== null) items.push(count(e.activeProductsCount, 'Active catalog products', 'observation'));
    if (text(e.lastOrderAt, 40)) {
      const formatted = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(e.lastOrderAt));
      items.push(statusObs(formatted, 'Last recorded order', 'observation'));
    }
    return items;
  }
  if (finding.type === 'storefront_domain_unconfigured') {
    return [
      statusObs(e.primaryDomainHost, 'Primary domain'),
      count(e.customDomainCount, 'Custom domains connected', 'observation'),
    ];
  }
  if (finding.type === 'products_unpublished_or_unavailable') {
    return [
      count(e.activeProductsCount, 'Active products', 'observation'),
      count(e.inactiveProductsCount, 'Unpublished / inactive products', 'observation'),
      count(e.totalProductsCount, 'Total catalog products', 'observation'),
    ];
  }
  if (finding.type === 'no_recorded_traffic') {
    return [
      count(e.verifiedSessions, `Verified sessions (${e.windowDays || 7}d)`, 'current'),
      statusObs('Verified analytics query', 'Telemetry status'),
    ];
  }
  if (finding.type === 'traffic_without_orders') {
    const items = [
      count(e.verifiedSessions, `Verified sessions (${e.windowDays || 7}d)`, 'current'),
      count(e.currentOrdersCount, `Completed orders (${e.windowDays || 7}d)`, 'current'),
    ];
    if (finite(e.openAbandonedCount) !== null && e.openAbandonedCount > 0) {
      items.push(count(e.openAbandonedCount, 'Open abandoned checkouts', 'current'));
    }
    return items;
  }
  if (finding.type === 'abandoned_checkouts_open') {
    const items = [
      count(e.openAbandonedCount, 'Open abandoned checkouts', 'current'),
      money(e.openAbandonedValue, 'Recorded cart value', 'current'),
    ];
    if (finite(e.completedAfterCheckoutCount) !== null) {
      items.push(count(e.completedAfterCheckoutCount, 'Completed checkouts (30d)', 'current'));
    }
    return items;
  }
  if (finding.type === 'inventory_stockouts') {
    return [
      count(e.zeroStockCount, 'Zero-stock levels', 'observation'),
      count(e.totalLevelsCount, 'Total tracked levels', 'observation'),
      count(e.inStockCount, 'In-stock levels', 'observation'),
    ];
  }
  if (finding.type === 'unfulfilled_orders_backlog') {
    return [
      count(e.unfulfilledOrdersCount, 'Aged unfulfilled orders', 'observation'),
      count(e.ageThresholdHours || 48, 'Age threshold (hours)', 'observation'),
    ];
  }
  if (finding.type === 'no_storefront_events') {
    const items = [count(e.recordedEventsCount, 'Recorded events (30d)', 'current')];
    if (finite(e.activeProductsCount) !== null) items.push(count(e.activeProductsCount, 'Active catalog products', 'observation'));
    return items;
  }
  return [];
}

function presentPriorityFinding(entry, organizationId) {
  if (!entry) return null;
  const { finding, assessment, duplicates } = entry;
  const evidence = object(finding.evidence);
  const references = [{ id: `finding:${finding.id}`, source_type: 'intelligence_findings', source_record_id: finding.id }];
  if (evidence.coverage_run_id) references.push({ id: `order-coverage:${evidence.coverage_run_id}`, source_type: evidence.coverage_source || 'order_coverage', source_record_id: evidence.coverage_run_id });
  if (finding.type === 'integration_failure' || STORE_SIGNAL_TYPES.has(finding.type)) {
    references.push({ id: `store:${finding.store_id}`, source_type: evidence.source || 'stores', source_record_id: finding.store_id });
  }
  const category = finding.type === 'integration_failure' || finding.type === 'storefront_domain_unconfigured' || finding.type === 'no_storefront_events'
    ? 'data_readiness'
    : 'business_performance';
  return {
    contract_version: CONTRACT_VERSION, id: finding.id, organization_id: organizationId, store_id: finding.store_id,
    category, signal_category: SIGNAL_CATEGORY_FOR_TYPE[finding.type] || 'storefront_readiness',
    evaluation_state: assessment.eligible ? 'verified' : (assessment.freshness.state === 'stale' ? 'stale' : 'not_evaluated'),
    type: finding.type,
    title: finding.title, description: finding.description, severity: finding.severity,
    priority: { method_version: PRIORITY_METHOD_VERSION, classification: finding.severity,
      rationale: [`Recorded severity: ${finding.severity}.`, `Evidence freshness: ${assessment.freshness.state}.`, `Confidence: ${assessment.confidence.replaceAll('_', ' ')}.`, 'Only current, verified, sufficiently covered findings are eligible.'],
      tie: null },
    reporting_period: findingPeriod(evidence), detected_at: iso(finding.detected_at), last_verified_at: assessment.freshness.as_of,
    evidence_freshness: assessment.freshness, coverage: assessment.coverage,
    confidence: { classification: assessment.confidence, rationale: assessment.confidence_rationale, numerical_score: null },
    limitations: assessment.limitations, unknowns: assessment.current_validity === 'current_evidence_verified' ? ['The underlying cause is not established by this observation.'] : ['Current store conditions are not verified by this finding.'],
    lifecycle: { state: assessment.lifecycle_state, current_validity: assessment.current_validity, invalidated: !assessment.eligible },
    evidence: { classification: 'verified_observation', source: evidence.source || 'intelligence_findings', observations: observationFor(finding), references, duplicate_finding_ids: duplicates },
    recommendation: recommendationForFinding(finding, assessment),
    investigation: { finding_id: finding.id, route: `/dashboard/rev-intell?finding=${encodeURIComponent(finding.id)}`, context_contract: 'rev-selected-finding-v1', revalidate_on_open: true },
    read_only: true,
  };
}

module.exports = { CONTRACT_VERSION, PRIORITY_METHOD_VERSION, RECOMMENDATION_CONTRACT_VERSION,
  assessFinding, freshnessFor, prioritizedFindings, presentPriorityFinding,
  recommendationForFinding, findingPeriod, observationFor };
