// src/lib/api.ts
// Task 1.FE2.3 — Centralized HTTP Layer
//
// The single HTTP communication layer for the entire Revluma frontend.
// No component ever calls raw fetch() — everything goes through api.get / post / put / delete.
//
// What it does
// • baseURL from import.meta.env.VITE_API_URL (.env.local)
// • Every request automatically gets Authorization: Bearer <token>
//   Token is read from Zustand's persisted "rv-auth" localStorage key (state.csrfToken)
// • 401 responses: clears auth state, redirects to /login
//
// Week 3 wiring example
// import { api } from "@/lib/api";
// const res = await api.get<KpiResponse>("/dashboard/kpis", { period: "7d" });
// setKpi(res.data.kpi);

// Types

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

//Token reader
// Zustand persists auth under localStorage key "rv-auth":
// { state: { user: {...}, csrfToken: "..." }, version: 0 }
// Week 2: Afolabi's login endpoint stores the JWT in authStore.setCsrfToken(token)
// this reader picks it up automatically, no changes needed here.

function getToken(): string | null {
  try {
    const raw = localStorage.getItem("rv-auth");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { csrfToken?: string | null } };
    return parsed?.state?.csrfToken ?? null;
  } catch {
    return null;
  }
}

//401 handler
// Surgically clears user + csrfToken from the persisted Zustand state without
// wiping theme / UI preferences stored in other localStorage keys.

function handleUnauthorized(): void {
  try {
    const raw = localStorage.getItem("rv-auth");
    if (raw) {
      const parsed = JSON.parse(raw) as { state?: object; version?: number };
      if (parsed?.state) {
        parsed.state = { ...parsed.state, user: null, csrfToken: null };
        localStorage.setItem("rv-auth", JSON.stringify(parsed));
      }
    }
  } catch {
    localStorage.removeItem("rv-auth");
  }
  window.location.href = "/login";
}

// Base URL

const BASE_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3000";

// Core request

async function request<T = unknown>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  options: { params?: Record<string, unknown>; body?: unknown } = {},
): Promise<ApiResponse<T>> {
  // Build URL
  const url = new URL(
    path.startsWith("/") ? `${BASE_URL}${path}` : `${BASE_URL}/${path}`,
  );
  if (options.params) {
    Object.entries(options.params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    });
  }

  // Headers
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  // Fetch
  const response = await fetch(url.toString(), {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  // 401 token expired
  if (response.status === 401) {
    handleUnauthorized();
    throw new ApiError(401, "Unauthorized — redirecting to login");
  }

  // Parse body
  let data: T;
  const ct = response.headers.get("content-type") ?? "";
  data = ct.includes("application/json")
    ? ((await response.json()) as T)
    : (null as unknown as T);

  // Non-2xx
  if (!response.ok) {
    throw new ApiError(response.status, `API error ${response.status}: ${response.statusText}`, data);
  }

  return { data, status: response.status, ok: response.ok };
}

//Helpers

function get<T = unknown>(path: string, params?: Record<string, unknown>): Promise<ApiResponse<T>> {
  return request<T>("GET", path, { params });
}

function post<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>> {
  return request<T>("POST", path, { body });
}

function put<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>> {
  return request<T>("PUT", path, { body });
}

function del<T = unknown>(path: string): Promise<ApiResponse<T>> {
  return request<T>("DELETE", path);
}

// ─── Export ───────────────────────────────────────────────────────────────────

export const api = { get, post, put, delete: del };
export default api;
