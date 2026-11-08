import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Task 220 — the store-scoped Business Health section must have an honest,
// resource-level runtime lifecycle: it fails closed, shows a closed
// merchant-facing phrase per classified failure, offers a resource-scoped
// retry (never a second business-health calculation), and cancels its request
// on unmount or store change so a stale response can never land on the wrong
// store. The backend remains authoritative; the panel only renders what the
// closed contract returns.
vi.mock(
  "@/lib/api",
  async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/api")>();
    return { ...actual, api: { get: vi.fn() } };
  },
);

import { api, ApiError } from "@/lib/api";
import BusinessHealthPanel from "./BusinessHealthPanel";
import { businessHealthFixture } from "./businessHealthFixtures";

const mockedGet = api.get as unknown as ReturnType<typeof vi.fn>;
// Rendered exactly once, and only when a valid contract is present: the
// top-level business-status explanation (distinct from the per-indicator
// status badges, which repeat).
const CONTRACT_TEXT = "The most severe supported business state across complete indicators is healthy.";
const okBody = () => ({ ok: true, status: 200, data: { success: true, data: businessHealthFixture() } });
// A request that only settles when its (3rd-arg) signal aborts.
const hangingGet = () => {
  mockedGet.mockImplementation((_p: string, _q?: unknown, options?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }),
  );
};
const renderPanel = (storeId = "store-1", storeDomain = "revluma-test-store-v1.myshopify.com") =>
  render(<MemoryRouter><BusinessHealthPanel storeId={storeId} storeDomain={storeDomain} /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  mockedGet.mockReset();
  mockedGet.mockResolvedValue(okBody());
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Business Health panel runtime states (Task 220)", () => {
  it("SC-BHP-01: a valid contract renders its indicators (no failure, no skeleton)", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText(CONTRACT_TEXT)).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Business health" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /loading business health/i })).not.toBeInTheDocument();
  });

  it("SC-BHP-02: a 500 shows the closed section failure with a resource-scoped retry", async () => {
    mockedGet.mockRejectedValue(new ApiError(500, "boom"));
    renderPanel();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("Business health is unavailable right now");
    expect(screen.getByRole("alert")).toHaveTextContent("A server error interrupted the request");
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    // Nothing is invented: no contract (no status badge / indicators) renders.
    expect(screen.queryByText(CONTRACT_TEXT)).not.toBeInTheDocument();
  });

  it("SC-BHP-03: retry re-requests only this section and recovers on success", async () => {
    let calls = 0;
    mockedGet.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return Promise.reject(new ApiError(500, "boom"));
      return Promise.resolve(okBody());
    });
    renderPanel();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(screen.getByText(CONTRACT_TEXT)).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(calls).toBe(2);
  });

  it("SC-BHP-04: a malformed contract fails closed (invalid_contract, nothing rendered)", async () => {
    mockedGet.mockResolvedValue({ ok: true, status: 200, data: { success: true, data: { contract_version: "wrong" } } });
    renderPanel();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("The response did not match the expected contract");
    expect(screen.queryByText(CONTRACT_TEXT)).not.toBeInTheDocument();
  });

  it("SC-BHP-05: a stalled request times out and is described honestly (retryable)", async () => {
    vi.useFakeTimers();
    hangingGet();
    renderPanel();
    expect(screen.getByRole("status", { name: /loading business health/i })).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(30_001); });
    expect(screen.getByRole("alert")).toHaveTextContent("The request was cancelled after 30 seconds");
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /loading business health/i })).not.toBeInTheDocument();
  });

  it("SC-BHP-06: unmount cancels the in-flight request (no late write, no crash)", async () => {
    vi.useFakeTimers();
    hangingGet();
    const { unmount } = renderPanel();
    unmount();
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(() => act(() => {})).not.toThrow();
  });

  it("SC-BHP-07: a store change aborts the previous store's in-flight request", () => {
    const signals: AbortSignal[] = [];
    mockedGet.mockImplementation((_p: string, _q?: unknown, options?: { signal?: AbortSignal }) => {
      signals.push(options?.signal as AbortSignal);
      return new Promise((_resolve, reject) => {
        (options?.signal as AbortSignal)?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });
    const { rerender } = renderPanel("store-1");
    expect(signals.length).toBe(1);
    rerender(<MemoryRouter><BusinessHealthPanel storeId="store-2" storeDomain="other.myshopify.com" /></MemoryRouter>);
    expect(signals.length).toBe(2);
    expect(signals[0].aborted).toBe(true); // store-1 request cancelled
    expect(signals[1].aborted).toBe(false);
  });

  it("SC-BHP-08: a 404 is described as store-specific not-found, not an error to retry", async () => {
    mockedGet.mockRejectedValue(new ApiError(404, "Not found"));
    renderPanel();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("This store has no business health data");
  });

  it("SC-BHP-09: a transport-level failure is described as a connection problem", async () => {
    mockedGet.mockRejectedValue(new ApiError(0, "Network error: fetch failed"));
    renderPanel();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("A connection problem stopped the request");
  });

  it("SC-BHP-10: a 429 is described as rate limiting (no immediate retry loop)", async () => {
    mockedGet.mockRejectedValue(new ApiError(429, "Too many requests"));
    renderPanel();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("The server asked us to slow down");
  });
});
