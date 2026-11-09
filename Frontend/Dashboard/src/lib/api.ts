import { storedOrganizationId, notifySessionTokenChanged, currentSessionGeneration, assertCurrentSession } from '@/lib/auth/organization';
// src/lib/api.ts
// Centralized HTTP client for the entire Revluma frontend.
// No component ever calls raw fetch() — all requests go through api.get/post/put/delete.

import {
  broadcastLogout,
  clearAuthStorage,
  getAccessToken,
  getRefreshToken,
  redirectToLogin,
} from "@/lib/auth/session";
import { queryClient } from "@/lib/queryClient";

export function handleUnauthorized(): void {
  clearAuthStorage();
  try {
    queryClient.clear();
  } catch {
    // Query cache may be unavailable during a very early authentication failure.
  }
  broadcastLogout();
  redirectToLogin(true);
}

/** Sanitised request correlation: never include merchant payloads in telemetry. */
export function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ??
    `rv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export interface ApiResponse<T = unknown> {
  data: T;
  status: number;
  ok: boolean;
  correlationId: string;
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  /** Raw Retry-After header (delta-seconds or HTTP-date), when the server sent one. */
  retryAfter: string | null;
  correlationId: string | null;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.retryAfter = null;
    this.correlationId = null;
  }
}

export interface RequestOptions {
  /** Explicit short-lived challenge token, used only for 2FA verification. */
  accessToken?: string;
  params?: Record<string, unknown>;
  body?: unknown;
  /** When true, 401 does not purge session / redirect (used by logout + refresh). */
  skipAuthRedirect?: boolean;
  /** Allows page/store changes to cancel obsolete read requests. */
  signal?: AbortSignal;
  /** Bounded transport time; caller cancellation remains distinct from timeout. */
  timeoutMs?: number;
  /** Stable request identifier for server-side diagnostics (never a secret). */
  requestId?: string;
}

/**
 * Resolve API base URL.
 * Prefer VITE_API_URL. Always ensure `/api/v1` suffix so paths like `/auth/logout`
 * hit `POST /api/v1/auth/logout` on the Express backend.
 */
export function resolveApiBaseUrl(rawValue: string | undefined, production = import.meta.env.PROD): string {
  const raw = rawValue?.trim() || (production ? "" : "http://localhost:8000/api/v1");
  if (!raw) throw new Error("VITE_API_URL is required for a production build.");
  const normalized = raw.replace(/\/+$/, "");
  const base = normalized.endsWith("/api/v1") ? normalized : `${normalized}/api/v1`;
  const parsed = new URL(base);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (production && (parsed.protocol !== "https:" || local)) {
    throw new Error("Production API URL must use HTTPS and cannot target a local service.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("API URL must use HTTP or HTTPS.");
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("API URL cannot contain credentials, query parameters or fragments.");
  return base;
}

function resolveBaseUrl(): string {
  return resolveApiBaseUrl(import.meta.env.VITE_API_URL as string | undefined);
}

const BASE_URL = resolveBaseUrl();

/** Base URL for callers that must build a custom request (e.g. SSE streaming). */
export function getApiBaseUrl(): string {
  return BASE_URL;
}

/**
 * Resolve an access token for a streaming fetch, performing the same preflight
 * refresh as the JSON client so a long-lived page does not open a stream with
 * an expired token.
 */
export async function getStreamingAuthHeaders(): Promise<Record<string, string>> {
  const generation = currentSessionGeneration();
  assertCurrentSession(generation);
  const token = getAccessToken();
  if (token && isAccessTokenExpiring(token)) {
    const refreshed = await refreshAccessToken();
    assertCurrentSession(generation);
    if (!refreshed) {
      handleUnauthorized();
      throw new ApiError(401, "Session expired – please sign in again");
    }
  }
  assertCurrentSession(generation);
  const current = getAccessToken();
  return current ? { Authorization: `Bearer ${current}` } : {};
}

function updateStoredAccessToken(accessToken: string): void {
  for (const storage of [localStorage, sessionStorage]) {
    try {
      const raw = storage.getItem("rv-auth");
      if (!raw) continue;
      const parsed = JSON.parse(raw) as {
        state?: Record<string, unknown>;
        version?: number;
      };
      if (!parsed.state) continue;
      parsed.state.csrfToken = accessToken;
      parsed.state.accessToken = accessToken;
      storage.setItem("rv-auth", JSON.stringify(parsed));
    } catch {
      // ignore
    }
  }
}

const TOKEN_REFRESH_LEEWAY_MS = 60_000;

/** Inspect only JWT expiry metadata; signature validation remains server-side. */
function isAccessTokenExpiring(token: string): boolean {
  try {
    const payload = token.split(".")[1];
    if (!payload) return true;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(normalized)) as { exp?: unknown };
    return typeof claims.exp !== "number" ||
      claims.exp * 1000 <= Date.now() + TOKEN_REFRESH_LEEWAY_MS;
  } catch {
    return true;
  }
}

let refreshInFlight: Promise<string | null> | null = null;

async function performTokenRefresh(): Promise<string | null> {
  const generation = currentSessionGeneration();
  const originalToken = getAccessToken();
  try {
    const response = await fetch(`${BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include", // Sends the HttpOnly cookie automatically
      body: JSON.stringify({
        organization_id: storedOrganizationId(),
        ...(getRefreshToken() ? { refresh_token: getRefreshToken() } : {}),
      }),
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as {
      data?: { access_token?: string };
      accessToken?: string;
    };

    const accessToken =
      payload?.data?.access_token ?? payload?.accessToken ?? null;

    if (!accessToken) return null;

    assertCurrentSession(generation);
    if (getAccessToken() !== originalToken) return null;
    updateStoredAccessToken(accessToken);
    notifySessionTokenChanged(accessToken);
    return accessToken;
  } catch {
    return null;
  }
}

