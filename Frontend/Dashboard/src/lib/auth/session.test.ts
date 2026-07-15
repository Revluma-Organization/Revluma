import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_STORAGE_KEYS,
  LOGIN_PATH,
} from "./constants";
import {
  clearAuthStorage,
  getAccessToken,
  getRefreshToken,
  redirectToLogin,
  storeRefreshToken,
} from "./session";

describe("auth session helpers", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("stores and reads refresh tokens", () => {
    storeRefreshToken("refresh-abc");
    expect(getRefreshToken()).toBe("refresh-abc");
    storeRefreshToken(null);
    expect(getRefreshToken()).toBeNull();
  });

  it("reads access tokens from localStorage rv-auth", () => {
    localStorage.setItem(
      "rv-auth",
      JSON.stringify({ state: { csrfToken: "access-1" }, version: 0 }),
    );
    expect(getAccessToken()).toBe("access-1");
  });

  it("reads access tokens from sessionStorage when localStorage is empty", () => {
    sessionStorage.setItem(
      "rv-auth",
      JSON.stringify({ state: { accessToken: "access-2" }, version: 0 }),
    );
    expect(getAccessToken()).toBe("access-2");
  });

  it("clears every auth storage key from local and session storage", () => {
    for (const key of AUTH_STORAGE_KEYS) {
      localStorage.setItem(key, "x");
      sessionStorage.setItem(key, "y");
    }
    clearAuthStorage();
    for (const key of AUTH_STORAGE_KEYS) {
      expect(localStorage.getItem(key)).toBeNull();
      expect(sessionStorage.getItem(key)).toBeNull();
    }
  });

  it("redirects to the real login page with location.replace", () => {
    const replace = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        pathname: "/dashboard/overview",
        href: "http://localhost/dashboard/overview",
        replace,
      },
    });

    redirectToLogin(true);
    expect(replace).toHaveBeenCalledWith(LOGIN_PATH);
  });

  it("does not redirect when already on an auth page", () => {
    const replace = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        pathname: "/auth/login.html",
        href: "http://localhost/auth/login.html",
        replace,
      },
    });

    redirectToLogin(true);
    expect(replace).not.toHaveBeenCalled();
  });
});
