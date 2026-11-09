// src/lib/integrationProgress.ts
// Task 215 — authoritative sync-progress contract (rev-sync-progress-v1) for the UI.
//
// The browser is a PURE CONSUMER of this contract. It is evaluated server-side
// from the persisted execution ledger and never inferred, incremented, or
// estimated locally. This module normalizes the contract FAIL-CLOSED: an
// invalid, stale-shaped, or missing block yields `null` so the caller can
// render an honest "unknown" state — it never renders a fabricated percentage
// or a premature 100%.

export const SYNC_PROGRESS_CONTRACT_VERSION = "rev-sync-progress-v1";

export const SYNC_JOB_STATUSES = [
  "idle", "queued", "running", "stalled", "completed", "partial", "failed", "unavailable",
] as const;
export type SyncJobStatus = (typeof SYNC_JOB_STATUSES)[number];

export const SYNC_DOMAIN_STATUSES = ["never_run", "running", "ok", "degraded", "failed"] as const;
export type SyncDomainStatus = (typeof SYNC_DOMAIN_STATUSES)[number];

export interface SyncFailure {
  category: string;
  reason_code: string;
  auto_retry_eligible: boolean;
  manual_retry_eligible: boolean;
  backoff_exhausted: boolean;
  attempt: number;
  max_auto_attempts: number;
  next_eligible_at: string | null;
  retry_window_elapsed: boolean | null;
  merchant_action_required: boolean;
  next_step: string;
  error_code: string | null;
}

export interface SyncDomainProgress {
  domain: string;
  required: boolean;
  status: SyncDomainStatus;
  work: {
    total_units: number | null;
    completed_units: number;
    failed_units: number;
    remaining_units: number | null;
    total_known: boolean;
  };
  records: {
    discovered: number;
    persisted: number;
    pages_completed: number | null;
    pagination_complete: boolean;
  };
  checkpoint_available: boolean;
  error_code: string | null;
  percent: number | null;
  failure: SyncFailure | null;
}

export interface SyncRetrySummary {
  actionable: boolean;
  scope?: string;
  category?: string;
  reason_code?: string | null;
  retry_eligible?: boolean;
  manual_retry_eligible?: boolean;
  merchant_action_required?: boolean;
  next_step?: string;
  next_eligible_at?: string | null;
  attempt?: number;
  max_auto_attempts?: number;
  backoff_exhausted?: boolean;
}

export interface SyncStoreStatusLimitation {
  domain: string;
  required: boolean;
  status: string;
  coverage: string;
  detail: string | null;
}

// The canonical store status derived from the FULL domain ledger (all 35
// domains) — deliberately separate from the 9-domain job progress contract, so a
// sync whose tracked resources all succeeded but an extended resource failed can
// still be shown as "completed with limitations" rather than a bare "Complete".
export interface SyncStoreStatus {
  status: string;
  reason: string | null;
  limitations: SyncStoreStatusLimitation[];
}

export interface SyncProgress {
  contract_version: string;
  store: { id: string | null; shop_domain: string | null };
  job: {
    id: string | null;
    status: SyncJobStatus;
    reason: string;
    started_at: string | null;
    updated_at: string | null;
    completed_at: string | null;
    heartbeat_at: string | null;
    stalled: boolean;
    stall_threshold_seconds: number;
  };
  overall: {
    stage: string;
    work: {
      total_units: number | null;
      completed_units: number;
      failed_units: number;
      remaining_units: number | null;
      total_known: boolean;
    };
    records: { retrieved: number; persisted: number };
    measurable: boolean;
    estimated: boolean;
    percent: number | null;
  };
  domains: SyncDomainProgress[];
  retry: SyncRetrySummary;
  /** Optional for backward compatibility: older contracts omit it, in which case
   *  the UI simply does not render the limitations block. */
  store_status?: SyncStoreStatus;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

const isBool = (v: unknown): v is boolean => typeof v === "boolean";

const isStrOrNull = (v: unknown): v is string | null =>
  v === null || typeof v === "string";

const isPct = (v: unknown): v is number | null =>
  v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100);

