import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import type { ReactNode } from 'react';

interface ProtectedRouteProps {
  children: ReactNode;
}

export const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const user = useAuthStore((s) => s.user);
  const isHydrated = useAuthStore((s) => s.isHydrated);

  // Wait for Zustand localStorage hydration before any redirect decision
  // This prevents a flash redirect when the page first loads with a valid token
  if (!isHydrated) return null;

  if (!user) return <Navigate to="/login" replace />;

  return <>{children}</>;
};