'use strict';

// Task 216 — read-only operational briefing over the authoritative business
// snapshot. This service never recomputes commerce metrics and never invokes
// a language model. It presents only values already persisted by the Python
// business-state builder and findings verified by the intelligence pipeline.

const { retrieveIntegrationStates } = require('./revIntegrationState');
const { RESOURCE_BY_ID } = require('./revIntegrationEvidenceService');
const { listFindings } = require('./intelligenceFindingsRepository');
const { buildSignalEvaluationSummary } = require('./intelligenceFindingsAggregator');
const priorityFinding = require('./priorityFindingService');
const { buildBusinessHealth, validateBusinessHealth } = require('./businessHealth');
const { fetchBusinessHealthBundle, normalizePeriodDays: repoNormalizePeriodDays } = require('./businessHealthRepository');
const normalizePeriodDays = typeof repoNormalizePeriodDays === 'function'
  ? repoNormalizePeriodDays
  : (value => ([7, 14, 30].includes(Number(value)) ? Number(value) : 7));
const { buildOperationalActivity: buildOperationalActivityFeed, validateOperationalActivity } = require('./operationalActivity');
const { fetchOperationalActivityBundle } = require('./operationalActivityRepository');

const CONTRACT_VERSION = 'command-center-v1';
const iso = value => value instanceof Date ? value.toISOString() : (typeof value === 'string' ? value : null);
const finite = value => value === null || value === undefined ? null : (Number.isFinite(Number(value)) ? Number(value) : null);
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

function prioritizedFindings(findings, options = {}) {
  return priorityFinding.prioritizedFindings(findings, options).candidates.map(candidate => ({
    ...candidate.finding,
    priority_assessment: candidate.assessment,
    duplicate_finding_ids: candidate.duplicates,
  }));
}

function snapshotStatus(snapshot, now) {
  if (!snapshot) return 'unavailable';
  if (snapshot.computation_status === 'failed') return 'failed';
  const generated = new Date(snapshot.generated_at);
  if (!Number.isFinite(generated.getTime())) return 'unknown';
  const stale = now.getTime() - generated.getTime() > Math.max(1, snapshot.staleness_threshold_mins || 30) * 60_000;
  if (stale) return 'stale';
  return snapshot.computation_status === 'partial' ? 'partial' : 'current';
}

function availability(snapshot, state, resourceId) {
  const integration = state?.capabilities?.find(item => item.id === resourceId);
  if (!integration) return { state: 'unknown', reason: 'Source coverage could not be verified.' };
  if (integration.authorization === 'missing_scope') return { state: 'unauthorized', reason: 'The required Shopify permission is unavailable.' };
  if (integration.sync_state === 'unsupported') return { state: 'unsupported', reason: 'This capability is not supported by the current build.' };
  if (integration.sync_state === 'never_synchronized') return { state: 'not_synchronized', reason: 'The required data has not synchronized yet.' };
  if (integration.sync_state === 'failed') return { state: 'retrieval_failed', reason: 'The latest retrieval failed; no current value is asserted.' };
  if (integration.sync_state === 'partial') return { state: 'partial', reason: 'Only part of the source population is available.' };
  if (integration.freshness === 'stale') return { state: 'stale', reason: 'The latest successful refresh is outside the expected freshness window.' };
  return { state: integration.operational ? 'available' : 'unknown', reason: integration.operational ? null : 'Source availability is not verified.' };
}

function metric({ id, label, value, unit = 'count', currency = null, definition, comparison = null, evidence }) {
  return {
    id, label, value, unit, currency, definition, comparison,
    availability: evidence.state,
    availability_reason: evidence.reason,
    reporting_period: { kind: id.includes('yesterday') ? 'previous_utc_day' : 'current_utc_day', timezone: 'UTC', semantics: 'snapshot_day' },
    source: 'business_states.current',
  };
}

function buildMetrics(snapshot, state, status) {
  if (!snapshot || status === 'failed' || status === 'unavailable') return [];
  const metadata = object(snapshot.metadata);
  const currency = typeof metadata.revenue_currency === 'string' ? metadata.revenue_currency : null;
  const ordersEvidence = availability(snapshot, state, 'orders');
  const checkoutEvidence = availability(snapshot, state, 'abandoned-checkouts');
  const stale = status === 'stale';
  const financialEvidence = !currency ? { state: 'unknown', reason: 'A single order currency is not verified; monetary values are withheld.' } :
    stale ? { state: 'stale', reason: 'This business snapshot is stale. Historical values remain available, not current performance.' } : ordersEvidence;
  const countEvidence = stale ? { state: 'stale', reason: 'This business snapshot is stale. Historical values remain available, not current activity.' } : checkoutEvidence;
  const values = [
    metric({ id: 'net_sales_today', label: 'Net sales today', value: finite(snapshot.revenue_today), unit: 'money', currency,
      definition: 'Order totals net of refunds, excluding cancelled orders. UTC calendar day; not gross sales.', evidence: financialEvidence }),
    metric({ id: 'net_sales_yesterday', label: 'Net sales yesterday', value: finite(snapshot.revenue_yesterday), unit: 'money', currency,
      definition: 'Previous UTC calendar day using the same net-sales definition.', evidence: financialEvidence }),
    metric({ id: 'revenue_change', label: 'Day-over-day change', value: finite(snapshot.revenue_delta_pct), unit: 'percent',
      definition: 'Percentage change from yesterday to today. Unavailable when yesterday has no positive net-sales baseline.', evidence: financialEvidence }),
    metric({ id: 'abandoned_checkouts', label: 'Open abandoned checkouts', value: finite(snapshot.abandoned_cart_count),
      definition: 'Latest record per checkout, classified abandoned and not recovered, from the last 48 hours.', evidence: countEvidence }),
  ];
  // A value without its required currency is not a usable monetary metric.
  return values.map(item => ({ ...item,
    value: item.unit === 'money' && !item.currency ? null : item.value,
    availability: item.value === null && item.availability === 'available' ? 'unknown' : item.availability,
    availability_reason: item.value === null && !item.availability_reason ? 'The value could not be calculated from verified evidence.' : item.availability_reason,
    zero_semantics: item.value === 0 && ['available', 'stale'].includes((item.id === 'abandoned_checkouts' ? checkoutEvidence : ordersEvidence).state) ? 'verified_zero' : item.value === 0 ? 'unverified_zero_withheld' : null,
  }));
}

