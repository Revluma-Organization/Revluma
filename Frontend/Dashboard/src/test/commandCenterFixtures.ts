import type { CommandCenterData } from "@/components/command-center/types";

// Test-only synthetic contract fixtures. Production modules never import this file.
export const ccMetric = (extra = {}) => ({ id: "net_sales_today", label: "Net sales today", value: 1250, unit: "money", currency: "USD", definition: "Net order value after refunds.", availability: "available", availability_reason: null, reporting_period: { timezone: "UTC" }, zero_semantics: null, ...extra });
export const ccResource = (extra = {}) => ({ store_id: "store-1", resource: "orders", label: "orders", availability: "available", reason: null, freshness: "fresh", last_success_at: "2026-11-08T11:50:00Z", last_attempt_at: "2026-11-08T11:50:00Z", sync_state: "succeeded", limitations: [], coverage: "complete", ...extra });
export const ccFinding = (extra: Record<string, unknown> = {}) => ({
  contract_version: "command-center-priority-finding-v1", id: "finding-1", organization_id: "org-1", store_id: "store-1", category: "business_performance", type: "revenue_change", severity: "high",
  title: "Net sales declined", description: "Recorded net sales declined; the cause is not established.",
  priority: { method_version: "finding-priority-v1", classification: "high", rationale: ["Recorded severity: high.", "Fresh certified evidence."], tie: null },
  reporting_period: { kind: "equal_length_utc_windows", timezone: "UTC", start: null, end: null, current_start: "2026-11-01T00:00:00Z", current_end: "2026-11-08T00:00:00Z", comparison_start: "2026-10-25T00:00:00Z", comparison_end: "2026-11-01T00:00:00Z" },
  detected_at: "2026-11-08T10:00:00Z", last_verified_at: "2026-11-08T11:00:00Z",
  evidence_freshness: { state: "fresh", as_of: "2026-11-08T11:00:00Z", observed_at: "2026-11-08T00:00:00Z", age_seconds: 3600, reason: null },
  coverage: { state: "complete", complete: true, source: "shopify_verified_history_v1", run_id: "run-1" },
  confidence: { classification: "high", rationale: ["Verified source evidence with certified comparison coverage."], numerical_score: null },
  limitations: ["The underlying cause is not established."], unknowns: ["The underlying cause is not established."],
  lifecycle: { state: "open", current_validity: "current_evidence_verified", invalidated: false },
  evidence: { classification: "verified_observation", source: "orders", observations: [{ label: "Current net sales", value: 650, unit: "money", currency: "USD", period: "current", availability: "available" }], references: [{ id: "finding:finding-1", source_type: "intelligence_findings", source_record_id: "finding-1" }], duplicate_finding_ids: [] },
  recommendation: { available: true, step: "Compare order count and average order value for both periods.", rationale: "Locate the recorded change before inferring a cause.", expected_result: "Identify records with the largest verified change.", validation_method: "Repeat over an equivalent period.", prerequisites: [], read_only: true, executed: false },
  investigation: { finding_id: "finding-1", route: "/dashboard/rev-intell?finding=finding-1", context_contract: "rev-selected-finding-v1", revalidate_on_open: true }, read_only: true,
  next_step: { label: "Investigate", route: "/dashboard/rev-intell?finding=finding-1" }, ...extra,
});

export function ccFixture(extra: Partial<CommandCenterData> = {}): CommandCenterData {
  const resources = [
    ccResource(), ccResource({ resource: "inventory.levels", label: "inventory levels" }),
    ccResource({ resource: "abandoned-checkouts", label: "abandoned checkouts", coverage: "not_certified" }),
  ] as CommandCenterData["evidence"]["resources"];
  return {
    contract_version: "command-center-v1", read_only: true, retrieved_at: "2026-11-08T12:00:00Z",
    context: { organization_id: "org-1", store: { id: "store-1", name: "revluma-test-store-v1.myshopify.com", platform: "shopify" }, currency: "USD", reporting_period: { kind: "current_and_previous_utc_day", timezone: "UTC", note: "UTC snapshot" }, comparison_period: { kind: "previous_utc_day", comparability: "same_metric_definition" } },
    business_state: { id: "state-1", version: "1.1", generated_at: "2026-11-08T11:55:00Z", data_freshness_at: "2026-11-08T11:50:00Z", computation_status: "complete", presentation_status: "current", stale: false, warnings: [] },
    integration: null,
    briefing: { headline: "Your latest synchronized business picture", summary: "The current UTC-day snapshot is available.", tone: "default", observation: null, implication: null, evidence_quality: "complete_snapshot", no_findings_note: null, limitations: [], next_investigation: { kind: "explore_evidence", finding_id: null, label: "Explore with Rev", reason: "Investigate available evidence.", route: "/dashboard/rev-intell" } },
    metrics: [ccMetric(), ccMetric({ id: "revenue_change", label: "Day-over-day change", value: -12.5, unit: "percent", currency: null }), ccMetric({ id: "abandoned_checkouts", label: "Open abandoned checkouts", value: 4, unit: "count", currency: null })] as CommandCenterData["metrics"],
    findings: [], priority_finding: null,
    priority_selection: { method_version: "finding-priority-v1", eligible_count: 0, tie: null, exclusions: [], no_defensible_priority: true, reason: "No open verified findings are recorded." },
    activity: [],
    evidence: { overall: "current", snapshot_generated_at: "2026-11-08T11:55:00Z", source_data_at: "2026-11-08T11:50:00Z", last_successful_sync_at: "2026-11-08T11:50:00Z", resources, limitations: [], unknown_semantics: "Null is unavailable, never zero." },
    ...extra,
  };
}

export function ccPriorityFixture(extra: Record<string, unknown> = {}) {
  const primary = ccFinding(extra) as CommandCenterData["findings"][number];
  return ccFixture({ findings: [primary], priority_finding: primary, priority_selection: { method_version: "finding-priority-v1", eligible_count: 1, tie: null, exclusions: [], no_defensible_priority: false, reason: null } });
}
