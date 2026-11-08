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

function limitationsFor(finding, freshness, resource) {
  const evidence = object(finding.evidence);
  const limits = [];
  if (finding.type !== 'integration_failure') limits.push('The observed change does not establish its underlying cause.');
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
    confidence = freshness.state === 'fresh' && evidence.coverage_run_id ? 'high' : 'moderate';
    confidenceReasons.push('Verified source evidence with certified comparison coverage.');
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
  return [SEVERITY[finding.severity] ?? 4,
    { fresh: 0, aging: 1, stale: 2, unknown: 3 }[assessment.freshness.state] ?? 3,
    hasMeasuredSample ? 0 : 1,
    -(timestamp(finding.updated_at) || timestamp(finding.detected_at) || 0),
    String(finding.id)];
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
    const resourceId = entry.finding.type === 'refund_increase' ? 'order.refunds' : entry.finding.type === 'integration_failure' ? null : 'orders';
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
};
function recommendationForFinding(finding, assessment) {
  const template = RECOMMENDATIONS[finding.type];
  if (!template) return { available: false, step: null, rationale: null, expected_result: null, validation_method: null,
    prerequisites: ['A finding-specific recommendation is unavailable. Review the authoritative evidence before deciding what to do.'], read_only: true, executed: false };
  const current = assessment.eligible;
  return { contract_version: RECOMMENDATION_CONTRACT_VERSION, available: current,
    step: current ? template[0] : null, rationale: current ? template[1] : null,
    expected_result: current ? 'Identify whether the observed change is concentrated in particular records and whether any independently recorded operational issue explains the pattern.' : null,
    validation_method: current ? template[2] : null,
    prerequisites: current ? [] : ['Restore fresh, verified source evidence before treating this as a current recommendation.'],
    lifecycle_state: current ? 'presented' : 'invalidated', read_only: true, executed: false, execution_status: 'not_requested' };
}

function observationFor(finding) {
  const e = object(finding.evidence);
  const money = (value, label, period) => ({ label, value: finite(value), unit: 'money', currency: text(e.currency, 3), period, availability: finite(value) === null || !e.currency ? 'unknown' : 'available' });
  const count = (value, label, period) => ({ label, value: finite(value), unit: 'count', currency: null, period, availability: finite(value) === null ? 'unknown' : 'available' });
  if (finding.type === 'revenue_change') return [money(e.currentRevenue, 'Current net sales', 'current'), money(e.previousRevenue, 'Previous net sales', 'comparison'), count(e.currentCount, 'Current completed orders', 'current'), count(e.previousCount, 'Previous completed orders', 'comparison')];
  if (finding.type === 'refund_increase') return [money(e.currentRefundTotal, 'Current refund value', 'current'), money(e.previousRefundTotal, 'Previous refund value', 'comparison'), count(e.currentCount, 'Current refund transactions', 'current'), count(e.previousCount, 'Previous refund transactions', 'comparison')];
  if (finding.type === 'order_volume_change') return [count(e.currentCount, 'Current completed orders', 'current'), count(e.previousCount, 'Previous completed orders', 'comparison')];
  if (finding.type === 'returning_customer_change') return [count(e.currentReturning, 'Current returning buyers', 'current'), count(e.previousReturning, 'Previous returning buyers', 'comparison'), count(e.currentCount, 'Current purchasing customers', 'current'), count(e.previousCount, 'Previous purchasing customers', 'comparison')];
  if (finding.type === 'integration_failure') return [{ label: 'Recorded store status', value: text(e.status, 50), unit: 'status', currency: null, period: 'observation', availability: text(e.status, 50) ? 'available' : 'unknown' }, { label: 'Failed webhook registrations', value: finite(e.failed_webhook_registrations), unit: 'count', currency: null, period: 'observation', availability: finite(e.failed_webhook_registrations) === null ? 'unknown' : 'available' }];
  return [];
}

function presentPriorityFinding(entry, organizationId) {
  if (!entry) return null;
  const { finding, assessment, duplicates } = entry;
  const evidence = object(finding.evidence);
  const references = [{ id: `finding:${finding.id}`, source_type: 'intelligence_findings', source_record_id: finding.id }];
  if (evidence.coverage_run_id) references.push({ id: `order-coverage:${evidence.coverage_run_id}`, source_type: evidence.coverage_source || 'order_coverage', source_record_id: evidence.coverage_run_id });
  if (finding.type === 'integration_failure') references.push({ id: `store:${finding.store_id}`, source_type: 'stores', source_record_id: finding.store_id });
  return {
    contract_version: CONTRACT_VERSION, id: finding.id, organization_id: organizationId, store_id: finding.store_id,
    category: finding.type === 'integration_failure' ? 'data_readiness' : 'business_performance', type: finding.type,
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
