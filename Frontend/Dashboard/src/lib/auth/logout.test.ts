import { beforeEach, describe, expect, it, vi } from "vitest";

const postMock = vi.fn();
const clearMock = vi.fn();
const removeQueriesMock = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    post: (...args: unknown[]) => postMock(...args),
  },
}));

vi.mock("@/lib/queryClient", () => ({
  queryClient: {
    clear: () => clearMock(),
    removeQueries: () => removeQueriesMock(),
  },
}));

import { performLogout, purgeLocalSession } from "./logout";
import { LOGIN_PATH } from "./constants";

describe("performLogout", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    postMock.mockReset();
    clearMock.mockReset();
    removeQueriesMock.mockReset();
    vi.restoreAllMocks();

    localStorage.setItem(
      "rv-auth",
      JSON.stringify({ state: { user: { id: "1" }, csrfToken: "tok" }, version: 0 }),
    );
    localStorage.setItem("revluma_refresh_token", "refresh-xyz");
  });

  it("revokes server session, clears storage, and redirects to login", async () => {
    postMock.mockResolvedValue({ ok: true, status: 200, data: { success: true } });
    const replace = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        pathname: "/dashboard/overview",
        href: "http://localhost/dashboard/overview",
        replace,
      },
    });

    await performLogout();

    expect(postMock).toHaveBeenCalledWith(
      "/auth/logout",
      { refresh_token: "refresh-xyz" },
      { skipAuthRedirect: true },
    );
    expect(localStorage.getItem("rv-auth")).toBeNull();
    expect(localStorage.getItem("revluma_refresh_token")).toBeNull();
    expect(clearMock).toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith(LOGIN_PATH);
  });

  it("still clears local session when the server logout returns 404", async () => {
    postMock.mockRejectedValue(new Error("API error 404: Not Found"));
    const replace = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        pathname: "/dashboard/settings",
        href: "http://localhost/dashboard/settings",
        replace,
      },
    });

    await performLogout();

    expect(localStorage.getItem("rv-auth")).toBeNull();
    expect(replace).toHaveBeenCalledWith(LOGIN_PATH);
  });

  it("calls logout-all when requested", async () => {
    postMock.mockResolvedValue({ ok: true, status: 200, data: {} });
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        pathname: "/dashboard/overview",
        replace: vi.fn(),
      },
    });

    await performLogout({ allSessions: true, skipRedirect: true });
    expect(postMock).toHaveBeenCalledWith(
      "/auth/logout-all",
      { refresh_token: "refresh-xyz" },
      { skipAuthRedirect: true },
    );
  });

  it("purgeLocalSession clears without calling the API", () => {
    const replace = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        pathname: "/dashboard/overview",
        replace,
      },
    });

    purgeLocalSession(true);
    expect(postMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("rv-auth")).toBeNull();
    expect(replace).toHaveBeenCalledWith(LOGIN_PATH);
  });
});
