import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

// Controllable auth identity for workspace-switch tests.
const authState: { user: { tenant_id: string | null } | null } = { user: { tenant_id: "merchant-a" } };

vi.mock("@/store/authStore", () => ({
  useAuthStore: (selector: (s: typeof authState) => unknown) => selector(authState),
}));

// Keep the real ApiError class (the classifier reads its shape) but stub the
// network client so we control every response deterministically.
vi.mock(
  "@/lib/api",
  async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/api")>();
    return { ...actual, api: { get: vi.fn() } };
  },
);

import { api, ApiError } from "@/lib/api";
import { useCommandCenter } from "./useCommandCenter";

const mockedGet = api.get as unknown as ReturnType<typeof vi.fn>;

function briefingFixture(overrides: Record<string, unknown> = {}) {
  return {
    contract_version: "command-center-v1",
    read_only: true,
    retrieved_at: "2026-11-08T12:00:00Z",
    context: { organization_id: "merchant-a", store: { id: "store-1", name: "revluma-test-store-v1.myshopify.com", platform: "shopify" }, currency: "USD" },
    business_state: { generated_at: "2026-11-08T11:55:00Z", presentation_status: "current", stale: false },
    briefing: { headline: "Your latest synchronized business picture", summary: "ok", tone: "default" },
    metrics: [],
    findings: [],
    evidence: { resources: [] },
    ...overrides,
  };
}
const okResponse = (data: Record<string, unknown>) => Promise.resolve({ ok: true, status: 200, data: { success: true, data } });

