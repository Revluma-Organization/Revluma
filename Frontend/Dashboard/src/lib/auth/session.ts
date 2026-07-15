/**
 * Centralized client-side session management.
 * All logout / purge paths must go through these helpers — no duplicated clears.
 */

import {
  AUTH_CHANNEL_NAME,
  AUTH_STORAGE_KEYS,
  LOGIN_PATH,
  type AuthBroadcastMessage,
} from "./constants";

let authChannel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    return null;
  }
  if (!authChannel) {
    authChannel = new BroadcastChannel(AUTH_CHANNEL_NAME);
  }
  return authChannel;
}

/** Remove every auth-related key from localStorage and sessionStorage. */
export function clearAuthStorage(): void {
  for (const key of AUTH_STORAGE_KEYS) {
    try {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    } catch {
      // Storage may be unavailable (private mode / iframe restrictions).
    }
  }
}

/** Persist refresh token for server-side revocation on logout. */
export function storeRefreshToken(token: string | null | undefined): void {
  try {
    if (token) {
      localStorage.setItem("revluma_refresh_token", token);
    } else {
      localStorage.removeItem("revluma_refresh_token");
    }
  } catch {
    // ignore
  }
}

export function getRefreshToken(): string | null {
  try {
    return (
      localStorage.getItem("revluma_refresh_token") ||
      sessionStorage.getItem("revluma_refresh_token")
    );
  } catch {
    return null;
  }
}

/**
 * Read the access token from either localStorage or sessionStorage
 * (login.html may use sessionStorage when "remember me" is off).
 */
export function getAccessToken(): string | null {
  for (const storage of [localStorage, sessionStorage]) {
    try {
      const raw = storage.getItem("rv-auth");
      if (!raw) continue;
      const parsed = JSON.parse(raw) as {
        state?: { accessToken?: string; csrfToken?: string };
      };
      const token = parsed?.state?.accessToken ?? parsed?.state?.csrfToken ?? null;
      if (token) return token;
    } catch {
      // continue
    }
  }
  return null;
}

/** Notify sibling tabs that the session ended. */
export function broadcastLogout(): void {
  const message: AuthBroadcastMessage = { type: "logout", at: Date.now() };
  try {
    getChannel()?.postMessage(message);
  } catch {
    // ignore
  }
  try {
    // storage event fallback for older browsers / Safari quirks
    localStorage.setItem("revluma_auth_event", JSON.stringify(message));
    localStorage.removeItem("revluma_auth_event");
  } catch {
    // ignore
  }
}

export function broadcastLogin(): void {
  const message: AuthBroadcastMessage = { type: "login", at: Date.now() };
  try {
    getChannel()?.postMessage(message);
  } catch {
    // ignore
  }
}

/**
 * Subscribe to cross-tab auth events. Returns an unsubscribe function.
 */
export function onAuthBroadcast(
  handler: (message: AuthBroadcastMessage) => void,
): () => void {
  const channel = getChannel();
  const onMessage = (event: MessageEvent<AuthBroadcastMessage>) => {
    if (event?.data?.type) handler(event.data);
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== "revluma_auth_event" || !event.newValue) return;
    try {
      const parsed = JSON.parse(event.newValue) as AuthBroadcastMessage;
      if (parsed?.type) handler(parsed);
    } catch {
      // ignore
    }
  };

  channel?.addEventListener("message", onMessage);
  window.addEventListener("storage", onStorage);

  return () => {
    channel?.removeEventListener("message", onMessage);
    window.removeEventListener("storage", onStorage);
  };
}

/** Hard navigate to the login page without leaving protected history entries. */
export function redirectToLogin(replace = true): void {
  if (typeof window === "undefined") return;
  // Avoid redirect loops if we are already on an auth page.
  const path = window.location.pathname;
  if (path.startsWith("/auth/") || path === "/login") return;

  if (replace) {
    window.location.replace(LOGIN_PATH);
  } else {
    window.location.href = LOGIN_PATH;
  }
}

export { LOGIN_PATH };
