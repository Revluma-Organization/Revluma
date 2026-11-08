// Task 220 — shared Command Center test fixture (findings-free by default),
// reused by the runtime and viewport test files so the page-level section
// markup renders deterministically. Values are illustrative test data only;
// they must not collide with assertions in other test files.
import type { CommandCenterData } from "./types";

export const ccMetric = (extra: Record<string, unknown> = {}): CommandCenterData["metrics"][number] =>
  ({ id: "net_sales_today", label: "Net sales today", value: 18420, unit: "money", currency: "USD", definition: "Order totals net of refunds.", availability: "available", availability_reason: null, reporting_period: { timezone: "UTC" }, zero_semantics: null, ...extra }) as CommandCenterData["metrics"][number];

export const ccResource = (extra: Record<string, unknown> = {}): CommandCenterData["evidence"]["resources"][number] =>
  ({ store_id: "store-1", resource: "orders", label: "orders", availability: "available", reason: null, freshness: "fresh", last_success_at: "2026-11-08T11:50:00Z", last_attempt_at: "2026-11-08T11:50:00Z", sync_state: "succeeded", limitations: [], coverage: "complete", ...extra }) as CommandCenterData["evidence"]["resources"][number];

export const commandCenterFixture = (extra: Partial<CommandCenterData> = {}): CommandCenterData => ({
  contract_version: "command-center-v1", read_only: true, retrieved_at: "2026-11-08T12:00:00Z",
  context: { organization_id: "merchant-a", store: { id: "store-1", name: "revluma-test-store-v1.myshopify.com", platform: "shopify" }, currency: "USD", reporting_period: { kind: "current_and_previous_utc_day", timezone: "UTC", note: "UTC snapshot" }, comparison_period: { kind: "previous_utc_day", comparability: "same_metric_definition" } },
  business_state: { id: "state-1", version: "1.1", generated_at: "2026-11-08T11:55:00Z", data_freshness_at: "2026-11-08T11:50:00Z", computation_status: "complete", presentation_status: "current", stale: false, warnings: [] },
  integration: null,
  briefing: { headline: "Your latest synchronized business picture", summary: "The current UTC-day snapshot is available.", tone: "default", observation: null, implication: null, evidence_quality: "complete_snapshot", no_findings_note: "No open verified priority findings are recorded. This is not proof that no issue exists.", limitations: [], next_investigation: { kind: "explore_evidence", finding_id: null, label: "Explore the evidence with Rev", reason: "Investigate available order and checkout evidence.", route: "/dashboard/rev-intell" } },
  metrics: [ccMetric()], findings: [], activity: [],
  priority_finding: null,
  priority_selection: { method_version: "finding-priority-v1", eligible_count: 0, tie: null, exclusions: [], no_defensible_priority: true, reason: "No open verified findings are recorded." },
  evidence: { overall: "current", snapshot_generated_at: "2026-11-08T11:55:00Z", source_data_at: "2026-11-08T11:50:00Z", last_successful_sync_at: "2026-11-08T11:50:00Z", resources: [ccResource()], limitations: [], unknown_semantics: "Null is never zero." },
  ...extra,
});
