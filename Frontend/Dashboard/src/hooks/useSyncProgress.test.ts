// src/hooks/useSyncProgress.test.ts
// Task 215 — the polling hook must be BOUNDED and a pure consumer: it polls
// only while the job is actively changing, STOPS on a terminal state, never
// fires duplicate in-flight requests, cleans up on unmount, and treats a bad
// contract as an honest unknown (fail-closed), never a fabricated state.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { api } from "@/lib/api";
import { useSyncProgress } from "./useSyncProgress";
import { SYNC_PROGRESS_CONTRACT_VERSION, type SyncProgress } from "@/lib/integrationProgress";

// Map a job status to a VALID domain status (domain statuses are a different,
// closed set: never_run | running | ok | degraded | failed).
function domainStatus(status: string): string {
  if (status === "completed") return "ok";
  if (status === "running" || status === "stalled") return "running";
  if (status === "failed" || status === "partial") return "failed";
  return "never_run";
}

function ordersDomain(status: string, percent: number | null, measurable: boolean) {
  const dStatus = domainStatus(status);
  const dPercent = dStatus === "ok" ? 100 : dStatus === "never_run" ? null : (percent ?? 0);
  const totalKnown = dStatus === "ok" ? true : measurable;
  return {
    domain: "orders", required: true, status: dStatus,
    work: {
      total_units: dStatus === "ok" ? 1 : totalKnown ? 1 : null,
      completed_units: dStatus === "ok" ? 1 : 0,
      failed_units: 0, remaining_units: null, total_known: totalKnown,
    },
    records: { discovered: dStatus === "ok" ? 1 : 0, persisted: dStatus === "ok" ? 1 : 0, pages_completed: 0, pagination_complete: dStatus === "ok" },
    checkpoint_available: true, error_code: null, percent: dPercent, failure: null,
  };
}

function progress(status: string, percent: number | null, measurable: boolean): unknown {
  return {
    contract_version: SYNC_PROGRESS_CONTRACT_VERSION,
    store: { id: "s1", shop_domain: "s1.myshopify.com" },
    job: {
      id: "job-1", status, reason: "x", started_at: null, updated_at: null,
      completed_at: status === "completed" ? "2026-11-08T01:00:00Z" : null,
      heartbeat_at: "2026-11-08T00:05:00Z", stalled: false, stall_threshold_seconds: 7200,
    },
    overall: {
      stage: "orders",
      work: { total_units: measurable ? 100 : null, completed_units: percent ?? 0, failed_units: 0, remaining_units: null, total_known: measurable },
      records: { retrieved: percent ?? 0, persisted: percent ?? 0 },
      measurable, estimated: false, percent,
    },
    domains: [
      { domain: "products", required: true, status: "ok", work: { total_units: 1, completed_units: 1, failed_units: 0, remaining_units: 0, total_known: true }, records: { discovered: 1, persisted: 1, pages_completed: 1, pagination_complete: true }, checkpoint_available: true, error_code: null, percent: 100, failure: null },
      ordersDomain(status, percent, measurable),
    ],
    retry: { actionable: false, reason_code: null, manual_retry_eligible: false, merchant_action_required: false, next_step: null },
  };
}

const body = (data: unknown) => ({ ok: true, status: 200, data: { success: true, data } });
const settle = () => act(async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); });

