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

import { api, ApiError } from "./api";
import { clearAuthStorage, redirectToLogin } from "@/lib/auth/session";
import { invalidateSession } from '@/lib/auth/organization';

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
  it("does not refresh a valid access token", async () => {
    localStorage.setItem("rv-auth", JSON.stringify({ state: { accessToken: jwt(Math.floor(Date.now() / 1000) + 3600) } }));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    await api.get("/dashboard/kpis");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/dashboard/kpis");
  });

  it('discards a refresh completing after logout without recreating credentials', async () => {
    let complete!: (value: Response) => void;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const pending = api.get('/dashboard/kpis');
    invalidateSession();
    localStorage.removeItem('rv-auth');
    complete(new Response(JSON.stringify({ data: { access_token: jwt(Math.floor(Date.now() / 1000) + 3600) } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await expect(pending).rejects.toThrow('Session changed');
    expect(localStorage.getItem('rv-auth')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([200, 401])('discards an old workspace response (%s) without retrying or clearing the new session', async status => {
    localStorage.setItem('rv-auth', JSON.stringify({ state: { accessToken: jwt(Math.floor(Date.now() / 1000) + 3600), user: { tenant_id: 'A' } } }));
    let complete!: (value: Response) => void;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const pending = api.get('/stores');
    const clearCalls = vi.mocked(clearAuthStorage).mock.calls.length;
    invalidateSession();
    localStorage.setItem('rv-auth', JSON.stringify({ state: { accessToken: 'workspace-B-token', user: { tenant_id: 'B' } } }));
    complete(new Response('{}', { status, headers: { 'content-type': 'application/json' } }));
    await expect(pending).rejects.toThrow('Session changed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(clearAuthStorage).toHaveBeenCalledTimes(clearCalls);
    expect(JSON.parse(localStorage.getItem('rv-auth')!).state.accessToken).toBe('workspace-B-token');
  });

  it("does not send protected requests when preflight refresh fails", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 401 }));
    await expect(api.get("/dashboard/kpis")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/auth/refresh");
    expect(clearAuthStorage).toHaveBeenCalled();
    expect(redirectToLogin).toHaveBeenCalled();
  });

  it("retries once after an unexpected 401 and reuses the refreshed token", async () => {
    localStorage.setItem("rv-auth", JSON.stringify({ state: { accessToken: jwt(Math.floor(Date.now() / 1000) + 3600) } }));
    let protectedCalls = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).endsWith("/auth/refresh")) {
        return new Response(JSON.stringify({ data: { access_token: jwt(Math.floor(Date.now() / 1000) + 7200) } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      protectedCalls++;
      return new Response("{}", { status: protectedCalls === 1 ? 401 : 200, headers: { "content-type": "application/json" } });
    });
    expect((await api.get("/dashboard/kpis")).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('organisation refresh and 2FA request context', () => {
  it('preserves the selected organisation in refresh requests', async () => {
    localStorage.setItem('rv-auth', JSON.stringify({ state: { user: { tenant_id: 'B' }, accessToken: jwt(1) } }));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => new Response(JSON.stringify(String(input).endsWith('/auth/refresh') ? { data: { access_token: jwt(Math.floor(Date.now() / 1000) + 3600) } } : {}), { status: 200, headers: { 'content-type': 'application/json' } }));
    await api.get('/stores');
    const refresh = fetchMock.mock.calls.find(([input]) => String(input).endsWith('/auth/refresh'));
    expect(JSON.parse(refresh![1]!.body as string)).toEqual({ organization_id: 'B' });
    vi.restoreAllMocks();
  });
  it('uses a 2FA challenge token without refreshing or sending an old access token', async () => {
    localStorage.setItem('rv-auth', JSON.stringify({ state: { accessToken: jwt(1) } }));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    await api.post('/auth/2fa/verify', { code: '123456' }, { accessToken: 'test-challenge', skipAuthRedirect: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]!.headers).toMatchObject({ Authorization: 'Bearer test-challenge' });
    vi.restoreAllMocks();
  });
});
