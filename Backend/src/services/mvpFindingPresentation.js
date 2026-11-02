'use strict';

/**
 * MVP finding presentation. Never infer monetary loss or root cause from a
 * revenue delta: it is an observation, not proof of preventable loss.
 * Priorities are deterministic and only use server-verified evidence.
 */
const SEVERITY = Object.freeze({ critical: 3, high: 2, medium: 1, low: 0 });
function presentFinding(finding) {
  const evidence = finding.evidence && typeof finding.evidence === 'object' ? finding.evidence : {};
  const verified = evidence.verified === true;
  const severity = Object.prototype.hasOwnProperty.call(SEVERITY, finding.severity)
    ? finding.severity : 'low';
  const integration = finding.type === 'integration_failure';
  const priority = !verified ? 'unverified' : integration ? 'high' :
    severity === 'critical' || severity === 'high' ? 'high' :
    severity === 'medium' ? 'medium' : 'low';
  const confidence = !verified ? 'insufficient_evidence' :
    integration ? 'verified_operational_status' :
    evidence.complete === true ? 'verified_comparison' : 'limited_evidence';
  const explanation = !verified
    ? 'The evidence for this finding has not been verified. Do not act on it as a confirmed diagnosis.'
    : integration
      ? 'Store connection or synchronization issues can make commerce reporting incomplete. Restore reliable data collection before interpreting revenue trends.'
      : finding.type === 'revenue_change'
        ? 'Revenue changed between comparable periods. This does not establish the cause or prove that the difference is recoverable.'
        : finding.type === 'returning_customer_change'
          ? 'The share of returning customers changed between verified periods. The underlying cause is not yet known.'
          : 'Review the verified evidence before taking action.';
  const measure = integration
    ? { metric: 'successful_store_sync', method: 'Verify the next completed sync and webhook registration statuses.' }
    : finding.type === 'revenue_change'
      ? { metric: 'revenue_by_comparable_period', method: 'Compare equal-length periods in the same currency after recording the action; do not assume causation.' }
      : finding.type === 'returning_customer_change'
        ? { metric: 'returning_customer_purchase_share', method: 'Compare verified returning-buyer shares across equal-length periods.' }
        : { metric: 'finding_status', method: 'Record the action and review the finding after new evidence arrives.' };
  return {
    ...finding,
    mvp_assessment: {
      priority,
      confidence,
      explanation,
      estimated_recoverable_revenue: null,
      measurement: measure,
      recommended_action: finding.action || null,
    },
  };
}
function presentFindings(findings) {
  const order = { high: 0, medium: 1, low: 2, unverified: 3 };
  return findings.map(presentFinding).sort((a, b) =>
    order[a.mvp_assessment.priority] - order[b.mvp_assessment.priority] ||
    String(b.detected_at || '').localeCompare(String(a.detected_at || '')));
}
module.exports = { presentFinding, presentFindings };
