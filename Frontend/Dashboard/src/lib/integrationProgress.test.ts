// src/lib/integrationProgress.test.ts
// Task 215 — the browser normalizer must be FAIL-CLOSED: a malformed,
// stale-shaped, or tampered contract yields null (honest unknown), and it
// refuses a fabricated percentage or a premature 100%.
import { describe, expect, it } from "vitest";
import {
  normalizeSyncProgress,
  progressLine,
  TERMINAL_JOB_STATUSES,
  ACTIVE_JOB_STATUSES,
  SYNC_PROGRESS_CONTRACT_VERSION,
  type SyncProgress,
} from "./integrationProgress";

// A fully valid contract. Individual tests override single fields to probe
// the fail-closed boundaries.
//
// These fixtures deliberately build loosely-typed / tampered payloads to probe
// the fail-closed normalizer, so `any` is intentional here (not a value type).
/* eslint-disable @typescript-eslint/no-explicit-any */
function validProgress(overrides: Record<string, any> = {}): unknown {
  const base = {
    contract_version: SYNC_PROGRESS_CONTRACT_VERSION,
    store: { id: "s1", shop_domain: "s1.myshopify.com" },
    job: {
      id: "job-1", status: "running", reason: "in_progress",
      started_at: "2026-11-08T00:00:00Z", updated_at: "2026-11-08T00:05:00Z",
      completed_at: null, heartbeat_at: "2026-11-08T00:05:00Z",
      stalled: false, stall_threshold_seconds: 7200,
    },
    overall: {
      stage: "orders",
      work: { total_units: 100, completed_units: 40, failed_units: 0, remaining_units: 60, total_known: true },
      records: { retrieved: 40, persisted: 40 },
      measurable: true, estimated: false, percent: 40,
    },
    domains: [
      {
        domain: "products", required: true, status: "ok",
        work: { total_units: 50, completed_units: 50, failed_units: 0, remaining_units: 0, total_known: true },
        records: { discovered: 50, persisted: 50, pages_completed: 2, pagination_complete: true },
        checkpoint_available: true, error_code: null, percent: 100, failure: null,
      },
      {
        domain: "orders", required: true, status: "running",
        work: { total_units: 50, completed_units: 20, failed_units: 0, remaining_units: 30, total_known: true },
        records: { discovered: 20, persisted: 20, pages_completed: 0, pagination_complete: false },
        checkpoint_available: true, error_code: null, percent: 40, failure: null,
      },
    ],
    retry: { actionable: false, reason_code: null, manual_retry_eligible: false, merchant_action_required: false, next_step: null },
  };
  return { ...base, ...overrides };
}