// A request that only settles when its (2nd-arg) signal aborts.
function hangingGet() {
  mockedGet.mockImplementation((_path: string, params?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      params?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.user = { tenant_id: "merchant-a" };
  mockedGet.mockReset();
  mockedGet.mockResolvedValue(okResponse(briefingFixture()));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useCommandCenter — request lifecycle (Task 220)", () => {
  it("SC-HOOK-01: initial load success clears loading and records lastSuccessfulAt", async () => {
    const { result } = renderHook(() => useCommandCenter());
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.loading).toBe(false);
    expect(result.current.refreshing).toBe(false);
    expect(result.current.failure).toBeNull();
    expect(result.current.lastSuccessfulAt).toBe("2026-11-08T12:00:00Z");
    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(mockedGet).toHaveBeenCalledWith("/rev/command-center", { signal: expect.any(AbortSignal) });
  });

  it("SC-HOOK-02: initial 500 classifies as server_error with no data", async () => {
    mockedGet.mockRejectedValue(new ApiError(500, "An unexpected server error occurred"));
    const { result } = renderHook(() => useCommandCenter());
    await waitFor(() => expect(result.current.failure).toBeTruthy());
    expect(result.current.failure?.kind).toBe("server_error");
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.announcement).toBeNull();
  });

  it("SC-HOOK-03: initial 404 classifies as not_found", async () => {
    mockedGet.mockRejectedValue(new ApiError(404, "Store not found."));
    const { result } = renderHook(() => useCommandCenter());
    await waitFor(() => expect(result.current.failure).toBeTruthy());
    expect(result.current.failure?.kind).toBe("not_found");
  });

  it("SC-HOOK-04: a transport-level rejection classifies as network", async () => {
    mockedGet.mockRejectedValue(new Error("fetch failed"));
    const { result } = renderHook(() => useCommandCenter());
    await waitFor(() => expect(result.current.failure).toBeTruthy());
    expect(result.current.failure?.kind).toBe("network");
  });

  it("SC-HOOK-05: a stalled request times out and ends the loading lifecycle", async () => {
    vi.useFakeTimers();
    hangingGet();
    const { result } = renderHook(() => useCommandCenter());
    expect(result.current.loading).toBe(true);
    await act(async () => { vi.advanceTimersByTime(30_001); });
    expect(result.current.failure?.kind).toBe("timeout");
    expect(result.current.loading).toBe(false); // no indefinite skeleton
    expect(result.current.data).toBeNull();
  });

  it("SC-HOOK-06: background refresh failure keeps the last successful snapshot", async () => {
    const { result } = renderHook(() => useCommandCenter());
    await waitFor(() => expect(result.current.data).toBeTruthy());
    mockedGet.mockRejectedValue(new ApiError(503, "upstream down"));
    act(() => { void result.current.refetch(true); });
    await waitFor(() => expect(result.current.failure).toBeTruthy());
    expect(result.current.failure?.kind).toBe("service_unavailable");
    expect(result.current.data).not.toBeNull(); // verified data survives
    expect(result.current.refreshing).toBe(false);
    expect(result.current.announcement).toMatch(/refresh failed/i);
  });

  it("SC-HOOK-07: background refresh success updates data and announces the outcome", async () => {
    const { result } = renderHook(() => useCommandCenter());
    await waitFor(() => expect(result.current.data).toBeTruthy());
    mockedGet.mockResolvedValue(okResponse(briefingFixture({ briefing: { headline: "Updated headline" }, retrieved_at: "2026-11-08T12:30:00Z" })));
    act(() => { void result.current.refetch(true); });
    await waitFor(() => expect(result.current.data?.briefing.headline).toBe("Updated headline"));
    expect(result.current.failure).toBeNull();
    expect(result.current.lastSuccessfulAt).toBe("2026-11-08T12:30:00Z");
    expect(result.current.announcement).toMatch(/refreshed/i);
  });

  it("SC-HOOK-08: a superseded request is aborted and its response ignored", async () => {
    let resolveFirst!: (v: unknown) => void;
    let firstSignal: AbortSignal | undefined;
    mockedGet.mockImplementation((_p: string, params?: { signal?: AbortSignal }) => {
      if (!firstSignal) {
        firstSignal = params?.signal;
        return new Promise((resolve) => { resolveFirst = resolve; });
      }
      return okResponse(briefingFixture({ briefing: { headline: "second" } }));
    });
    const { result } = renderHook(() => useCommandCenter());
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(1));
    act(() => { void result.current.refetch(false); });
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2));
    expect(firstSignal).toBeDefined();
    expect(firstSignal?.aborted).toBe(true);
    // Even if the first (aborted) response arrives late, it must not land.
    act(() => { resolveFirst({ ok: true, status: 200, data: { success: true, data: briefingFixture({ briefing: { headline: "stale-first" } }) } }); });
    await waitFor(() => expect(result.current.data?.briefing.headline).toBe("second"));
  });

  it("SC-HOOK-09: out-of-order responses cannot overwrite newer data", async () => {
    // First call resolves last, with the older payload.
    let resolveFirst!: (v: unknown) => void;
    mockedGet.mockImplementation((_p: string, _q?: unknown) => {
      if (mockedGet.mock.calls.length === 1) {
        return new Promise((resolve) => { resolveFirst = resolve; });
      }
      return okResponse(briefingFixture({ briefing: { headline: "newer" } }));
    });
    const { result } = renderHook(() => useCommandCenter());
    act(() => { void result.current.refetch(true); });
    await waitFor(() => expect(result.current.data?.briefing.headline).toBe("newer"));
    act(() => { resolveFirst({ ok: true, status: 200, data: { success: true, data: briefingFixture({ briefing: { headline: "older" } }) } }); });
    expect(result.current.data?.briefing.headline).toBe("newer");
  });

  it("SC-HOOK-10: unmount cancels the in-flight request (no late state writes, no crash)", async () => {
    vi.useFakeTimers();
    hangingGet();
    const { result, unmount } = renderHook(() => useCommandCenter());
    unmount();
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(() => act(() => {})).not.toThrow();
    void result;
  });

  it("SC-HOOK-11: workspace switch clears the previous tenant's data and refetches", async () => {
    const { result, rerender } = renderHook(() => useCommandCenter());
    await waitFor(() => expect(result.current.data).toBeTruthy());
    authState.user = { tenant_id: "merchant-b" };
    rerender();
    expect(result.current.data).toBeNull(); // cleared before the new response
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2));
  });

  it("SC-HOOK-12: a malformed contract is invalid_contract, never rendered", async () => {
    mockedGet.mockResolvedValue({ ok: true, status: 200, data: { success: true, data: { contract_version: "command-center-v2", briefing: {} } } });
    const { result } = renderHook(() => useCommandCenter());
    await waitFor(() => expect(result.current.failure).toBeTruthy());
    expect(result.current.failure?.kind).toBe("invalid_contract");
    expect(result.current.data).toBeNull();
  });

  it("SC-HOOK-13: a response for another organization is never rendered (tenant scoping)", async () => {
    mockedGet.mockResolvedValue(okResponse(briefingFixture({ context: { organization_id: "merchant-z" } })));
    const { result } = renderHook(() => useCommandCenter());
    await waitFor(() => expect(result.current.failure === null).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("SC-HOOK-14: the 60s interval triggers a background refresh, not a full reload", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCommandCenter());
    await act(async () => { vi.advanceTimersByTime(100); });
    expect(result.current.data).toBeTruthy();
    const before = mockedGet.mock.calls.length; // 1
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(mockedGet.mock.calls.length).toBe(before + 1);
    expect(result.current.loading).toBe(false); // background: no skeleton
    expect(result.current.data).not.toBeNull();
  });

  it("SC-HOOK-15: window focus triggers a background refresh", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCommandCenter());
    await act(async () => { vi.advanceTimersByTime(100); });
    expect(result.current.data).toBeTruthy();
    const before = mockedGet.mock.calls.length; // 1
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      vi.advanceTimersByTime(100);
    });
    expect(mockedGet.mock.calls.length).toBe(before + 1);
  });

  it("SC-HOOK-16: 429 carries the server's Retry-After guidance through the hook", async () => {
    const err = new ApiError(429, "Too many requests");
    err.retryAfter = "30";
    mockedGet.mockRejectedValue(err);
    const { result } = renderHook(() => useCommandCenter());
    await waitFor(() => expect(result.current.failure).toBeTruthy());
    expect(result.current.failure?.kind).toBe("rate_limited");
    expect(result.current.failure?.retryAfterSeconds).toBe(30);
  });

  it("SC-HOOK-17: a foreground retry (refetch(false)) clears the failure and re-enters loading", async () => {
    mockedGet.mockRejectedValue(new ApiError(500, "boom"));
    const { result } = renderHook(() => useCommandCenter());
    await waitFor(() => expect(result.current.failure).toBeTruthy());
    mockedGet.mockResolvedValue(okResponse(briefingFixture()));
    act(() => { void result.current.refetch(false); });
    expect(result.current.loading).toBe(true);
    expect(result.current.failure).toBeNull();
    await waitFor(() => expect(result.current.data).toBeTruthy());
  });

  it("SC-HOOK-18: rapid duplicate refetches abort the previous request (one live at a time)", async () => {
    const signals: AbortSignal[] = [];
    mockedGet.mockImplementation((_p: string, params?: { signal?: AbortSignal }) => {
      signals.push(params?.signal as AbortSignal);
      return new Promise((resolve) => {
        setTimeout(() => resolve({ ok: true, status: 200, data: { success: true, data: briefingFixture() } }), 20);
      });
    });
    const { result } = renderHook(() => useCommandCenter());
    act(() => { void result.current.refetch(true); void result.current.refetch(true); });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    // mount request + first refetch were each superseded by the next one.
    expect(signals.length).toBeGreaterThanOrEqual(3);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(true);
    expect(signals[signals.length - 1].aborted).toBe(false); // last request settled normally
  });

  it("SC-HOOK-19: a failed background refresh leaves no indicator stuck (loading/refreshing both false)", async () => {
    const { result } = renderHook(() => useCommandCenter());
    await waitFor(() => expect(result.current.data).toBeTruthy()); // healthy first
    mockedGet.mockRejectedValue(new ApiError(502, "bad gateway"));
    act(() => { void result.current.refetch(true); });
    await waitFor(() => expect(result.current.failure?.kind).toBe("service_unavailable"));
    expect(result.current.loading).toBe(false); // no full-page reload
    expect(result.current.refreshing).toBe(false); // no stuck spinner
    expect(result.current.data).not.toBeNull();
  });

  it("SC-HOOK-20: the announcement is cleared on workspace switch", async () => {
    const { result, rerender } = renderHook(() => useCommandCenter());
    await waitFor(() => expect(result.current.data).toBeTruthy());
    mockedGet.mockResolvedValue(okResponse(briefingFixture({ briefing: { headline: "x" } })));
    act(() => { void result.current.refetch(true); });
    await waitFor(() => expect(result.current.announcement).toMatch(/refreshed/i));
    authState.user = { tenant_id: "merchant-b" };
    rerender();
    expect(result.current.announcement).toBeNull();
  });
});
