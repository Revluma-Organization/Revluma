// Task 218 — typed projections of the canonical backend contracts
// (rev-business-health-v1 + rev-operational-activity-v1) plus the closed
// label/tone maps. The backend is the source of truth; the frontend only
// renders these — it never recomputes a metric.
//
// Design direction: business STATUS uses green/red/amber. Data quality is a
// SEPARATE axis and is shown with neutral tones so it is never conflated with
// business health.

export type BusinessStatus =
  | "healthy"
  | "attention"
  | "deteriorating"
  | "critical"
  | "insufficient_history";

export type DataQuality =
  | "complete"
  | "partial"
  | "stale"
  | "unknown"
  | "unavailable"
  | "unsupported";

export type IndicatorCategory =
  | "revenue"
  | "orders"
  | "checkouts"
  | "product_availability"
  | "integration";

export interface BusinessIndicator {
  id: string;
  category: IndicatorCategory;
  status: BusinessStatus;
  data_quality: DataQuality;
  title: string;
  explanation: string;
  value: number | string | null;
  comparison_value: number | null;
  change_pct: number | null;
  metric_definition: string | null;
  currency: string | null;
  reporting_period: { label: string; start: string | null; end: string | null } | null;
  comparison_period: { label: string; start: string | null; end: string | null } | null;
  timezone: string | null;
  source_evidence: string[];
  last_verified_at: string | null;
  freshness: DataQuality;
  coverage: {
    complete: boolean;
    data_quality: DataQuality;
    reason: string;
    domains: Array<{ domain: string; state: string; freshness: string; usable: boolean; last_succeeded_at: string | null }>;
  };
  confidence: number | null;
  limitations: string[];
  next_step: string | null;
  status_changed_at: string;
  value_components: Record<string, unknown> | null;
  conversion_rate?: number | null;
}

export interface BusinessHealthContract {
  contract_version: string;
  organization_id: string;
  store_id: string;
  shop_domain: string | null;
  generated_at: string;
  reporting_period: {
    current: { label: string; start: string | null; end: string | null };
    comparison: { label: string; start: string | null; end: string | null } | null;
    timezone: string;
    period_basis: string;
    note?: string;
  };
  business_status: BusinessStatus;
  business_status_explanation: string;
  indicators: BusinessIndicator[];
  by_category: Record<string, BusinessIndicator>;
  data_quality: Record<DataQuality, string[]>;
  affected_indicators_note: string[] | null;
}

export type ActivitySeverity = "critical" | "warning" | "attention" | "info";

export interface ActivityItem {
  event_id: string;
  type: string;
  category: string;
  severity: ActivitySeverity;
  title: string;
  detail: string;
  status: string | null;
  occurred_at: string;
  received_at: string;
  source: string;
  link: string | null;
}

export interface OperationalActivityContract {
  contract_version: string;
  organization_id: string;
  store_id: string;
  shop_domain: string | null;
  generated_at: string;
  window_days: number;
  total: number;
  returned: number;
  has_more: boolean;
  next_cursor: string | null;
  limit: number;
  items: ActivityItem[];
}

// ── Labels ─────────────────────────────────────────────────────────────────

export const BUSINESS_STATUS_LABEL: Record<BusinessStatus, string> = {
  healthy: "Healthy",
  attention: "Attention",
  deteriorating: "Deteriorating",
  critical: "Critical",
  insufficient_history: "Insufficient history",
};

export const DATA_QUALITY_LABEL: Record<DataQuality, string> = {
  complete: "Complete data",
  partial: "Partial data",
  stale: "Stale data",
  unknown: "Unknown coverage",
  unavailable: "Data unavailable",
  unsupported: "Unsupported",
};

export const CATEGORY_LABEL: Record<IndicatorCategory, string> = {
  revenue: "Revenue",
  orders: "Orders",
  checkouts: "Checkouts",
  product_availability: "Product availability",
  integration: "Integration & sync",
};

export const ACTIVITY_SEVERITY_LABEL: Record<ActivitySeverity, string> = {
  critical: "Critical",
  warning: "Warning",
  attention: "Attention",
  info: "Info",
};

export const ACTIVITY_TYPE_LABEL: Record<string, string> = {
  finding: "Finding",
  integration_change: "Integration",
  webhook: "Webhook",
  sync: "Synchronization",
};

// ── Tones (Tailwind class fragments) ───────────────────────────────────────
// Business status: green (healthy) / amber (attention, deteriorating) / red
// (critical). Insufficient history is a neutral "no state asserted" tone — it
// is NOT rendered as a problem color.