// Patch a field (top-level key, or dotted nested path) on a fresh base object.
function patch(overrides: Record<string, any>): unknown {
  const obj: any = validProgress();
  for (const [k, v] of Object.entries(overrides)) {
    const parts = k.split(".");
    if (parts.length === 1) {
      obj[k] = v; // top-level replace (e.g. contract_version, domains, retry)
      continue;
    }
    let node = obj[parts[0]];
    for (let i = 1; i < parts.length - 1; i += 1) node = node[parts[i]];
    node[parts[parts.length - 1]] = v;
  }
  return obj;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

describe("normalizeSyncProgress (fail-closed)", () => {
  it("accepts a well-formed contract", () => {
    const p = normalizeSyncProgress(validProgress());
    expect(p).not.toBeNull();
    expect(p!.contract_version).toBe(SYNC_PROGRESS_CONTRACT_VERSION);
    expect(p!.job.status).toBe("running");
    expect(p!.overall.percent).toBe(40);
    expect(p!.domains).toHaveLength(2);
  });

  it("rejects a non-object / null", () => {
    expect(normalizeSyncProgress(null)).toBeNull();
    expect(normalizeSyncProgress("x")).toBeNull();
    expect(normalizeSyncProgress([1, 2])).toBeNull();
  });

  it("rejects a wrong or missing contract version", () => {
    expect(normalizeSyncProgress(patch({ contract_version: "rev-sync-progress-v0" }))).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- probe a missing-version payload
    const { contract_version, ...noVersion } = validProgress() as any;
    expect(normalizeSyncProgress(noVersion)).toBeNull();
  });

  it("rejects a job status outside the closed set", () => {
    expect(normalizeSyncProgress(patch({ "job.status": "healthy" }))).toBeNull();
    expect(normalizeSyncProgress(patch({ "job.status": "syncing" }))).toBeNull();
  });

  it("rejects every valid closed-set status", () => {
    for (const s of ["idle", "queued", "running", "stalled", "completed", "partial", "failed", "unavailable"]) {
      const p = normalizeSyncProgress(patch({
        "job.status": s,
        "overall.percent": s === "completed" ? 100 : (s === "running" ? 40 : null),
        "overall.measurable": s === "completed" || s === "running",
      }));
      expect(p, `status ${s}`).not.toBeNull();
    }
  });

  it("rejects an out-of-range percent", () => {
    expect(normalizeSyncProgress(patch({ "overall.percent": 101 }))).toBeNull();
    expect(normalizeSyncProgress(patch({ "overall.percent": -1 }))).toBeNull();
    expect(normalizeSyncProgress(patch({ "overall.percent": NaN }))).toBeNull();
  });

  it("rejects a percent when the total is not known (not measurable)", () => {
    expect(normalizeSyncProgress(patch({ "overall.measurable": false, "overall.percent": 40 }))).toBeNull();
  });

  it("refuses a premature 100% unless the job actually completed", () => {
    expect(normalizeSyncProgress(patch({ "job.status": "running", "overall.percent": 100 }))).toBeNull();
    expect(normalizeSyncProgress(patch({ "job.status": "partial", "overall.percent": 100 }))).toBeNull();
    const ok = normalizeSyncProgress(patch({ "job.status": "completed", "overall.percent": 100 }));
    expect(ok).not.toBeNull();
  });

  it("rejects a domain claiming 100% while not ok", () => {
    expect(normalizeSyncProgress(patch({
      "domains.1.percent": 100, "domains.1.status": "running",
    }))).toBeNull();
  });

  it("rejects an empty domains list", () => {
    expect(normalizeSyncProgress(patch({ domains: [] }))).toBeNull();
  });

  it("rejects a missing retry.actionable boolean", () => {
    expect(normalizeSyncProgress(patch({ retry: { reason_code: null } }))).toBeNull();
  });

  it("keeps a valid failure sub-object and rejects an invalid one", () => {
    const withFailure = patch({
      "domains.1.failure": {
        category: "transient_throttle", reason_code: "P3", auto_retry_eligible: true,
        manual_retry_eligible: true, backoff_exhausted: false, attempt: 2, max_auto_attempts: 5,
        next_eligible_at: "2026-11-08T01:00:00Z", retry_window_elapsed: false,
        merchant_action_required: false, next_step: "Wait for backoff", error_code: "429",
      },
    });
    expect(normalizeSyncProgress(withFailure)).not.toBeNull();
    expect(normalizeSyncProgress(patch({ "domains.1.failure": { category: 5 } }))).toBeNull();
  });

  it("returns a typed, stable shape for the component", () => {
    const p = normalizeSyncProgress(validProgress()) as SyncProgress;
    expect(p.overall.measurable).toBe(true);
    expect(p.overall.work.total_known).toBe(true);
    expect(p.domains[0].required).toBe(true);
    expect(p.retry.actionable).toBe(false);
  });

  it("accepts a canonical store_status (completed with limitations) — Task 229 #3", () => {
    const p = normalizeSyncProgress(validProgress({
      "job.status": "completed",
      "overall.percent": 100,
      store_status: {
        status: "initial_completed_with_limitations",
        reason: "complete_with_optional_limitations",
        limitations: [
          { domain: "analytics.reports", required: false, status: "failed", coverage: "retrieval_failure", detail: "retrieval failed (SHOPIFY_GRAPHQL_ERROR)" },
          { domain: "shop.policies", required: false, status: "failed", coverage: "retrieval_failure", detail: "retrieval failed (SHOPIFY_GRAPHQL_ERROR)" },
        ],
      },
    }));
    expect(p).not.toBeNull();
    expect(p!.store_status?.status).toBe("initial_completed_with_limitations");
    expect(p!.store_status?.limitations).toHaveLength(2);
  });

  it("normalizes a contract WITHOUT store_status (backward compatible)", () => {
    const p = normalizeSyncProgress(validProgress());
    expect(p).not.toBeNull();
    expect(p!.store_status).toBeUndefined();
  });

  it("rejects a malformed store_status (fail-closed)", () => {
    expect(normalizeSyncProgress(validProgress({ store_status: { status: "", reason: null, limitations: [] } }))).toBeNull();
    expect(normalizeSyncProgress(validProgress({ store_status: { status: "initial_completed", reason: null, limitations: "nope" } }))).toBeNull();
    expect(normalizeSyncProgress(validProgress({ store_status: { status: "initial_completed_with_limitations", reason: null, limitations: [{ domain: "x", coverage: "retrieval_failure", detail: null }] } }))).toBeNull();
    expect(normalizeSyncProgress(validProgress({ store_status: { status: "initial_completed", reason: 5, limitations: [] } }))).toBeNull();
  });
});

describe("progressLine (truthful copy)", () => {
  const overall = (o: Partial<SyncProgress["overall"]> & { totalKnown?: boolean } = {}): SyncProgress["overall"] => {
    const { totalKnown, ...rest } = o;
    return {
      stage: "orders",
      work: { total_units: 100, completed_units: 40, failed_units: 0, remaining_units: 60, total_known: totalKnown ?? true },
      records: { retrieved: 40, persisted: 40 },
      measurable: true, estimated: false, percent: 40, ...rest,
    };
  };

  it("states the percentage only when measurable", () => {
    expect(progressLine(overall(), "running")).toBe("40% complete");
  });

  it("never invents a percentage when the total is unknown", () => {
    const unknownTotal = progressLine(overall({ measurable: false, percent: null, totalKnown: false }), "running");
    expect(unknownTotal).not.toContain("%");
    expect(unknownTotal).toMatch(/total not yet known/);
    // Even with a known total but no stable denominator, no percentage is shown.
    expect(progressLine(overall({ measurable: false, percent: null }), "running")).not.toContain("%");
  });

  it("maps terminal states to honest labels (not a bare percentage)", () => {
    expect(progressLine(overall({ percent: 100 }), "completed")).toBe("Complete");
    expect(progressLine(overall({ percent: 70, measurable: true }), "partial")).toBe("Partially complete");
    expect(progressLine(overall({ percent: null, measurable: false }), "failed")).toBe("Failed — see details");
    expect(progressLine(overall({ percent: null, measurable: false }), "stalled")).toBe("Waiting for the worker to report progress");
    expect(progressLine(overall({ percent: null, measurable: false }), "queued")).toBe("Queued — waiting to start");
  });
});

describe("status sets", () => {
  it("splits terminal vs active correctly for polling", () => {
    expect(TERMINAL_JOB_STATUSES.has("completed")).toBe(true);
    expect(TERMINAL_JOB_STATUSES.has("failed")).toBe(true);
    expect(TERMINAL_JOB_STATUSES.has("running")).toBe(false);
    expect(ACTIVE_JOB_STATUSES.has("running")).toBe(true);
    expect(ACTIVE_JOB_STATUSES.has("stalled")).toBe(true);
    expect(ACTIVE_JOB_STATUSES.has("completed")).toBe(false);
  });
});
