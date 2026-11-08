import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Task 220 — the store-scoped Operational History section: fail-closed
// rendering, a closed merchant-facing phrase per classified failure, a
// resource-scoped retry, an honest "nothing happened" empty state (distinct
// from a failure), and cancellation on unmount/store change. Recorded events
// come only from the authoritative backend contract.
vi.mock(
  "@/lib/api",
  async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/api")>();
    return { ...actual, api: { get: vi.fn() } };
  },
);

import { api, ApiError } from "@/lib/api";
import OperationalActivityPanel from "./OperationalActivityPanel";
import { operationalActivityFixture } from "./businessHealthFixtures";

const mockedGet = api.get as unknown as ReturnType<typeof vi.fn>;
const okBody = (extra: Record<string, unknown> = {}) =>
  ({ ok: true, status: 200, data: { success: true, data: operationalActivityFixture(extra) } });
const hangingGet = () => {
  mockedGet.mockImplementation((_p: string, _q?: unknown, options?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }),
  );
};
const renderPanel = (storeId = "store-1") =>
  render(<MemoryRouter><OperationalActivityPanel storeId={storeId} /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  mockedGet.mockReset();
  mockedGet.mockResolvedValue(okBody());
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Operational History panel runtime states (Task 220)", () => {
  it("SC-OAP-01: a valid contract renders the recorded events and the running total", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText("Synchronization completed for orders")).toBeInTheDocument());
    expect(screen.getByText("2 recorded")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /loading operational history/i })).not.toBeInTheDocument();
  });

  it("SC-OAP-02: a 500 shows the closed section failure with a resource-scoped retry", async () => {
    mockedGet.mockRejectedValue(new ApiError(500, "boom"));
    renderPanel();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("Operational history is unavailable right now");
    expect(screen.getByRole("alert")).toHaveTextContent("A server error interrupted the request");
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByText("Synchronization completed for orders")).not.toBeInTheDocument();
  });

  it("SC-OAP-03: retry re-requests only this section and recovers on success", async () => {
    let calls = 0;
    mockedGet.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return Promise.reject(new ApiError(502, "bad gateway"));
      return Promise.resolve(okBody());
    });
    renderPanel();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(screen.getByText("Synchronization completed for orders")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(calls).toBe(2);
  });

  it("SC-OAP-04: a malformed contract fails closed (invalid_contract, no events inferred)", async () => {
    mockedGet.mockResolvedValue({ ok: true, status: 200, data: { success: true, data: { contract_version: "wrong" } } });
    renderPanel();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("The response did not match the expected contract");
    expect(screen.queryByText("Synchronization completed for orders")).not.toBeInTheDocument();
  });

  it("SC-OAP-05: a genuine empty history is shown as 'nothing happened', not as a failure or a zero", async () => {
    mockedGet.mockResolvedValue(okBody({ items: [], total: 0, returned: 0, next_cursor: null, has_more: false }));
    renderPanel();
    await waitFor(() => expect(screen.getByText(/No operational events recorded in the last 14 days/i)).toBeInTheDocument());
    expect(screen.getByText(/This means nothing happened, not that events are missing/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("SC-OAP-06: a stalled request times out and is described honestly (retryable)", async () => {
    vi.useFakeTimers();
    hangingGet();
    renderPanel();
    expect(screen.getByRole("status", { name: /loading operational history/i })).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(30_001); });
    expect(screen.getByRole("alert")).toHaveTextContent("The request was cancelled after 30 seconds");
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /loading operational history/i })).not.toBeInTheDocument();
  });

  it("SC-OAP-07: unmount cancels the in-flight request (no late write, no crash)", async () => {
    vi.useFakeTimers();
    hangingGet();
    const { unmount } = renderPanel();
    unmount();
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(() => act(() => {})).not.toThrow();
  });

  it("SC-OAP-08: a store change aborts the previous store's in-flight request", () => {
    const signals: AbortSignal[] = [];
    mockedGet.mockImplementation((_p: string, _q?: unknown, options?: { signal?: AbortSignal }) => {
      signals.push(options?.signal as AbortSignal);
      return new Promise((_resolve, reject) => {
        (options?.signal as AbortSignal)?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });
    const { rerender } = renderPanel("store-1");
    expect(signals.length).toBe(1);
    rerender(<MemoryRouter><OperationalActivityPanel storeId="store-2" /></MemoryRouter>);
    expect(signals.length).toBe(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  it("SC-OAP-09: a 404 is described as store-specific not-found", async () => {
    mockedGet.mockRejectedValue(new ApiError(404, "Not found"));
    renderPanel();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("This store has no operational history");
  });

  it("SC-OAP-10: a transport-level failure is described as a connection problem", async () => {
    mockedGet.mockRejectedValue(new ApiError(0, "Network error: fetch failed"));
    renderPanel();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("A connection problem stopped the request");
  });
});
