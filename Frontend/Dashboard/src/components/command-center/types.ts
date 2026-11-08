import type { IntegrationState } from "@/lib/integrationState";

export type Availability = "available" | "stale" | "partial" | "unknown" | "not_synchronized" | "unauthorized" | "unsupported" | "retrieval_failed";
export type BusinessMetric = {
  id: string; label: string; value: number | null; unit: "money" | "count" | "percent";
  currency: string | null; definition: string; availability: Availability;
  availability_reason: string | null; reporting_period: { timezone: string };
  zero_semantics: "verified_zero" | "unverified_zero_withheld" | null;
};
export type Finding = {
  id: string; store_id: string; type: string; severity: "critical" | "high" | "medium" | "low";
  title: string; description: string; detected_at: string; evidence_quality: string;
  evidence: Record<string, unknown>; action?: { label?: string; route?: string } | null;
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
  activity: { id: string; kind: "system" | "business"; type: string; label: string; occurred_at: string; note: string }[];
  evidence: {
    overall: string; snapshot_generated_at: string | null; source_data_at: string | null;
    last_successful_sync_at: string | null; resources: EvidenceResource[];
    limitations: string[]; unknown_semantics: string;
  };
};
export type CommandCenterResponse = { success: true; data: CommandCenterData };