const DISCONNECTED_INTEGRATION_STATES = new Set([
  'disconnected',
  'authorization_required',
  'authorization_expired',
  'authorization_revoked',
]);

const FINDING_EVIDENCE_SUMMARY = {
  revenue_change: 'Completed order revenue across comparable reporting periods.',
  order_volume_change: 'Completed order volume across comparable reporting periods.',
  refund_increase: 'Recorded refund transactions and order adjustment history.',
  returning_customer_change: 'Verified returning-buyer records across comparable periods.',
  integration_failure: 'Store authorization and synchronization status records.',
};

const FINDING_MATTERS_COPY = {
  revenue_change: 'A verified revenue shift narrows where to look across order volume, pricing, or product mix.',
  order_volume_change: 'Order volume movement can point to shifts in product demand, storefront availability, or checkout conversion.',
  refund_increase: 'Rising refund value can indicate product, fulfillment, or expectation issues worth examining early.',
  returning_customer_change: 'Changes in returning-buyer share affect repeat revenue stability over time.',
  integration_failure: 'Resolving data access or synchronization issues restores complete business visibility.',
};

const SYNC_DOMAIN_LABELS = {
  orders: 'Order records',
  products: 'Product information',
  inventory: 'Inventory records',
  customers: 'Customer records',
  abandoned_checkouts: 'Checkout records',
  refunds: 'Refund records',
  fulfillments: 'Fulfillment records',
};