/** Share one refresh across simultaneous 401 responses. Refresh tokens rotate on use. */
function refreshAccessToken(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = performTokenRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

function requestAbort(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = globalThis.setTimeout(() => { timedOut = true; controller.abort(); }, Math.max(1, timeoutMs));
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    clear: () => { globalThis.clearTimeout(timer); signal?.removeEventListener("abort", abort); },
  };
}

async function request<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  options: RequestOptions = {},
  isRetry = false,
): Promise<ApiResponse<T>> {
  const generation = currentSessionGeneration();
  assertCurrentSession(generation);
  const url = new URL(
    path.startsWith("/") ? `${BASE_URL}${path}` : `${BASE_URL}/${path}`,
  );

  if (options.params) {
    Object.entries(options.params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    });
  }

    // Detect if the body is a file upload (FormData)
  const isFormData = options.body instanceof FormData;

  const correlationId = options.requestId ?? createRequestId();
  const headers: Record<string, string> = { "X-Request-ID": correlationId };

  // Avoid a needless CORS preflight on bodyless reads and let multipart fetch
  // generate its own boundary.
  if (!isFormData && options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  // Preflight refresh prevents avoidable 401s when opening a dashboard with a
  // previously persisted, expired JWT. Concurrent requests share one refresh.
  if (!isRetry && !options.skipAuthRedirect && !options.accessToken) {
    if (refreshInFlight) await refreshInFlight;
    assertCurrentSession(generation);
    const currentToken = getAccessToken();
    if (currentToken && isAccessTokenExpiring(currentToken)) {
      const refreshed = await refreshAccessToken();
      assertCurrentSession(generation);
      if (!refreshed) {
        handleUnauthorized();
        throw new ApiError(401, "Session expired – please sign in again");
      }
    }
  }
  assertCurrentSession(generation);
  const token = options.accessToken || getAccessToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  const transport = requestAbort(options.signal, options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
  try {
    response = await fetch(url.toString(), {
      method,
      headers,
      credentials: "include",
      signal: transport.signal,
      body: isFormData
        ? (options.body as FormData)
        : (options.body !== undefined ? JSON.stringify(options.body) : undefined),
    });
  } catch (networkError) {
    if (transport.timedOut()) throw new ApiError(0, "The request timed out. Please try again.");
    if (options.signal?.aborted || (networkError as Error)?.name === "AbortError") {
      throw new ApiError(0, "The request was cancelled.");
    }
    throw new ApiError(0, "The service could not be reached. Check your connection and try again.");
  } finally {
    transport.clear();
  }

  assertCurrentSession(generation);
  if (response.status === 401 && !isRetry && !options.skipAuthRedirect) {
    // Another request may have rotated the token while this one was in flight.
    // Reuse that new token before attempting another refresh.
    const newerToken = getAccessToken();
    const refreshed = newerToken && newerToken !== token
      ? newerToken
      : await refreshAccessToken();
    assertCurrentSession(generation);
    if (refreshed) {
      return request<T>(method, path, { ...options, requestId: correlationId }, true);
    }
    handleUnauthorized();
    throw new ApiError(401, "Unauthorized – redirecting to login");
  }

  if (response.status === 401 && isRetry && !options.skipAuthRedirect) {
    handleUnauthorized();
    throw new ApiError(401, "Session expired – please sign in again");
  }

  if (response.status === 401 && options.skipAuthRedirect) {
    throw new ApiError(401, "Unauthorized");
  }

  const ct = response.headers.get("content-type") ?? "";
  let data: T;
  try {
    data = ct.includes("application/json")
      ? ((await response.json()) as T)
      : (null as unknown as T);
  } catch {
    throw new ApiError(response.status, "The service returned an unreadable response. Please try again.");
  }
  assertCurrentSession(generation);
  const responseCorrelationId = response.headers.get("x-request-id") ?? correlationId;

  if (!response.ok) {
    const errorBody = data as {
      error?: string;
      message?: string;
      errors?: Array<string | { msg?: string; message?: string }>;
    } | null;
    const firstValidationError = Array.isArray(errorBody?.errors)
      ? errorBody.errors.map((item) => typeof item === "string" ? item : item?.msg || item?.message).find(Boolean)
      : undefined;
    const safeMessage = errorBody?.error || errorBody?.message || firstValidationError;
    const apiError = new ApiError(
      response.status,
      safeMessage || `Request failed (${response.status}). Please try again.`,
      data,
    );
    // Task 220 — surface rate-limit / service retry guidance so the UI can
    // honor it (disabled retry + countdown) instead of inviting a loop.
    apiError.retryAfter = response.headers.get("retry-after");
    apiError.correlationId = responseCorrelationId;
    throw apiError;
  }

  return { data, status: response.status, ok: response.ok, correlationId: responseCorrelationId };
}

function get<T = unknown>(
  path: string,
  params?: Record<string, unknown>,
  options?: Omit<RequestOptions, "params" | "body">,
): Promise<ApiResponse<T>> {
  return request<T>("GET", path, { ...options, params });
}

function post<T = unknown>(
  path: string,
  body?: unknown,
  options?: Omit<RequestOptions, "body">,
): Promise<ApiResponse<T>> {
  return request<T>("POST", path, { ...options, body });
}

function put<T = unknown>(
  path: string,
  body?: unknown,
  options?: Omit<RequestOptions, "body">,
): Promise<ApiResponse<T>> {
  return request<T>("PUT", path, { ...options, body });
}

function patch<T = unknown>(
  path: string,
  body?: unknown,
  options?: Omit<RequestOptions, "body">,
): Promise<ApiResponse<T>> {
  return request<T>("PATCH", path, { ...options, body });
}

function del<T = unknown>(
  path: string,
  options?: Omit<RequestOptions, "params" | "body">,
): Promise<ApiResponse<T>> {
  return request<T>("DELETE", path, options);
}

export const api = { get, post, put, patch, delete: del, baseUrl: BASE_URL };
export default api;
