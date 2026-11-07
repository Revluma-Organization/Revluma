// src/components/SyncProgress.test.tsx
// Task 215 — the mobile sync-progress card must:
//   • render a percentage ONLY when the total is measurable, else an honest
//     indeterminate bar + stage (never a fabricated % or premature 100%);
//   • show distinct stalled/failed/queued states with correct retry actions;
//   • post an idempotent retry (scope + request_key) and let the backend
//     override the stale view;
//   • be mobile-safe: no horizontal overflow (w-full/min-w-0), touch targets
//     >= 44px, accessible progressbar, and a skeleton (never a blank page)
//     while the first response is in flight.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { api } from "@/lib/api";
import { SyncProgressCard } from "./SyncProgress";
import { SYNC_PROGRESS_CONTRACT_VERSION } from "@/lib/integrationProgress";

// Map a job status to a VALID domain status (a different closed set).
function domainStatus(status: string): string {
  if (status === "completed") return "ok";
  if (status === "running" || status === "stalled") return "running";
  if (status === "failed" || status === "partial") return "failed";
  return "never_run";
}

function ordersDomain(status: string, percent: number | null, measurable: boolean, merchant: boolean) {
  const dStatus = domainStatus(status);
  const dPercent = dStatus === "ok" ? 100 : dStatus === "never_run" ? null : (percent ?? 0);
  const totalKnown = dStatus === "ok" ? true : measurable;
  return {
    domain: "orders", required: true, status: dStatus,
    work: {
      total_units: dStatus === "ok" ? 50 : totalKnown ? 50 : null,
      completed_units: dStatus === "ok" ? 50 : (percent ?? 0),
      failed_units: 0, remaining_units: null, total_known: totalKnown,
    },
    records: { discovered: percent ?? 0, persisted: percent ?? 0, pages_completed: 0, pagination_complete: dStatus === "ok" },
    checkpoint_available: true, error_code: null, percent: dPercent,
    failure: dStatus === "failed"
      ? { category: "transient_backend", reason_code: "P1", auto_retry_eligible: false, manual_retry_eligible: true, backoff_exhausted: false, attempt: 5, max_auto_attempts: 5, next_eligible_at: null, retry_window_elapsed: true, merchant_action_required: merchant, next_step: "Retry", error_code: "500" }
      : null,
  };
}

function progress(overrides: Partial<{
  status: string; percent: number | null; measurable: boolean;
  actionable: boolean; manual: boolean; merchant: boolean; stalled: boolean;
}> = {}): unknown {
  const status = overrides.status ?? "running";
  // Distinguish "not passed" (default 40) from an explicit `percent: null`
  // (honest indeterminate state) — `??` would collapse null to 40.
  const percent = "percent" in overrides ? overrides.percent : 40;
  const measurable = overrides.measurable ?? true;
  const merchant = overrides.merchant ?? false;
  return {
    contract_version: SYNC_PROGRESS_CONTRACT_VERSION,
    store: { id: "s1", shop_domain: "s1.myshopify.com" },
    job: {
      id: "job-1", status, reason: "x", started_at: "2026-11-08T00:00:00Z",
      updated_at: "2026-11-08T00:05:00Z",
      completed_at: status === "completed" ? "2026-11-08T01:00:00Z" : null,
      heartbeat_at: "2026-11-08T00:05:00Z", stalled: overrides.stalled ?? false, stall_threshold_seconds: 7200,
    },
    overall: {
      stage: "orders",
      work: { total_units: measurable ? 100 : null, completed_units: percent ?? 0, failed_units: 0, remaining_units: null, total_known: measurable },
      records: { retrieved: percent ?? 0, persisted: percent ?? 0 },
      measurable, estimated: false, percent,
    },
    domains: [
      { domain: "products", required: true, status: "ok", work: { total_units: 50, completed_units: 50, failed_units: 0, remaining_units: 0, total_known: true }, records: { discovered: 50, persisted: 50, pages_completed: 2, pagination_complete: true }, checkpoint_available: true, error_code: null, percent: 100, failure: null },
      ordersDomain(status, percent, measurable, merchant),
    ],
    retry: {
      actionable: overrides.actionable ?? false, scope: "all",
      reason_code: status === "failed" ? "P1" : null,
      retry_eligible: overrides.manual ?? false, manual_retry_eligible: overrides.manual ?? false,
      merchant_action_required: merchant,
      next_step: merchant ? "Reconnect" : "Wait",
      next_eligible_at: null, attempt: 5, max_auto_attempts: 5, backoff_exhausted: true,
    },
  };
}

const body = (data: unknown) => ({ ok: true, status: 200, data: { success: true, data } });
const mockGet = (data: unknown) =>
  vi.spyOn(api, "get").mockImplementation(() => Promise.resolve(body(data)));

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

