// src/lib/api.ts
// Centralized HTTP client for the entire Revluma frontend.
// No component ever calls raw fetch() — all requests go through api.get/post/put/delete.

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

// Token reader
// Zustand persists auth under localStorage key "rv-auth":
// { state: { user: {...}, csrfToken: "..." }, version: 0 }

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

// 401 handler

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
  // Disabled for mockup mode to allow viewing dashboard without auth
  // window.location.href = "/login";
}

const BASE_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8080";

// Core request 

// Add isRetry: boolean = false to the arguments
async function request<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  options: { params?: Record<string, unknown>; body?: unknown } = {},
  isRetry: boolean = false 
): Promise<ApiResponse<T>> {
  
  const url = new URL(
    path.startsWith("/") ? `${BASE_URL}${path}` : `${BASE_URL}/${path}`,
  );

  if (options.params) {
    Object.entries(options.params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    });
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const token = getToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let response: Response;
  try {
            response = await fetch(url.toString(), {
          method,
          headers,
          credentials: "include", 
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        });
  } catch (networkError) {
    // Network error (backend unreachable, CORS preflight failed, etc.)
    throw new ApiError(0, `Network error: ${(networkError as Error).message}`);
  }

      // --- START REFRESH LOGIC ---
    if (response.status === 401 && !isRetry) {
      try {
        // Attempt to refresh the token using the HttpOnly cookie
        const refreshResponse = await fetch(`${BASE_URL}/auth/refresh`, {
          method: 'POST',
          credentials: 'include', // This sends the cookie
        });

        if (refreshResponse.ok) {
          // If successful, the backend should return the new token
          const { accessToken } = await refreshResponse.json();
          
          // Update localStorage so getToken() works next time
          const raw = localStorage.getItem("rv-auth");
          if (raw) {
             const parsed = JSON.parse(raw);
             // Update the token in your storage object (adjust if your structure differs)
             parsed.state.accessToken = accessToken; 
             localStorage.setItem("rv-auth", JSON.stringify(parsed));
          }

          // RETRY the original request!
          return await request(method, path, options, true);
        }
      } catch (e) {
        // Refresh failed, proceed to logout
      }
    }
    // --- END REFRESH LOGIC ---

    // If we get here, it's a real 401, or refresh failed
    if (response.status === 401) {
      handleUnauthorized();
      throw new ApiError(401, "Unauthorized – redirecting to login");
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

// Helpers 

function get<T = unknown>(path: string, params?: Record<string, unknown>): Promise<ApiResponse<T>> {
  return request<T>("GET", path, { params });
}

function post<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>> {
  return request<T>("POST", path, { body });
}

function put<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>> {
  return request<T>("PUT", path, { body });
}

function patch<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>> {
  return request<T>("PATCH", path, { body });
}

function del<T = unknown>(path: string): Promise<ApiResponse<T>> {
  return request<T>("DELETE", path);
}

export const api = { get, post, put, patch, delete: del };
export default api;
