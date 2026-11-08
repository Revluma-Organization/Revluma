import type { IntegrationState } from "@/lib/integrationState";

export type Availability = "available" | "stale" | "partial" | "unknown" | "not_synchronized" | "unauthorized" | "unsupported" | "retrieval_failed";
export type BusinessMetric = {
  id: string; label: string; value: number | null; unit: "money" | "count" | "percent";
  currency: string | null; definition: string; availability: Availability;
  availability_reason: string | null; reporting_period: { timezone: string };
  zero_semantics: "verified_zero" | "unverified_zero_withheld" | null;
};
export type Finding = {
  contract_version: "command-center-priority-finding-v1";
  id: string; organization_id: string; store_id: string; category: string; type: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string; description: string;
  priority: { method_version: "finding-priority-v1"; classification: string; rationale: string[];
    tie: { finding_ids: string[]; statement: string } | null };
  reporting_period: { kind: string; timezone: string; start: string | null; end: string | null;
    current_start: string | null; current_end: string | null; comparison_start: string | null; comparison_end: string | null };
  detected_at: string; last_verified_at: string | null;
  evidence_freshness: { state: string; as_of: string | null; observed_at: string | null; age_seconds: number | null; reason: string | null };
  coverage: { state: string; complete: boolean; source: string | null; run_id: string | null };
  confidence: { classification: "high" | "moderate" | "low" | "insufficient_evidence" | "unable_to_determine"; rationale: string[]; numerical_score: null };
  limitations: string[]; unknowns: string[];
  lifecycle: { state: string; current_validity: string; invalidated: boolean };
  evidence: { classification: string; source: string;
    observations: { label: string; value: number | string | null; unit: string; currency: string | null; period: string; availability: string }[];
    references: { id: string; source_type: string; source_record_id: string }[]; duplicate_finding_ids: string[] };
  recommendation: { available: boolean; step: string | null; rationale: string | null; expected_result: string | null;
    validation_method: string | null; prerequisites: string[]; lifecycle_state?: string; read_only: true; executed: false };
  investigation: { finding_id: string; route: string; context_contract: "rev-selected-finding-v1"; revalidate_on_open: true };
  read_only: true;
  next_step: { label: string; route: string };
};
export type EvidenceResource = {
  store_id: string; resource: string; label: string; availability: Availability;
  reason: string | null; freshness: string; last_success_at: string | null;
  last_attempt_at: string | null; sync_state: string; limitations: string[]; coverage: string;
};
export type CommandCenterData = {
  contract_version: "command-center-v1"; read_only: true; retrieved_at: string;
  context: {
    organization_id: string;
    store: { id: string; name: string; platform: string } | null;
    currency: string | null;
    reporting_period: { kind: string; timezone: string; note: string };
    comparison_period: { kind: string; comparability: string };
  };
  business_state: {
    id: string | null; version: string | null; generated_at: string | null;
    data_freshness_at: string | null; computation_status: string;
    presentation_status: "current" | "stale" | "partial" | "failed" | "unavailable" | "unknown";
    stale: boolean; warnings: string[];
  };
  integration: IntegrationState | null;
  briefing: {
    headline: string; summary: string; tone: "default" | "attention" | "neutral";
    observation: string | null; implication: string | null; evidence_quality: string;
    no_findings_note: string | null; limitations: string[];
    next_investigation: { kind: string; finding_id: string | null; label: string; reason: string; route: string };
  };
  metrics: BusinessMetric[]; findings: Finding[];
  priority_finding: Finding | null;
  priority_selection: { method_version: "finding-priority-v1"; eligible_count: number;
    tie: Finding["priority"]["tie"]; exclusions: { finding_id: string; title: string; reason: string }[];
    no_defensible_priority: boolean; reason: string | null };
  activity: { id: string; kind: "system" | "business"; type: string; label: string; occurred_at: string; note: string; finding_id?: string }[];
  evidence: {
    overall: string; snapshot_generated_at: string | null; source_data_at: string | null;
    last_successful_sync_at: string | null; resources: EvidenceResource[];
    limitations: string[]; unknown_semantics: string;
  };
};
export type CommandCenterResponse = { success: true; data: CommandCenterData };
