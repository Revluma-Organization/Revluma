// src/lib/api.ts
// Centralized HTTP client for the entire Revluma frontend.
// No component ever calls raw fetch() — all requests go through api.get/post/put/delete.

import {
  broadcastLogout,
  clearAuthStorage,
  getAccessToken,
  getRefreshToken,
  redirectToLogin,
  storeRefreshToken,
} from "@/lib/auth/session";
import { queryClient } from "@/lib/queryClient";

function handleUnauthorized(): void {
  clearAuthStorage();
  try {
    queryClient.clear();
  } catch {
    // ignore
  }
  broadcastLogout();
  redirectToLogin(true);
}

export interface ApiResponse<T = unknown> {
  data: T;
  status: number;
  ok: boolean;
}

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export interface RequestOptions {
  params?: Record<string, unknown>;
  body?: unknown;
  /** When true, 401 does not purge session / redirect (used by logout + refresh). */
  skipAuthRedirect?: boolean;
}

/**
 * Resolve API base URL.
 * Prefer VITE_API_URL. Always ensure `/api/v1` suffix so paths like `/auth/logout`
 * hit `POST /api/v1/auth/logout` on the Express backend.
 */
function resolveBaseUrl(): string {
  const raw =
    (import.meta.env.VITE_API_URL as string | undefined)?.trim() ||
    "http://localhost:8000/api/v1";

  const normalized = raw.replace(/\/+$/, "");
  if (normalized.endsWith("/api/v1")) return normalized;
  return `${normalized}/api/v1`;
}

const BASE_URL = resolveBaseUrl();

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

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  try {
    const response = await fetch(`${BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as {
      data?: { access_token?: string; refresh_token?: string };
      accessToken?: string;
    };

    const accessToken =
      payload?.data?.access_token ?? payload?.accessToken ?? null;
    const newRefresh = payload?.data?.refresh_token;

    if (!accessToken) return null;

    updateStoredAccessToken(accessToken);
    if (newRefresh) storeRefreshToken(newRefresh);

    return accessToken;
  } catch {
    return null;
  }
}

async function request<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  options: RequestOptions = {},
  isRetry = false,
): Promise<ApiResponse<T>> {
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

  const headers: Record<string, string> = {};
  
  // Only set application/json if we are NOT sending a file
  if (!isFormData) {
    headers["Content-Type"] = "application/json";
  }

  const token = getAccessToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method,
      headers,
      credentials: "include",
      // Pass FormData directly so fetch can auto-generate the multipart boundary!
      body: isFormData 
        ? (options.body as FormData) 
        : (options.body !== undefined ? JSON.stringify(options.body) : undefined),
    });
  } catch (networkError) {
    throw new ApiError(0, `Network error: ${(networkError as Error).message}`);
  }

  if (response.status === 401 && !isRetry && !options.skipAuthRedirect) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return request<T>(method, path, options, true);
    }
    handleUnauthorized();
    throw new ApiError(401, "Unauthorized – redirecting to login");
  }

  if (response.status === 401 && options.skipAuthRedirect) {
    throw new ApiError(401, "Unauthorized");
  }

  const ct = response.headers.get("content-type") ?? "";
  const data = ct.includes("application/json")
    ? ((await response.json()) as T)
    : (null as unknown as T);

  if (!response.ok) {
    throw new ApiError(
      response.status,
      `API error ${response.status}: ${response.statusText}`,
      data,
    );
  }

  return { data, status: response.status, ok: response.ok };
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
