import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { LOGIN_PATH } from '@/lib/auth/constants';
import type { ReactNode } from 'react';

interface ProtectedRouteProps {
  children: ReactNode;
}

/**
 * Blocks protected UI until auth state has hydrated, then redirects
 * unauthenticated users to login without rendering dashboard content.
 */
export const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const user = useAuthStore((s) => s.user);
  const csrfToken = useAuthStore((s) => s.csrfToken);
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const location = useLocation();

  if (!isHydrated) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-background"
        aria-busy="true"
        aria-label="Loading session"
      />
    );
  }

  const isAuthenticated = Boolean(user && csrfToken);
  if (!isAuthenticated) {
    // Prefer hard navigate to the static login page (outside the SPA).
    // Navigate is used as a fallback for in-app /login route.
    if (typeof window !== 'undefined') {
      const returnTo = encodeURIComponent(location.pathname + location.search);
      window.location.replace(`${LOGIN_PATH}?next=${returnTo}`);
      return null;
    }
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
};