// Fail-closed: return the contract only if it is well-formed. Any violation
// (wrong version, bad status, out-of-range percent, premature 100%, a percent
// without a stable denominator, or a missing field) yields null.
export function normalizeSyncProgress(raw: unknown): SyncProgress | null {
  if (!isObj(raw)) return null;
  if (raw.contract_version !== SYNC_PROGRESS_CONTRACT_VERSION) return null;

  const store = raw.store;
  if (!isObj(store) || !isStrOrNull(store.id) || !isStrOrNull(store.shop_domain)) return null;

  const job = raw.job;
  if (!isObj(job) || !isStrOrNull(job.id) || typeof job.reason !== "string") return null;
  if (!SYNC_JOB_STATUSES.includes(job.status as SyncJobStatus)) return null;
  if (!isStrOrNull(job.started_at) || !isStrOrNull(job.updated_at) || !isStrOrNull(job.completed_at)) return null;
  if (!isStrOrNull(job.heartbeat_at) || !isBool(job.stalled) || !isInt(job.stall_threshold_seconds)) return null;

  const overall = raw.overall;
  if (!isObj(overall) || typeof overall.stage !== "string") return null;
  if (!isObj(overall.work) || !isBool(overall.work.total_known)) return null;
  if (!isInt(overall.work.completed_units) || !isInt(overall.work.failed_units)) return null;
  if (overall.work.total_units !== null && !isInt(overall.work.total_units)) return null;
  if (overall.work.remaining_units !== null && !isInt(overall.work.remaining_units)) return null;
  if (!isObj(overall.records) || !isInt(overall.records.retrieved) || !isInt(overall.records.persisted)) return null;
  if (!isBool(overall.measurable) || !isBool(overall.estimated)) return null;
  if (!isPct(overall.percent)) return null;
  // Truthfulness rules enforced in the browser too (defense in depth):
  if (overall.percent !== null && overall.measurable === false) return null;
  if (overall.percent === 100 && job.status !== "completed") return null;

  const domains = raw.domains;
  if (!Array.isArray(domains) || domains.length === 0) return null;
  for (const d of domains) {
    if (!isObj(d)) return null;
    if (typeof d.domain !== "string" || !isBool(d.required)) return null;
    if (!SYNC_DOMAIN_STATUSES.includes(d.status as SyncDomainStatus)) return null;
    if (!isObj(d.work) || !isBool(d.work.total_known)) return null;
    if (!isInt(d.work.completed_units) || !isInt(d.work.failed_units)) return null;
    if (d.work.total_units !== null && !isInt(d.work.total_units)) return null;
    if (!isPct(d.percent)) return null;
    if (d.percent === 100 && d.status !== "ok") return null;
    if (d.work.total_known === false && d.work.total_units !== null) return null;
    if (d.failure !== null) {
      const f = d.failure;
      if (!isObj(f) || typeof f.category !== "string" || typeof f.reason_code !== "string") return null;
      if (!isBool(f.auto_retry_eligible) || !isBool(f.manual_retry_eligible)) return null;
      if (!isBool(f.merchant_action_required) || typeof f.next_step !== "string") return null;
    }
  }

  const retry = raw.retry;
  if (!isObj(retry) || !isBool(retry.actionable)) return null;

  // Canonical store status (Task 229 §5 #3) — optional; validated fail-closed when
  // present so a malformed block yields null (an honest unknown), never a
  // fabricated "complete".
  const storeStatus = raw.store_status;
  if (storeStatus !== undefined) {
    if (!isObj(storeStatus) || typeof storeStatus.status !== "string" || storeStatus.status.length === 0) return null;
    if (storeStatus.reason !== null && typeof storeStatus.reason !== "string") return null;
    if (!Array.isArray(storeStatus.limitations)) return null;
    for (const l of storeStatus.limitations) {
      if (!isObj(l) || typeof l.domain !== "string" || typeof l.status !== "string") return null;
      if (!isBool(l.required) || typeof l.coverage !== "string") return null;
      if (l.detail !== null && typeof l.detail !== "string") return null;
    }
  }

  return raw as unknown as SyncProgress;
}

// Whether a job status is a terminal state (polling can stop).
export const TERMINAL_JOB_STATUSES = new Set<SyncJobStatus>([
  "completed", "partial", "failed", "idle", "unavailable",
]);

// Whether a job status is actively changing (poll faster).
export const ACTIVE_JOB_STATUSES = new Set<SyncJobStatus>([
  "running", "stalled", "queued",
]);

// Human-facing labels for the closed job-status set.
export const SYNC_JOB_STATUS_LABELS: Record<SyncJobStatus, string> = {
  idle: "Not started",
  queued: "Queued",
  running: "Synchronizing",
  stalled: "Stalled",
  completed: "Complete",
  partial: "Partially complete",
  failed: "Failed",
  unavailable: "Unavailable",
};

// A truthful progress line. When the total is unknown we return an honest
// indeterminate message with the real stage — never a fabricated percentage.
export function progressLine(overall: SyncProgress["overall"], jobStatus: SyncJobStatus): string {
  // Terminal states get a definitive, honest label (the bar already shows the
  // fill); a bare percentage is reserved for genuinely in-flight work.
  if (jobStatus === "completed") return "Complete";
  if (jobStatus === "partial") return "Partially complete";
  if (jobStatus === "failed") return "Failed — see details";
  if (jobStatus === "stalled") return "Waiting for the worker to report progress";
  if (jobStatus === "queued") return "Queued — waiting to start";
  if (jobStatus === "unavailable") return "Unavailable";
  if (jobStatus === "idle") return "Not started";
  // Active (running) state: a percentage ONLY when the total is measurable.
  if (overall.percent !== null && overall.measurable) {
    return `${overall.percent}% complete`;
  }
  const stage = overall.stage && overall.stage !== "unknown" ? overall.stage : "synchronizing";
  if (overall.work.total_known) return `Working through ${stage}`;
  return `Working through ${stage} — total not yet known`;
}