function parseTimestampMs(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isNewSincePrevious(occurredAt, previousGeneratedAt, now) {
  const occurredMs = parseTimestampMs(occurredAt);
  if (occurredMs === null) return false;
  const prevMs = parseTimestampMs(previousGeneratedAt);
  if (prevMs !== null) return occurredMs > prevMs;
  const nowMs = now instanceof Date ? now.getTime() : Date.now();
  return nowMs - occurredMs <= 24 * 3600_000;
}

function describeIntegrationDevelopment(item) {
  const status = String(item.status || '').toLowerCase();
  const domainMatch = typeof item.event_id === 'string' && item.event_id.startsWith('sync:')
    ? item.event_id.split(':')[1]
    : null;
  const domainLabel = domainMatch ? (SYNC_DOMAIN_LABELS[domainMatch] || domainMatch.replaceAll('_', ' ')) : null;

  if (item.type === 'sync' && domainLabel) {
    if (status === 'failed') {
      return {
        title: `${domainLabel} could not be refreshed`,
        explanation: `The latest update for ${domainLabel.toLowerCase()} did not complete, so newer changes may not be reflected yet.`,
        category: 'evidence_availability',
        status_tag: 'ongoing',
        route: '/dashboard/integrations',
        action_label: 'Review in Integrations',
      };
    }
    if (status === 'degraded' || status === 'partial') {
      return {
        title: `${domainLabel} partially updated`,
        explanation: `Only part of your ${domainLabel.toLowerCase()} was available during the latest update.`,
        category: 'evidence_availability',
        status_tag: 'ongoing',
        route: '/dashboard/integrations',
        action_label: 'Review in Integrations',
      };
    }
    // Routine successful syncs are only surfaced when they represent a material first-time or notable availability update
    return null;
  }

  if (item.category === 'integration') {
    if (status === 'connected') {
      return {
        title: 'Store connection restored',
        explanation: 'Shopify access is verified again, allowing Revluma to continue reviewing store evidence.',
        category: 'configuration',
        status_tag: 'resolved',
        route: '/dashboard/integrations',
        action_label: 'Review connection',
      };
    }
    if (DISCONNECTED_INTEGRATION_STATES.has(status)) {
      return {
        title: 'Store access requires reconnection',
        explanation: 'Revluma cannot review new store activity until Shopify authorization is restored.',
        category: 'configuration',
        status_tag: 'ongoing',
        route: '/dashboard/integrations',
        action_label: 'Reconnect in Integrations',
      };
    }
    if (status === 'limited_access' || status === 'sync_partial' || status === 'needs_attention') {
      return {
        title: 'Store evidence access is limited',
        explanation: 'One or more store permissions or data areas need review for complete briefing coverage.',
        category: 'evidence_availability',
        status_tag: 'ongoing',
        route: '/dashboard/integrations',
        action_label: 'Review in Integrations',
      };
    }
  }

  if (item.category === 'webhook') {
    return {
      title: 'Store update notifications changed',
      explanation: 'A Shopify store notification setting changed, which may affect how quickly new updates arrive.',
      category: 'configuration',
      status_tag: 'ongoing',
      route: '/dashboard/integrations',
      action_label: 'Review in Integrations',
    };
  }

  return null;
}

function selectFeaturedIntelligence({
  presentedFindings = [],
  priorityFindingId = null,
  status = 'unavailable',
  state = null,
  snapshot = null,
  hasPreviousBriefing = false,
  previousGeneratedAt = null,
  now = new Date(),
}) {
  const integrationStatus = state?.overall_status || 'unknown';

  // Fail-closed states take precedence so empty states are never interchangeable.
  if (status === 'failed') {
    return { status: 'empty', empty_state: 'generation_failed', item: null };
  }
  if (integrationStatus === 'synchronizing') {
    return { status: 'empty', empty_state: 'investigation_running', item: null };
  }

  // Exclude the unresolved Top Priority finding so it is never duplicated as a
  // separate featured discovery in Operational Briefing.
  const eligible = (presentedFindings || []).filter(item =>
    item &&
    item.id !== priorityFindingId &&
    item.lifecycle?.invalidated !== true &&
    item.confidence?.classification !== 'insufficient_evidence' &&
    item.confidence?.classification !== 'unable_to_determine',
  );

  // Prefer newly detected discoveries since the previous briefing, while
  // preserving the backend's existing intelligence prioritization order.
  const newlyDetected = eligible.filter(item =>
    isNewSincePrevious(item.detected_at, previousGeneratedAt, now),
  );
  const selected = newlyDetected[0] || eligible[0] || null;

  if (selected) {
    const isVerified = selected.evidence?.classification === 'verified_observation' &&
      ['high', 'moderate'].includes(selected.confidence?.classification);
    const isNew = isNewSincePrevious(selected.detected_at, previousGeneratedAt, now);
    const evidenceSummary = FINDING_EVIDENCE_SUMMARY[selected.type]
      || (selected.evidence?.source ? `Verified ${String(selected.evidence.source).replaceAll('_', ' ')} records.` : 'Verified store evidence records.');

    return {
      status: 'qualified',
      empty_state: null,
      item: {
        id: `featured:${selected.id}`,
        finding_id: selected.id,
        title: selected.title,
        explanation: selected.description,
        why_it_matters: selected.recommendation?.rationale || FINDING_MATTERS_COPY[selected.type] || null,
        evidence_summary: evidenceSummary,
        verification_status: isVerified ? 'verified' : 'hypothesis',
        confidence: selected.confidence?.classification || 'moderate',
        severity: selected.severity,
        category: selected.category,
        detected_at: selected.detected_at,
        last_verified_at: selected.last_verified_at || null,
        is_new: isNew,
        action_label: 'Examine supporting evidence',
        action_route: selected.investigation?.route || `/dashboard/rev-intell?finding=${encodeURIComponent(selected.id)}`,
        references: Array.isArray(selected.evidence?.references) ? selected.evidence.references : [],
      },
    };
  }

  // Determine the exact, honest non-interchangeable empty state.
  if (!state || DISCONNECTED_INTEGRATION_STATES.has(integrationStatus)) {
    return { status: 'empty', empty_state: 'insufficient_evidence', item: null };
  }
  if (!snapshot || status === 'unavailable' || status === 'unknown') {
    return {
      status: 'empty',
      empty_state: !hasPreviousBriefing && integrationStatus === 'connected' ? 'no_previous_briefing' : 'insufficient_evidence',
      item: null,
    };
  }
  if (!hasPreviousBriefing && status === 'partial' && presentedFindings.length === 0) {
    return { status: 'empty', empty_state: 'no_previous_briefing', item: null };
  }
  return { status: 'empty', empty_state: 'no_new_findings', item: null };
}

function composeRecentDevelopments({
  presentedFindings = [],
  resolvedFindings = [],
  priorityFindingId = null,
  featuredFindingId = null,
  operationalActivity = null,
  hasPreviousBriefing = false,
  previousGeneratedAt = null,
  now = new Date(),
}) {
  const items = [];
  const seenIds = new Set();

  // 1. Recently resolved findings (distinct from open Top Priorities).
  for (const row of resolvedFindings || []) {
    if (!row || row.status !== 'resolved') continue;
    const occurredAt = iso(row.resolved_at || row.updated_at);
    if (!occurredAt) continue;
    const id = `dev-resolved:${row.id}`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    items.push({
      id,
      category: 'resolved_finding',
      lifecycle: 'resolved',
      title: `${row.title} resolved`,
      explanation: 'A previously identified business finding is no longer active based on updated records.',
      occurred_at: occurredAt,
      finding_id: row.id,
      route: `/dashboard/rev-intell?finding=${encodeURIComponent(row.id)}`,
      action_label: 'Review finding',
    });
  }

  // 2. Other active verified findings (excluding Top Priority & Featured Intelligence to avoid duplication).
  for (const item of presentedFindings || []) {
    if (!item || item.id === priorityFindingId || item.id === featuredFindingId) continue;
    const occurredAt = iso(item.detected_at);
    if (!occurredAt) continue;
    const id = `dev-finding:${item.id}`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    const isNew = isNewSincePrevious(occurredAt, previousGeneratedAt, now);
    items.push({
      id,
      category: 'finding',
      lifecycle: isNew ? 'new' : 'ongoing',
      title: item.title,
      explanation: item.description,
      occurred_at: occurredAt,
      finding_id: item.id,
      route: item.investigation?.route || `/dashboard/rev-intell?finding=${encodeURIComponent(item.id)}`,
      action_label: 'Examine finding',
    });
  }

  // 3. Meaningful operational/evidence availability developments (never routine sync spam).
  const activityItems = Array.isArray(operationalActivity?.items) ? operationalActivity.items : [];
  for (const entry of activityItems) {
    if (!entry || entry.category === 'finding') continue;
    const mapped = describeIntegrationDevelopment(entry);
    if (!mapped) continue;
    const occurredAt = iso(entry.occurred_at);
    if (!occurredAt) continue;
    const id = `dev-op:${entry.event_id}`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    const lifecycle = mapped.status_tag === 'resolved'
      ? 'resolved'
      : isNewSincePrevious(occurredAt, previousGeneratedAt, now)
        ? 'new'
        : 'ongoing';
    items.push({
      id,
      category: mapped.category,
      lifecycle,
      title: mapped.title,
      explanation: mapped.explanation,
      occurred_at: occurredAt,
      finding_id: null,
      route: mapped.route,
      action_label: mapped.action_label,
    });
  }

  items.sort((a, b) => (parseTimestampMs(b.occurred_at) || 0) - (parseTimestampMs(a.occurred_at) || 0) || a.id.localeCompare(b.id));
  const bounded = items.slice(0, 6);

  return {
    empty_state: bounded.length === 0 ? (hasPreviousBriefing ? 'no_changes' : 'no_previous_briefing') : null,
    items: bounded,
  };
}

function assessBriefingSituation({ snapshot, status, state, findings = [], featuredIntelligence = null }) {
  const integrationStatus = state?.overall_status || 'unknown';
  const primary = findings[0] || null;

  // Data quality axis (strictly independent from business severity).
  let dataQuality = 'unavailable';
  let dataQualityLabel = 'Evidence unavailable';
  if (integrationStatus === 'synchronizing') {
    dataQuality = 'syncing';
    dataQualityLabel = 'Evidence syncing';
  } else if (status === 'failed') {
    dataQuality = 'unavailable';
    dataQualityLabel = 'Evidence unavailable';
  } else if (!state || DISCONNECTED_INTEGRATION_STATES.has(integrationStatus) || !snapshot || status === 'unavailable' || status === 'unknown') {
    dataQuality = 'insufficient';
    dataQualityLabel = 'Insufficient evidence';
  } else if (status === 'stale') {
    dataQuality = 'stale';
    dataQualityLabel = 'Evidence stale';
  } else if (status === 'partial' || integrationStatus === 'limited_access' || integrationStatus === 'sync_partial') {
    dataQuality = 'partial';
    dataQualityLabel = 'Evidence partial';
  } else {
    dataQuality = 'verified';
    dataQualityLabel = 'Evidence verified';
  }

  // Business assessment axis (never equates missing data with unhealthy business,
  // and never equates zero findings with proof of good health).
  if (status === 'failed') {
    return { state: 'unavailable', label: 'Briefing unavailable', data_quality: dataQuality, data_quality_label: dataQualityLabel };
  }
  if (integrationStatus === 'synchronizing') {
    return { state: 'investigating', label: 'Preparing briefing', data_quality: dataQuality, data_quality_label: dataQualityLabel };
  }
  if (!state || DISCONNECTED_INTEGRATION_STATES.has(integrationStatus) || !snapshot || status === 'unavailable' || status === 'unknown') {
    return { state: 'insufficient_evidence', label: 'Insufficient evidence', data_quality: dataQuality, data_quality_label: dataQualityLabel };
  }
  if ((primary && ['critical', 'high'].includes(primary.severity)) || featuredIntelligence?.status === 'qualified') {
    return { state: 'important_development', label: 'Development detected', data_quality: dataQuality, data_quality_label: dataQualityLabel };
  }
  if (primary || status === 'stale' || state?.merchant_action_required || ['sync_failed', 'needs_attention'].includes(integrationStatus)) {
    return { state: 'attention_needed', label: 'Attention needed', data_quality: dataQuality, data_quality_label: dataQualityLabel };
  }
  return { state: 'normal', label: 'No major issue established', data_quality: dataQuality, data_quality_label: dataQualityLabel };
}

function composeBriefing({
  snapshot,
  previousSnapshot = null,
  status,
  state,
  findings,
  presentedFindings = [],
  resolvedFindings = [],
  operationalActivity = null,
  warnings,
  reportingPeriod = null,
  now = new Date(),
}) {
  const primary = findings[0] || null;
  const integrationStatus = state?.overall_status || 'unknown';
  const staleResources = (state?.capabilities || []).filter(item => item.freshness === 'stale').map(item => item.name);
  const limitations = [...warnings];
  if (state && integrationStatus !== 'connected') limitations.unshift(state.status_explanation);
  if (staleResources.length) limitations.push(`Stale source evidence: ${staleResources.join(', ')}.`);
  if (status === 'stale') limitations.unshift('The business snapshot is stale; figures describe the last successful generation, not current performance.');
  if (snapshot?.computation_status === 'partial') limitations.push('The business snapshot is partial; unavailable metrics and conclusions are withheld.');

  let headline = 'Your operational briefing is unavailable';
  let summary = 'Revluma could not load a current business snapshot. No business performance conclusion is asserted.';
  let tone = 'neutral';
  if (primary) {
    headline = primary.title;
    summary = primary.description;
    tone = ['critical', 'high'].includes(primary.severity) ? 'attention' : 'default';
  } else if (!state || DISCONNECTED_INTEGRATION_STATES.has(integrationStatus)) {
    headline = state ? 'Reconnect Shopify to restore your operational briefing' : 'Connect Shopify to prepare your operational briefing';
    summary = state?.status_explanation || 'No Shopify store is connected. Business metrics and findings cannot be prepared yet.';
    tone = 'attention';
  } else if (['failed', 'unavailable', 'unknown'].includes(status)) {
    headline = 'Your operational briefing is unavailable';
    summary = status === 'failed' ? 'The latest business-state generation failed. A previous or partial result is not being presented as a successful rebuild.' : 'The business snapshot could not be verified. No current performance conclusion is asserted.';
    tone = 'attention';
  } else if (integrationStatus === 'synchronizing') {
    headline = 'Revluma is preparing your first business overview';
    summary = 'Synchronization is still in progress. Available records can be explored, but comparisons and broader business conclusions remain limited until the required evidence is complete.';
  } else if (status === 'stale') {
    headline = 'Your latest business evidence needs a refresh';
    summary = 'The Shopify connection and data freshness are separate. Historical evidence remains available, but current-period conclusions are limited until synchronization succeeds.';
    tone = 'attention';
  } else if (status === 'partial') {
    headline = 'A partial operational picture is available';
    summary = 'Some business evidence is available, but one or more sources could not be computed or verified. Available metrics remain useful within their stated limits.';
    tone = 'attention';
  } else if (snapshot && finite(snapshot.revenue_today) !== null) {
    headline = 'Your latest synchronized business picture';
    summary = reportingPeriod && reportingPeriod.label && reportingPeriod.timezone
      ? `Verified performance for ${reportingPeriod.label.toLowerCase()} (${reportingPeriod.timezone}) is available. Review the supporting indicators and verified findings for developments that deserve investigation.`
      : 'The current UTC-day snapshot is available. Review the supporting indicators and verified findings for developments that deserve investigation.';
  } else if (state) {
    headline = 'Your store is connected; business evidence is still limited';
    summary = 'No current business snapshot is available yet. Revluma is not substituting zero activity or a historical estimate.';
  }

  const next = primary ? {
    kind: 'investigate_finding', finding_id: primary.id,
    label: 'Investigate this finding with Rev',
    reason: 'Open the verified finding with its authoritative store and evidence context.',
    route: `/dashboard/rev-intell?finding=${encodeURIComponent(primary.id)}`,
  } : state?.merchant_action_required || ['sync_failed', 'sync_partial', 'needs_attention'].includes(integrationStatus) ? {
    kind: 'review_integration', finding_id: null,
    label: 'Review data readiness', reason: state.recommended_next_step || 'Resolve the recorded integration limitation before relying on affected conclusions.',
    route: '/dashboard/integrations',
  } : snapshot ? {
    kind: 'explore_evidence', finding_id: null,
    label: 'Explore the evidence with Rev', reason: 'Investigate available order and checkout evidence without assuming an unverified cause.',
    route: '/dashboard/rev-intell',
  } : {
    kind: 'review_integration', finding_id: null,
    label: 'Open Integrations', reason: 'Review store connection and synchronization readiness.', route: '/dashboard/integrations',
  };

  const previousGeneratedAt = iso(previousSnapshot?.generated_at);
  const hasPreviousBriefing = Boolean(previousGeneratedAt);
  const priorityFindingId = presentedFindings[0]?.id || primary?.id || null;
  const featuredIntelligence = selectFeaturedIntelligence({
    presentedFindings,
    priorityFindingId,
    status,
    state,
    snapshot,
    hasPreviousBriefing,
    previousGeneratedAt,
    now,
  });
  const recentDevelopments = composeRecentDevelopments({
    presentedFindings,
    resolvedFindings,
    priorityFindingId,
    featuredFindingId: featuredIntelligence.item?.finding_id || null,
    operationalActivity,
    hasPreviousBriefing,
    previousGeneratedAt,
    now,
  });
  const assessment = assessBriefingSituation({
    snapshot,
    status,
    state,
    findings,
    featuredIntelligence,
  });

  return {
    headline, summary, tone,
    observation: primary ? 'This priority finding was verified by the intelligence pipeline. Its evidence establishes the observation, not an unrecorded cause.' : null,
    implication: primary ? 'Review the finding evidence to understand the affected business area and the limits of the conclusion.' : null,
    evidence_quality: status === 'current' && snapshot?.computation_status === 'complete' ? 'complete_snapshot' : status,
    no_findings_note: !primary && snapshot ? 'No open verified priority findings are recorded. This is not proof that no issue exists outside the checks and evidence available to Revluma.' : null,
    limitations: [...new Set(limitations.filter(Boolean))].slice(0, 12),
    next_investigation: next,
    generated_at: iso(snapshot?.generated_at),
    previous_generated_at: previousGeneratedAt,
    has_previous_briefing: hasPreviousBriefing,
    assessment,
    featured_intelligence: featuredIntelligence,
    recent_developments: recentDevelopments,
    generated_from: { business_state_id: snapshot?.id || null, finding_id: primary?.id || null, integration_evaluated_at: state?.evaluated_at || null },
  };
}

function resourceEvidence(states, domainRows) {
  const rowsByStore = new Map();
  for (const row of domainRows) {
    if (!rowsByStore.has(row.store_id)) rowsByStore.set(row.store_id, []);
    rowsByStore.get(row.store_id).push(row);
  }
  return states.flatMap(state => (state.capabilities || []).map(capability => {
    const rows = rowsByStore.get(state.store.id) || [];
    const domain = RESOURCE_BY_ID[capability.id]?.domain || null;
    const row = rows.find(item => item.domain === domain);
    return {
      store_id: state.store.id, resource: capability.id, label: capability.name,
      availability: availability(null, state, capability.id).state,
      reason: availability(null, state, capability.id).reason,
      freshness: capability.freshness || 'unknown',
      last_success_at: iso(row?.last_succeeded_at),
      last_attempt_at: iso(row?.last_attempted_at),
      sync_state: capability.sync_state || 'unknown',
      limitations: capability.limited_reasons || [],
      coverage: capability.id === 'orders' ? state.coverage?.status || 'unknown' : 'not_certified',
    };
  }));
}

async function getCommandCenter({ prisma, organizationId, storeId = null, periodDays = 7, now = new Date() }) {
  const days = normalizePeriodDays(periodDays);
  const resolvedWindowSince = new Date(now.getTime() - 14 * 24 * 3600_000);
  const [snapshot, previousSnapshots, states, rawFindings, rawResolvedFindings, stores] = await Promise.all([
    prisma.business_states.findFirst({ where: { organization_id: organizationId, is_current: true } }),
    prisma.business_states && typeof prisma.business_states.findMany === 'function'
      ? prisma.business_states.findMany({
          where: { organization_id: organizationId, is_current: false, computation_status: { not: 'failed' } },
          orderBy: { generated_at: 'desc' },
          take: 1,
          select: { id: true, generated_at: true, computation_status: true },
        }).catch(() => [])
      : [],
    retrieveIntegrationStates({ prisma, organizationId, now }),
    listFindings(prisma, organizationId, { status: 'active', limit: 100 }),
    prisma.intelligence_findings && typeof prisma.intelligence_findings.findMany === 'function'
      ? prisma.intelligence_findings.findMany({
          where: { organization_id: organizationId, status: 'resolved', resolved_at: { gte: resolvedWindowSince } },
          orderBy: { resolved_at: 'desc' },
          take: 10,
          select: {
            id: true, store_id: true, type: true, severity: true, status: true,
            title: true, description: true, detected_at: true, updated_at: true, resolved_at: true, dedupe_key: true,
          },
        }).catch(() => [])
      : [],
    prisma.stores.findMany({ where: { organization_id: organizationId }, select: { id: true, shop_domain: true, platform: true, last_synced_at: true, sync_completed_at: true }, orderBy: { last_synced_at: 'desc' } }),
  ]);
  const previousSnapshot = Array.isArray(previousSnapshots)
    ? previousSnapshots.find(row => row && row.id !== snapshot?.id && row.generated_at) || null
    : null;
  const storeIds = stores.map(store => store.id);
  const [domainRows, storeProfiles] = await Promise.all([
    storeIds.length ? prisma.store_sync_domain_states.findMany({ where: { store_id: { in: storeIds } } }) : [],
    storeIds.length && prisma.store_profiles && typeof prisma.store_profiles.findMany === 'function'
      ? prisma.store_profiles.findMany({
          where: { store_id: { in: storeIds } },
          select: { store_id: true, shop_name: true, iana_timezone: true, currency_code: true },
        }).catch(() => [])
      : [],
  ]);
  const profileByStoreId = new Map((storeProfiles || []).map(p => [p.store_id, p]));
  const status = snapshotStatus(snapshot, now);
  // Tenant-safe store selection: only stores owned by this authenticated organization can be selected.
  const primaryStore = (typeof storeId === 'string' && storeId ? stores.find(store => store.id === storeId) : null) || stores[0] || null;
  const resourcesByStore = new Map(states.map(item => [item.store.id, item]));
  const state = primaryStore ? (resourcesByStore.get(primaryStore.id) || null) : null;
  const scopedFindings = primaryStore && stores.length > 1
    ? rawFindings.filter(item => !item.store_id || item.store_id === primaryStore.id)
    : rawFindings;
  const scopedResolvedFindings = (Array.isArray(rawResolvedFindings) ? rawResolvedFindings : [])
    .filter(item => item && item.status === 'resolved' && (!primaryStore || stores.length <= 1 || !item.store_id || item.store_id === primaryStore.id));
  const priority = priorityFinding.prioritizedFindings(scopedFindings, { now, resourcesByStore });
  const findings = priority.candidates.map(candidate => ({
    ...candidate.finding,
    priority_assessment: candidate.assessment,
    duplicate_finding_ids: candidate.duplicates,
  }));
  const presentedFindings = priority.candidates.slice(0, 8).map(candidate => {
    const presented = priorityFinding.presentPriorityFinding(candidate, organizationId);
    return { ...presented, next_step: { label: 'Investigate with Rev', route: presented.investigation.route } };
  });
  if (presentedFindings[0] && priority.tie) presentedFindings[0].priority.tie = priority.tie;
  const warnings = Array.isArray(object(snapshot?.metadata).warnings) ? object(snapshot.metadata).warnings.filter(item => typeof item === 'string') : [];
  const [healthBundle, activityBundle] = primaryStore ? await Promise.all([
    fetchBusinessHealthBundle(prisma, organizationId, primaryStore.id, now, state, { periodDays: days }),
    fetchOperationalActivityBundle(prisma, organizationId, primaryStore.id, now),
  ]) : [null, null];
  const businessHealth = healthBundle ? buildBusinessHealth(healthBundle, now) : null;
  const operationalActivity = activityBundle ? buildOperationalActivityFeed(activityBundle, now, 20, null) : null;
  if (businessHealth && !validateBusinessHealth(businessHealth)) throw new Error('Business health contract validation failed.');
  if (operationalActivity && !validateOperationalActivity(operationalActivity)) throw new Error('Operational activity contract validation failed.');

  const primaryProfile = primaryStore ? (profileByStoreId.get(primaryStore.id) || null) : null;
  const primaryDomainRows = primaryStore
    ? (domainRows || []).filter(row => row.store_id === primaryStore.id)
    : [];
  const primaryOrderCoverage = primaryStore && prisma.intelligence_order_coverage && typeof prisma.intelligence_order_coverage.findFirst === 'function'
    ? await prisma.intelligence_order_coverage.findFirst({
        where: { store_id: primaryStore.id, organization_id: organizationId },
        orderBy: { certified_at: 'desc' },
        select: { source: true, source_run_id: true, certified_at: true, coverage_start: true, coverage_end: true },
      }).catch(() => null)
    : null;
  const signalEvaluation = buildSignalEvaluationSummary({
    store: primaryStore,
    domainRows: primaryDomainRows,
    storeProfile: primaryProfile,
    coverage: primaryOrderCoverage,
    activeFindings: findings,
    now,
    periodDays: days,
  });
  const healthPeriod = businessHealth && businessHealth.reporting_period ? businessHealth.reporting_period : null;
  const verifiedTimezone = (primaryProfile && typeof primaryProfile.iana_timezone === 'string' && primaryProfile.iana_timezone.trim())
    || (healthPeriod && typeof healthPeriod.timezone === 'string' && healthPeriod.timezone.trim())
    || null;
  const timezoneVerified = Boolean(
    (primaryProfile && typeof primaryProfile.iana_timezone === 'string' && primaryProfile.iana_timezone.trim())
    || (healthPeriod && healthPeriod.timezone_verified === true),
  );
  const resolvedTimezone = verifiedTimezone || 'UTC';
  const reportingPeriod = healthPeriod ? {
    kind: healthPeriod.current?.label || `last_${days}_days`,
    label: healthPeriod.display_label || `Last ${days} days`,
    days: healthPeriod.days || days,
    timezone: resolvedTimezone,
    timezone_verified: timezoneVerified,
    start: healthPeriod.current?.start || null,
    end: healthPeriod.current?.end || null,
    note: healthPeriod.note || `Rolling ${days}-day period displayed in the store's reporting timezone (${resolvedTimezone}).`,
  } : {
    kind: 'current_and_previous_utc_day',
    label: 'Today & yesterday',
    days: 1,
    timezone: resolvedTimezone,
    timezone_verified: timezoneVerified,
    start: null,
    end: null,
    note: timezoneVerified
      ? `Reporting displayed in the store's verified Shopify timezone (${resolvedTimezone}).`
      : 'The persisted snapshot uses UTC calendar days until a Shopify store timezone is verified.',
  };
  const comparisonPeriod = healthPeriod ? {
    kind: healthPeriod.comparison?.label || `previous_${days}_days`,
    label: `Previous ${days} days`,
    timezone: resolvedTimezone,
    start: healthPeriod.comparison?.start || null,
    end: healthPeriod.comparison?.end || null,
    comparability: 'same_metric_definition',
  } : {
    kind: 'previous_utc_day',
    label: 'Previous day',
    timezone: resolvedTimezone,
    comparability: snapshot?.revenue_delta_pct === null ? 'unavailable' : 'same_metric_definition',
  };

  const contextStores = stores.map(store => {
    const prof = profileByStoreId.get(store.id);
    const storeState = resourcesByStore.get(store.id);
    const displayName = (prof && typeof prof.shop_name === 'string' && prof.shop_name.trim()) ? prof.shop_name.trim() : store.shop_domain;
    return {
      id: store.id,
      name: store.shop_domain,
      display_name: displayName,
      shop_domain: store.shop_domain,
      platform: store.platform,
      iana_timezone: (prof && typeof prof.iana_timezone === 'string' && prof.iana_timezone.trim()) ? prof.iana_timezone.trim() : null,
      connection_status: storeState ? storeState.overall_status : null,
    };
  });
  const primaryDisplayName = (primaryProfile && typeof primaryProfile.shop_name === 'string' && primaryProfile.shop_name.trim())
    ? primaryProfile.shop_name.trim()
    : primaryStore?.shop_domain || null;

  return {
    contract_version: CONTRACT_VERSION,
    read_only: true,
    retrieved_at: now.toISOString(),
    context: {
      organization_id: organizationId,
      store: primaryStore ? {
        id: primaryStore.id,
        name: primaryStore.shop_domain,
        display_name: primaryDisplayName,
        shop_domain: primaryStore.shop_domain,
        platform: primaryStore.platform,
        iana_timezone: verifiedTimezone,
      } : null,
      stores: contextStores,
      scope: 'organization_business_snapshot',
      currency: (primaryProfile && typeof primaryProfile.currency_code === 'string' ? primaryProfile.currency_code : null)
        || (typeof object(snapshot?.metadata).revenue_currency === 'string' ? object(snapshot.metadata).revenue_currency : null),
      reporting_period: reportingPeriod,
      comparison_period: comparisonPeriod,
    },
    business_state: snapshot ? {
      id: snapshot.id, version: snapshot.schema_version, generated_at: iso(snapshot.generated_at),
      data_freshness_at: iso(snapshot.data_freshness_at), valid_until: iso(snapshot.valid_until),
      computation_status: snapshot.computation_status, presentation_status: status,
      stale: status === 'stale', warnings,
    } : { id: null, version: null, generated_at: null, data_freshness_at: null, valid_until: null, computation_status: 'unavailable', presentation_status: 'unavailable', stale: false, warnings: ['No current business snapshot exists.'] },
    integration: state,
    briefing: composeBriefing({
      snapshot,
      previousSnapshot,
      status,
      state,
      findings,
      presentedFindings,
      resolvedFindings: scopedResolvedFindings,
      operationalActivity,
      warnings,
      reportingPeriod: healthPeriod ? reportingPeriod : null,
      now,
    }),
    metrics: buildMetrics(snapshot, state, status),
    priority_finding: presentedFindings[0] || null,
    priority_selection: {
      method_version: priorityFinding.PRIORITY_METHOD_VERSION,
      eligible_count: priority.candidates.length,
      tie: priority.tie,
      exclusions: priority.excluded.slice(0, 12),
      no_defensible_priority: priority.candidates.length === 0,
      reason: priority.candidates.length
        ? null
        : scopedFindings.length
          ? 'No open finding currently satisfies validity, evidence, freshness and coverage requirements.'
          : signalEvaluation.incomplete
            ? 'Store assessment is incomplete; one or more business signal categories could not be evaluated.'
            : 'No open verified findings are recorded across evaluated business signals; this does not prove the store has no unmeasured issues.',
    },
    signal_evaluation: signalEvaluation,
    findings: presentedFindings,
    business_health: businessHealth,
    operational_activity: operationalActivity,
    activity: [
      ...stores.filter(store => store.sync_completed_at && (!primaryStore || store.id === primaryStore.id)).map(store => ({ id: `sync-${store.id}-${iso(store.sync_completed_at)}`, kind: 'system', type: 'synchronization_completed', label: 'Shopify synchronization completed', store_id: store.id, occurred_at: iso(store.sync_completed_at), note: 'System activity; not a merchant action or business event.' })),
      ...findings.slice(0, 4).map(finding => ({ id: `finding-${finding.id}`, kind: 'business', type: finding.type, finding_id: finding.id, label: finding.title, store_id: finding.store_id, occurred_at: iso(finding.detected_at), note: 'Verified intelligence finding; not a claimed merchant action.' })),
    ].sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()).slice(0, 8),
    evidence: {
      overall: status,
      snapshot_generated_at: iso(snapshot?.generated_at),
      source_data_at: iso(snapshot?.data_freshness_at),
      last_successful_sync_at: iso(primaryStore?.last_synced_at),
      resources: resourceEvidence(primaryStore && state ? [state] : states, domainRows),
      limitations: warnings,
      unknown_semantics: 'Null is unavailable or unverified, never zero. Zero is meaningful only when its source and period are available.',
    },
  };
}

module.exports = {
  CONTRACT_VERSION,
  getCommandCenter,
  prioritizedFindings,
  snapshotStatus,
  buildMetrics,
  composeBriefing,
  selectFeaturedIntelligence,
  composeRecentDevelopments,
  assessBriefingSituation,
  resourceEvidence,
};
