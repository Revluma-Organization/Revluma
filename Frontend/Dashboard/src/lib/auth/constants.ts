/** Canonical post-logout / unauthenticated landing page (exists as Frontend/auth/login.html). */
export const LOGIN_PATH = "/auth/login.html";

/** BroadcastChannel name for cross-tab auth synchronization. */
export const AUTH_CHANNEL_NAME = "revluma-auth";

/** localStorage / sessionStorage keys that hold authentication state. */
export const AUTH_STORAGE_KEYS = [
  "rv-auth",
  "revluma_refresh_token",
  "revluma_token",
  "revluma_user",
  "revluma_pending_token",
] as const;

export type AuthBroadcastMessage =
  | { type: "logout"; at: number }
  | { type: "login"; at: number };
