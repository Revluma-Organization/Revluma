'use strict';

// Task 216 — read-only operational briefing over the authoritative business
// snapshot. This service never recomputes commerce metrics and never invokes
// a language model. It presents only values already persisted by the Python
// business-state builder and findings verified by the intelligence pipeline.

const { retrieveIntegrationStates } = require('./revIntegrationState');
const { RESOURCE_BY_ID } = require('./revIntegrationEvidenceService');
const { listFindings } = require('./intelligenceFindingsRepository');
const priorityFinding = require('./priorityFindingService');
const { buildBusinessHealth, validateBusinessHealth } = require('./businessHealth');
const { fetchBusinessHealthBundle } = require('./businessHealthRepository');
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

function composeBriefing({ snapshot, status, state, findings, warnings }) {
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
  } else if (!state || ['disconnected', 'authorization_required', 'authorization_expired', 'authorization_revoked'].includes(integrationStatus)) {
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
    summary = 'The current UTC-day snapshot is available. Review the supporting indicators and verified findings for developments that deserve investigation.';
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

  return {
    headline, summary, tone,
    observation: primary ? 'This priority finding was verified by the intelligence pipeline. Its evidence establishes the observation, not an unrecorded cause.' : null,
    implication: primary ? 'Review the finding evidence to understand the affected business area and the limits of the conclusion.' : null,
    evidence_quality: status === 'current' && snapshot?.computation_status === 'complete' ? 'complete_snapshot' : status,
    no_findings_note: !primary && snapshot ? 'No open verified priority findings are recorded. This is not proof that no issue exists outside the checks and evidence available to Revluma.' : null,
    limitations: [...new Set(limitations.filter(Boolean))].slice(0, 12),
    next_investigation: next,
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

async function getCommandCenter({ prisma, organizationId, now = new Date() }) {
  const [snapshot, states, rawFindings, stores] = await Promise.all([
    prisma.business_states.findFirst({ where: { organization_id: organizationId, is_current: true } }),
    retrieveIntegrationStates({ prisma, organizationId, now }),
    listFindings(prisma, organizationId, { status: 'active', limit: 100 }),
    prisma.stores.findMany({ where: { organization_id: organizationId }, select: { id: true, shop_domain: true, platform: true, last_synced_at: true, sync_completed_at: true }, orderBy: { last_synced_at: 'desc' } }),
  ]);
  const storeIds = stores.map(store => store.id);
  const domainRows = storeIds.length ? await prisma.store_sync_domain_states.findMany({ where: { store_id: { in: storeIds } } }) : [];
  const status = snapshotStatus(snapshot, now);
  const primaryStore = stores[0] || null;
  const state = states.find(item => item.store.id === primaryStore?.id) || null;
  const resourcesByStore = new Map(states.map(item => [item.store.id, item]));
  const priority = priorityFinding.prioritizedFindings(rawFindings, { now, resourcesByStore });
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
    fetchBusinessHealthBundle(prisma, organizationId, primaryStore.id, now, state),
    fetchOperationalActivityBundle(prisma, organizationId, primaryStore.id, now),
  ]) : [null, null];
  const businessHealth = healthBundle ? buildBusinessHealth(healthBundle, now) : null;
  const operationalActivity = activityBundle ? buildOperationalActivityFeed(activityBundle, now, 20, null) : null;
  if (businessHealth && !validateBusinessHealth(businessHealth)) throw new Error('Business health contract validation failed.');
  if (operationalActivity && !validateOperationalActivity(operationalActivity)) throw new Error('Operational activity contract validation failed.');
  return {
    contract_version: CONTRACT_VERSION,
    read_only: true,
    retrieved_at: now.toISOString(),
    context: {
      organization_id: organizationId,
      store: primaryStore ? { id: primaryStore.id, name: primaryStore.shop_domain, platform: primaryStore.platform } : null,
      scope: 'organization_business_snapshot',
      currency: typeof object(snapshot?.metadata).revenue_currency === 'string' ? object(snapshot.metadata).revenue_currency : null,
      reporting_period: { kind: 'current_and_previous_utc_day', timezone: 'UTC', start: null, end: null, note: 'The persisted snapshot uses UTC calendar days, not a merchant-local monthly reporting period.' },
      comparison_period: { kind: 'previous_utc_day', timezone: 'UTC', comparability: snapshot?.revenue_delta_pct === null ? 'unavailable' : 'same_metric_definition' },
    },
    business_state: snapshot ? {
      id: snapshot.id, version: snapshot.schema_version, generated_at: iso(snapshot.generated_at),
      data_freshness_at: iso(snapshot.data_freshness_at), valid_until: iso(snapshot.valid_until),
      computation_status: snapshot.computation_status, presentation_status: status,
      stale: status === 'stale', warnings,
    } : { id: null, version: null, generated_at: null, data_freshness_at: null, valid_until: null, computation_status: 'unavailable', presentation_status: 'unavailable', stale: false, warnings: ['No current business snapshot exists.'] },
    integration: state,
    briefing: composeBriefing({ snapshot, status, state, findings, warnings }),
    metrics: buildMetrics(snapshot, state, status),
    priority_finding: presentedFindings[0] || null,
    priority_selection: {
      method_version: priorityFinding.PRIORITY_METHOD_VERSION,
      eligible_count: priority.candidates.length,
      tie: priority.tie,
      exclusions: priority.excluded.slice(0, 12),
      no_defensible_priority: priority.candidates.length === 0,
      reason: priority.candidates.length ? null : rawFindings.length ? 'No open finding currently satisfies validity, evidence, freshness and coverage requirements.' : 'No open verified findings are recorded; this does not establish that no business problem exists.',
    },
    findings: presentedFindings,
    business_health: businessHealth,
    operational_activity: operationalActivity,
    activity: [
      ...stores.filter(store => store.sync_completed_at).map(store => ({ id: `sync-${store.id}-${iso(store.sync_completed_at)}`, kind: 'system', type: 'synchronization_completed', label: 'Shopify synchronization completed', store_id: store.id, occurred_at: iso(store.sync_completed_at), note: 'System activity; not a merchant action or business event.' })),
      ...findings.slice(0, 4).map(finding => ({ id: `finding-${finding.id}`, kind: 'business', type: finding.type, finding_id: finding.id, label: finding.title, store_id: finding.store_id, occurred_at: iso(finding.detected_at), note: 'Verified intelligence finding; not a claimed merchant action.' })),
    ].sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()).slice(0, 8),
    evidence: {
      overall: status,
      snapshot_generated_at: iso(snapshot?.generated_at),
      source_data_at: iso(snapshot?.data_freshness_at),
      last_successful_sync_at: iso(primaryStore?.last_synced_at),
      resources: resourceEvidence(states, domainRows),
      limitations: warnings,
      unknown_semantics: 'Null is unavailable or unverified, never zero. Zero is meaningful only when its source and period are available.',
    },
  };
}

module.exports = { CONTRACT_VERSION, getCommandCenter, prioritizedFindings, snapshotStatus, buildMetrics, composeBriefing, resourceEvidence };
