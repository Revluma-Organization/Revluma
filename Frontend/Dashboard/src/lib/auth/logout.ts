/**
 * Production logout orchestrator.
 *
 * Flow:
 *  1. Best-effort server revoke (refresh token + cookie).
 *  2. Clear all client auth storage.
 *  3. Clear TanStack Query caches.
 *  4. Sync logout across tabs.
 *  5. Hard-redirect to login (replace) — never leave protected history.
 *
 * Server failure never blocks local sign-out.
 */

import { api } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import {
  broadcastLogout,
  clearAuthStorage,
  getRefreshToken,
  redirectToLogin,
} from "./session";

export interface LogoutOptions {
  /** When true, revoke every refresh token for the user. */
  allSessions?: boolean;
  /** Skip navigation (used by cross-tab listeners that already have their UI). */
  skipRedirect?: boolean;
}

let logoutInFlight: Promise<void> | null = null;

function clearClientSession(): void {
  clearAuthStorage();
  try {
    queryClient.clear();
    queryClient.removeQueries();
  } catch {
    // QueryClient may not be mounted in tests / HTML pages.
  }
  broadcastLogout();
}

async function revokeServerSession(allSessions: boolean): Promise<void> {
  const refreshToken = getRefreshToken();
  const endpoint = allSessions ? "/auth/logout-all" : "/auth/logout";
  try {
    await api.post(endpoint, { refresh_token: refreshToken }, { skipAuthRedirect: true });
  } catch (err) {
    // Network / 401 / 404 — local clear still proceeds.
    console.warn("[auth] Server logout failed; clearing local session anyway.", err);
  }
}

/**
 * Perform a full enterprise logout. Concurrent callers share one in-flight promise.
 */
export async function performLogout(options: LogoutOptions = {}): Promise<void> {
  if (logoutInFlight) return logoutInFlight;

  logoutInFlight = (async () => {
    const { allSessions = false, skipRedirect = false } = options;

    await revokeServerSession(allSessions);
    clearClientSession();

    if (!skipRedirect) {
      redirectToLogin(true);
    }
  })().finally(() => {
    logoutInFlight = null;
  });

  return logoutInFlight;
}

/** Local-only purge used by cross-tab listeners (no second server call). */
export function purgeLocalSession(redirect = true): void {
  clearClientSession();
  if (redirect) redirectToLogin(true);
}