describe("useSyncProgress (bounded polling, pure consumer)", () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("returns the normalized progress and stops immediately on a terminal state", async () => {
    const getSpy = vi.spyOn(api, "get").mockImplementation(() => Promise.resolve(body(progress("completed", 100, true))));
    const { result } = renderHook(() => useSyncProgress("s1"));
    await settle();
    expect(result.current.loading).toBe(false);
    expect(result.current.progress).not.toBeNull();
    expect((result.current.progress as SyncProgress).job.status).toBe("completed");
    const calls = getSpy.mock.calls.length;
    // Completed is terminal: a long wait must NOT poll again (no unbounded polling).
    await act(async () => { vi.advanceTimersByTime(30 * 60_000); await Promise.resolve(); });
    expect(getSpy.mock.calls.length).toBe(calls);
    expect(getSpy.mock.calls[0][0]).toBe("/stores/s1/sync-progress");
  });

  it("polls while the job is running, then stops once it completes", async () => {
    let status = "running";
    const getSpy = vi.spyOn(api, "get").mockImplementation(() =>
      Promise.resolve(body(progress(status, status === "running" ? 40 : 100, true))));
    const { unmount } = renderHook(() => useSyncProgress("s1"));
    await settle();
    expect(getSpy.mock.calls.length).toBe(1);
    // Advance past the running cadence → a second poll happens.
    await act(async () => { vi.advanceTimersByTime(4_000); await Promise.resolve(); });
    expect(getSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    // Now the worker completes → the next tick settles and stops polling.
    status = "completed";
    await act(async () => { vi.advanceTimersByTime(4_000); await Promise.resolve(); });
    const afterComplete = getSpy.mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(10 * 60_000); await Promise.resolve(); });
    expect(getSpy.mock.calls.length).toBe(afterComplete);
    unmount();
  });

  it("does not fire a duplicate request while one is in flight", async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    const pending = new Promise((r) => { resolveFirst = r; });
    const getSpy = vi.spyOn(api, "get").mockImplementation(() => pending);
    const { result } = renderHook(() => useSyncProgress("s1"));
    // Two rapid refetches while the first is still in flight.
    await act(async () => {
      const p1 = result.current.refetch();
      const p2 = result.current.refetch();
      await Promise.resolve();
      expect(getSpy.mock.calls.length).toBe(1); // deduped
      resolveFirst(body(progress("running", 40, true)));
      await p1; await p2;
    });
    expect(getSpy.mock.calls.length).toBe(1);
    expect(result.current.progress).not.toBeNull();
  });

  it("stops polling after unmount (cleanup)", async () => {
    const getSpy = vi.spyOn(api, "get").mockImplementation(() => Promise.resolve(body(progress("running", 40, true))));
    const { unmount } = renderHook(() => useSyncProgress("s1"));
    await settle();
    const beforeUnmount = getSpy.mock.calls.length;
    unmount();
    await act(async () => { vi.advanceTimersByTime(5 * 60_000); await Promise.resolve(); });
    expect(getSpy.mock.calls.length).toBe(beforeUnmount);
  });

  it("respects enabled=false (no requests)", async () => {
    const getSpy = vi.spyOn(api, "get").mockImplementation(() => Promise.resolve(body(progress("running", 40, true))));
    const { result } = renderHook(() => useSyncProgress("s1", { enabled: false }));
    await settle();
    expect(getSpy.mock.calls.length).toBe(0);
    expect(result.current.loading).toBe(false);
    expect(result.current.progress).toBeNull();
  });

  it("treats an invalid contract as an honest unknown (fail-closed)", async () => {
    vi.spyOn(api, "get").mockImplementation(() =>
      Promise.resolve({ ok: true, status: 200, data: { success: true, data: { contract_version: "rev-sync-progress-v0" } } }));
    const { result } = renderHook(() => useSyncProgress("s1"));
    await settle();
    expect(result.current.loading).toBe(false);
    expect(result.current.progress).toBeNull();
    expect(result.current.error).toBe(false); // not a network error — just not usable
  });

  it("surfaces a network failure as an error (still no fabricated progress)", async () => {
    vi.spyOn(api, "get").mockImplementation(() => Promise.reject(new Error("network")));
    const { result } = renderHook(() => useSyncProgress("s1"));
    await settle();
    expect(result.current.error).toBe(true);
    expect(result.current.progress).toBeNull();
  });

  it("refetch overrides a stale view (backend is authoritative)", async () => {
    let payload = progress("running", 10, true);
    const getSpy = vi.spyOn(api, "get").mockImplementation(() => Promise.resolve(body(payload)));
    const { result } = renderHook(() => useSyncProgress("s1"));
    await settle();
    expect((result.current.progress as SyncProgress).overall.percent).toBe(10);
    payload = progress("completed", 100, true);
    await act(async () => { await result.current.refetch(); });
    expect((result.current.progress as SyncProgress).job.status).toBe("completed");
    expect((result.current.progress as SyncProgress).overall.percent).toBe(100);
    expect(getSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
