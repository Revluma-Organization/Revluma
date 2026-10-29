/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/queryClient", () => ({ queryClient: { clear: vi.fn() } }));
vi.mock("@/lib/auth/session", () => ({
  broadcastLogout: vi.fn(),
  clearAuthStorage: vi.fn(),
  redirectToLogin: vi.fn(),
  getRefreshToken: vi.fn(() => null),
  storeRefreshToken: vi.fn(),
  getAccessToken: vi.fn(() => JSON.parse(localStorage.getItem("rv-auth") || "{}").state?.accessToken ?? null),
}));

import { api } from "./api";

const jwt = (exp: number) => `header.${btoa(JSON.stringify({ exp }))}.signature`;

describe("API token refresh concurrency", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("rv-auth", JSON.stringify({ state: { accessToken: jwt(Math.floor(Date.now() / 1000) - 60) } }));
    vi.restoreAllMocks();
  });

  it("uses a single refresh for simultaneous unauthorized requests", async () => {
    let refreshCount = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/refresh")) {
        refreshCount++;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return new Response(JSON.stringify({ data: { access_token: jwt(Math.floor(Date.now() / 1000) + 3600) } }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      const stored = JSON.parse(localStorage.getItem("rv-auth") || "{}");
      const authorized = stored.state?.accessToken === jwt(Math.floor(Date.now() / 1000) + 3600);
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
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