describe("SyncProgressCard — truthfulness", () => {
  it("shows the percentage when the total is measurable", async () => {
    mockGet(progress({ status: "running", percent: 40, measurable: true }));
    render(<SyncProgressCard storeId="s1" />);
    await waitFor(() => expect(screen.getByText("40% complete")).toBeInTheDocument());
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "40");
  });

  it("shows an honest indeterminate state (no %) when the total is unknown", async () => {
    mockGet(progress({ status: "running", percent: null, measurable: false }));
    render(<SyncProgressCard storeId="s1" />);
    const bar = await screen.findByRole("progressbar"); // wait for data
    expect(bar).not.toHaveAttribute("aria-valuenow"); // indeterminate
    expect(screen.getByText(/total not yet known/)).toBeInTheDocument();
    expect(screen.queryByText(/% complete/)).not.toBeInTheDocument();
  });

  it("never renders a premature 100% for a non-completed job (fail-closed → unknown)", async () => {
    // A tampered contract (100% while running) is rejected by the normalizer →
    // the card renders an honest "no progress yet" state, never "100% complete".
    vi.spyOn(api, "get").mockImplementation(() =>
      Promise.resolve(body(progress({ status: "running", percent: 100, measurable: true }))));
    render(<SyncProgressCard storeId="s1" />);
    await waitFor(() =>
      expect(screen.getByText(/no synchronization progress is available/i)).toBeInTheDocument());
    expect(screen.queryByText("100% complete")).not.toBeInTheDocument();
  });

  it("renders 100% only when the job actually completed", async () => {
    mockGet(progress({ status: "completed", percent: 100, measurable: true }));
    render(<SyncProgressCard storeId="s1" />);
    const bar = await screen.findByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "100");
    // The definitive "Complete" label is shown (status + line), never a bare %
    expect(screen.getAllByText("Complete").length).toBeGreaterThanOrEqual(1);
  });
});

describe("SyncProgressCard — retry states", () => {
  it("offers a retry for a failed job with manual eligibility", async () => {
    mockGet(progress({ status: "failed", percent: 30, measurable: true, actionable: true, manual: true }));
    render(<SyncProgressCard storeId="s1" />);
    const btn = await screen.findByRole("button", { name: /retry sync/i });
    expect(btn).toHaveClass("min-h-[44px]");
    expect(btn).toBeEnabled();
  });

  it("offers a retry labelled for a stalled worker", async () => {
    mockGet(progress({ status: "stalled", percent: 20, measurable: true, actionable: true, manual: true, stalled: true }));
    render(<SyncProgressCard storeId="s1" />);
    const btn = await screen.findByRole("button", { name: /retry \(worker stalled\)/i });
    expect(btn).toHaveClass("min-h-[44px]");
  });

  it("posts an idempotent retry (scope + request_key) and lets the backend override", async () => {
    const postSpy = vi.spyOn(api, "post").mockImplementation(() =>
      Promise.resolve({ ok: true, status: 202, data: { success: true, data: { status: "accepted" } } }));
    mockGet(progress({ status: "failed", percent: 30, measurable: true, actionable: true, manual: true }));
    render(<SyncProgressCard storeId="s1" />);
    const btn = await screen.findByRole("button", { name: /retry sync/i });
    fireEvent.click(btn);
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0][0]).toBe("/stores/s1/sync-retry");
    const sentBody = postSpy.mock.calls[0][1] as { scope: string; request_key: string };
    expect(sentBody.scope).toBe("all");
    expect(typeof sentBody.request_key).toBe("string");
    expect(sentBody.request_key.length).toBeGreaterThan(0);
  });

  it("shows a reconnect action for a permanent (merchant) failure and invokes the handler", async () => {
    const onReconnect = vi.fn();
    mockGet(progress({ status: "failed", percent: 30, measurable: true, actionable: true, merchant: true }));
    render(<SyncProgressCard storeId="s1" onReconnect={onReconnect} />);
    const btn = await screen.findByRole("button", { name: /reconnect required/i });
    expect(btn).toHaveClass("min-h-[44px]");
    fireEvent.click(btn);
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it("does not show a retry while the job is in flight", async () => {
    mockGet(progress({ status: "running", percent: 40, measurable: true, actionable: true, manual: true }));
    render(<SyncProgressCard storeId="s1" />);
    await waitFor(() => expect(screen.getByText("40% complete")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });
});

describe("SyncProgressCard — mobile safety & a11y", () => {
  it("is intrinsically single-column (no horizontal overflow) with stacked metadata", async () => {
    mockGet(progress({ status: "running", percent: 40, measurable: true }));
    const { container } = render(<SyncProgressCard storeId="s1" />);
    await waitFor(() => expect(screen.getByRole("progressbar")).toBeInTheDocument());
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("w-full");
    expect(root.className).toContain("min-w-0");
    // Per-domain list is a stacked <ul> (block), not a fixed-width row.
    const list = container.querySelector("ul");
    expect(list).not.toBeNull();
    expect(list!.className).toContain("space-y");
    // Diagnostics metadata stacks to one column on mobile (grid-cols-1).
    expect(container.querySelector("dl")!.className).toContain("grid-cols-1");
  });

  it("exposes an accessible, labelled progressbar", async () => {
    mockGet(progress({ status: "running", percent: 40, measurable: true }));
    render(<SyncProgressCard storeId="s1" />);
    const bar = await screen.findByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(bar.getAttribute("aria-label")).toMatch(/progress/i);
  });

  it("shows a skeleton (never a blank page) while the first response is in flight", async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    const pending = new Promise((r) => { resolveFirst = r; });
    vi.spyOn(api, "get").mockImplementation(() => pending);
    render(<SyncProgressCard storeId="s1" />);
    // Immediately (before resolution) a skeleton is present, not a blank page.
    expect(screen.getByRole("status", { name: /loading synchronization progress/i })).toBeInTheDocument();
    await act(async () => { resolveFirst(body(progress({ status: "running", percent: 40, measurable: true }))); await Promise.resolve(); });
    await waitFor(() => expect(screen.getByRole("progressbar")).toBeInTheDocument());
  });

  it("renders a non-blank, honest state when progress is unavailable", async () => {
    vi.spyOn(api, "get").mockImplementation(() => Promise.reject(new Error("network")));
    render(<SyncProgressCard storeId="s1" />);
    await waitFor(() => expect(screen.getByText(/temporarily unavailable/i)).toBeInTheDocument());
  });
});
