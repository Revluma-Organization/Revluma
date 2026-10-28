/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/queryClient", () => ({ queryClient: { clear: vi.fn() } }));
vi.mock("@/lib/auth/session", () => ({
  broadcastLogout: vi.fn(),
  clearAuthStorage: vi.fn(),
  redirectToLogin: vi.fn(),
  getRefreshToken: vi.fn(() => null),
  storeRefreshToken: vi.fn(),
  getAccessToken: vi.fn(() => localStorage.getItem("access_token")),
}));

import { api } from "./api";

describe("API token refresh concurrency", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("access_token", "expired");
    localStorage.setItem("rv-auth", JSON.stringify({ state: { accessToken: "expired" } }));
    vi.restoreAllMocks();
  });

  it("uses a single refresh for simultaneous unauthorized requests", async () => {
    let refreshCount = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/refresh")) {
        refreshCount++;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return new Response(JSON.stringify({ data: { access_token: "fresh" } }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      const stored = JSON.parse(localStorage.getItem("rv-auth") || "{}");
      const authorized = stored.state?.accessToken === "fresh";
      return new Response(JSON.stringify({ success: authorized }), {
        status: authorized ? 200 : 401,
        headers: { "content-type": "application/json" },
      });
    });
    const results = await Promise.all([
      api.get("/dashboard/activity"),
      api.get("/dashboard/operations"),
      api.get("/dashboard/kpis"),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(refreshCount).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });
});