export const BUSINESS_STATUS_TONE: Record<BusinessStatus, { badge: string; dot: string; ring: string }> = {
  healthy: { badge: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300", dot: "bg-emerald-500", ring: "border-emerald-200 dark:border-emerald-900" },
  attention: { badge: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300", dot: "bg-amber-500", ring: "border-amber-200 dark:border-amber-900" },
  deteriorating: { badge: "bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300", dot: "bg-orange-500", ring: "border-orange-200 dark:border-orange-900" },
  critical: { badge: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300", dot: "bg-red-500", ring: "border-red-200 dark:border-red-900" },
  insufficient_history: { badge: "bg-[#eef1f6] text-[#5b6a80] dark:bg-[#1f1f1f] dark:text-[#a5b7d1]", dot: "bg-[#9aa7b8]", ring: "border-[#e3e8f0] dark:border-[#333333]" },
};

// Data quality is a distinct, neutral axis — never green/red.
export const DATA_QUALITY_TONE: Record<DataQuality, string> = {
  complete: "bg-[#eef4ff] text-[#0868ed] dark:bg-[#12233b] dark:text-[#86b5ff]",
  partial: "bg-[#f4f6fa] text-[#5b6a80] dark:bg-[#1f1f1f] dark:text-[#a5b7d1]",
  stale: "bg-[#f4f6fa] text-[#5b6a80] dark:bg-[#1f1f1f] dark:text-[#a5b7d1]",
  unknown: "bg-[#f4f6fa] text-[#5b6a80] dark:bg-[#1f1f1f] dark:text-[#a5b7d1]",
  unavailable: "bg-[#f4f6fa] text-[#7a8699] dark:bg-[#1a1a1a] dark:text-[#8a97ab]",
  unsupported: "bg-[#f4f6fa] text-[#7a8699] dark:bg-[#1a1a1a] dark:text-[#8a97ab]",
};

export const ACTIVITY_SEVERITY_DOT: Record<ActivitySeverity, string> = {
  critical: "bg-red-500",
  warning: "bg-amber-500",
  attention: "bg-amber-400",
  info: "bg-[#0868ed]",
};

// ── Fail-closed contract guards ────────────────────────────────────────────
// The panels are pure consumers: a response that does not match the closed
// contract is treated as "unavailable" (honest static state), never rendered
// speculatively and never allowed to crash the page. This also protects the
// panels from unrelated payloads (e.g. a page-level test mock that answers
// every route with the command-center fixture).

export const BUSINESS_HEALTH_CONTRACT_VERSION = "rev-business-health-v1";
export const OPERATIONAL_ACTIVITY_CONTRACT_VERSION = "rev-operational-activity-v1";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const BUSINESS_STATUSES: readonly string[] = ["healthy", "attention", "deteriorating", "critical", "insufficient_history"];
const DATA_QUALITIES: readonly string[] = ["complete", "partial", "stale", "unknown", "unavailable", "unsupported"];
const CATEGORIES: readonly string[] = ["revenue", "orders", "checkouts", "product_availability", "integration"];
const SEVERITIES: readonly string[] = ["critical", "warning", "attention", "info"];

export function isValidBusinessIndicator(v: unknown): v is BusinessIndicator {
  if (!isRecord(v)) return false;
  if (typeof v.id !== "string" || v.id.length === 0) return false;
  if (typeof v.title !== "string" || typeof v.explanation !== "string") return false;
  if (!BUSINESS_STATUSES.includes(String(v.status))) return false;
  if (!DATA_QUALITIES.includes(String(v.data_quality))) return false;
  if (!CATEGORIES.includes(String(v.category))) return false;
  if (v.value !== null && typeof v.value !== "number" && typeof v.value !== "string") return false;
  if (v.change_pct !== null && (typeof v.change_pct !== "number" || !Number.isFinite(v.change_pct as number))) return false;
  if (!isRecord(v.coverage) || typeof v.coverage.reason !== "string") return false;
  if (!Array.isArray(v.limitations) || !Array.isArray(v.source_evidence)) return false;
  return true;
}

export function isValidBusinessHealth(v: unknown): v is BusinessHealthContract {
  if (!isRecord(v)) return false;
  if (v.contract_version !== BUSINESS_HEALTH_CONTRACT_VERSION) return false;
  if (typeof v.store_id !== "string" || v.store_id.length === 0) return false;
  if (!BUSINESS_STATUSES.includes(String(v.business_status))) return false;
  if (typeof v.business_status_explanation !== "string") return false;
  if (!Array.isArray(v.indicators) || v.indicators.length !== CATEGORIES.length) return false;
  if (!v.indicators.every(isValidBusinessIndicator)) return false;
  const rp = v.reporting_period;
  if (!isRecord(rp) || !isRecord(rp.current) || typeof rp.current.label !== "string") return false;
  return true;
}

export function isValidActivityItem(v: unknown): v is ActivityItem {
  if (!isRecord(v)) return false;
  if (typeof v.event_id !== "string" || v.event_id.length === 0) return false;
  if (typeof v.type !== "string" || typeof v.title !== "string") return false;
  if (!SEVERITIES.includes(String(v.severity))) return false;
  if (typeof v.occurred_at !== "string" || !Number.isFinite(Date.parse(v.occurred_at))) return false;
  if (typeof v.received_at !== "string" || !Number.isFinite(Date.parse(v.received_at))) return false;
  return true;
}

export function isValidOperationalActivity(v: unknown): v is OperationalActivityContract {
  if (!isRecord(v)) return false;
  if (v.contract_version !== OPERATIONAL_ACTIVITY_CONTRACT_VERSION) return false;
  if (typeof v.total !== "number" || typeof v.window_days !== "number" || typeof v.has_more !== "boolean") return false;
  if (v.next_cursor !== null && typeof v.next_cursor !== "string") return false;
  if (!Array.isArray(v.items)) return false;
  if (!v.items.every(isValidActivityItem)) return false;
  return true;
}
