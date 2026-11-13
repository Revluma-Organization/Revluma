'use strict';

/**
 * Read-only decision presentation contract for verified intelligence findings.
 * This module does not retrieve merchant data or execute actions. Authorization
 * and source certification remain with the existing backend services.
 */
const PRIORITY = Object.freeze({ critical: 4, high: 3, medium: 2, low: 1 });
const TYPES = new Set(['integration_failure', 'revenue_change', 'order_volume_change', 'returning_customer_change']);
const MAX_TEXT = 600;
const safeText = value => typeof value === 'string' ? value.slice(0, MAX_TEXT) : '';
const finite = value => typeof value === 'number' && Number.isFinite(value);
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

function buildDecisionBrief(finding, { organizationId, storeIds = [], now = new Date() } = {}) {
  if (!finding || !organizationId || finding.organization_id !== organizationId ||
      !storeIds.includes(finding.store_id) || !TYPES.has(finding.type) ||
      !Object.hasOwn(PRIORITY, finding.severity)) return null;
  const evidence = finding.evidence;
  if (!evidence || evidence.verified !== true) return null;
  const financial = finding.type !== 'integration_failure';
  if (financial && (evidence.complete !== true || !validTime(evidence.currentStart) ||
      !validTime(evidence.currentEnd) || !validTime(evidence.previousStart) ||
      !validTime(evidence.previousEnd) || !finite(evidence.currentCount) ||
      !finite(evidence.previousCount) || evidence.currentCount < 0 ||
      evidence.previousCount < 0 || typeof evidence.currency !== 'string' ||
      !evidence.currency.trim() || !evidence.coverage_run_id ||
      !evidence.coverage_source)) return null;
  const detectedAt = finding.detected_at instanceof Date ? finding.detected_at.toISOString() : finding.detected_at;
  if (!validTime(detectedAt) || Date.parse(detectedAt) > new Date(now).getTime()) return null;
  const stale = financial && Date.parse(evidence.currentEnd) < new Date(now).getTime() - 14 * 86400000;
  const action = finding.action && typeof finding.action === 'object' ? finding.action : {};
  return {
    schema_version: 'revluma-decision-brief-v1',
    finding_id: finding.id,
    store_id: finding.store_id,
    finding_type: finding.type,
    priority: finding.severity,
    priority_rank: PRIORITY[finding.severity],
    headline: safeText(finding.title),
    observation: safeText(finding.description),
    evidence_class: 'verified_observation',
    cause_status: 'not_established',
    data_freshness: stale ? 'historical' : 'as_recorded',
    observed_at: detectedAt,
    reporting_period: financial ? {
      previous_start: evidence.previousStart, previous_end: evidence.previousEnd,
      current_start: evidence.currentStart, current_end: evidence.currentEnd,
      currency: evidence.currency,
    } : null,
    evidence_reference: financial ? { coverage_source: evidence.coverage_source, coverage_run_id: evidence.coverage_run_id } : null,
    suggested_action: {
      label: safeText(action.label),
      guidance: safeText(action.guidance),
      measurement: safeText(action.measurement),
    },
    limitations: [
      'The observed change does not establish its cause.',
      'No recoverable-revenue amount or outcome is guaranteed.',
      ...(stale ? ['The reporting period is historical; recheck current data before acting.'] : []),
    ],
    execution_status: 'advisory_only',
  };
}

function prioritizeDecisionBriefs(briefs) {
  return briefs.filter(Boolean).sort((a, b) =>
    b.priority_rank - a.priority_rank ||
    a.observed_at.localeCompare(b.observed_at) ||
    String(a.finding_id).localeCompare(String(b.finding_id)));
}

module.exports = { buildDecisionBrief, prioritizeDecisionBriefs };
