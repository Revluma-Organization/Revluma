import { QueryClient } from "@tanstack/react-query";

/** Shared QueryClient — must be imported by App and by logout so caches clear on sign-out. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});
