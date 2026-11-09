import { QueryClient } from "@tanstack/react-query";

export function shouldRetryWorkspaceQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: unknown }).status) : 0;
  // Authorization, validation and caller cancellation need a merchant action,
  // not an automatic duplicate request. Transient transport/rate/server errors
  // receive one bounded retry.
  return status === 0 && (error as { message?: string })?.message !== "The request was cancelled."
    || status === 429 || status >= 500;
}

/** Shared QueryClient — caches are purged on logout and organization switches. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: shouldRetryWorkspaceQuery, staleTime: 30_000, gcTime: 5 * 60_000 },
    mutations: { retry: false },
  },
});
