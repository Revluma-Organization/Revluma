import { lazy, Suspense, useEffect } from 'react';
import { MotionConfig } from 'framer-motion';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useThemeStore } from './store';
import { useAuthStore } from './store/authStore';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AuthSync } from './components/AuthSync';
import { DashboardRoutes } from './routes';
import { DashboardLayout } from './components/layout/DashboardLayout';
import Overview from './pages/Overview';
import LoginRedirect from './pages/LoginRedirect';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { TooltipProvider } from './components/ui/tooltip';
import { Toaster as Sonner } from './components/ui/sonner';
import { Toaster } from './components/ui/toaster';
import NotFound from './pages/NotFound';
import ForgotPassword from "./pages/auth/ForgotPassword";
import InviteAccept from './pages/InviteAccept';
import { getAccessToken } from './lib/auth/session';

const AutomationPreview = import.meta.env.DEV
  ? lazy(() => import('./pages/settings/AutomationPreview'))
  : null;

function App() {
  const automationPreviewPath = import.meta.env.DEV && window.location.pathname === '/dashboard/__preview/automation';
  const initializeTheme = useThemeStore((s) => s.initializeTheme);
  const checkSession = useAuthStore((s) => s.checkSession);
  const isHydrated = useAuthStore((s) => s.isHydrated);

  useEffect(() => {
    return initializeTheme();
  }, [initializeTheme]);

  useEffect(() => {
    if (automationPreviewPath || !isHydrated) return;
    // Only hit the network when a token exists — avoids redirect loops for guests.
    if (getAccessToken()) {
      void checkSession();
    }
  }, [isHydrated, checkSession, automationPreviewPath]);

  // Sample presentation never mounts authentication synchronisation or session requests.
  if (automationPreviewPath && AutomationPreview) {
    return ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
      ? <Suspense fallback={<p>Loading preview…</p>}><AutomationPreview /></Suspense>
      : <NotFound />;
  }

  return (
    // Task 220 — honor the OS reduced-motion preference for every
    // framer-motion animation in the app (orbs, wiggles, orbit rings,
    // page transitions) without disabling functional state changes.
    <MotionConfig reducedMotion="user">
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthSync />
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <Routes>
            {import.meta.env.DEV && (
              <Route
                path="/dashboard/__preview"
                element={
                  ["localhost", "127.0.0.1"].includes(window.location.hostname)
                    ? <DashboardLayout />
                    : <NotFound />
                }
              >
                <Route
                  index
                  element={
                    <>
                      <div
                        role="status"
                        className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-t1"
                      >
                        Local UI preview only. Backend unavailable.
                        Store information and intelligence findings are not verified.
                      </div>
                      <Overview />
                    </>
                  }
                />
              </Route>
            )}
            <Route
              path="/dashboard/*"
              element={
                <ProtectedRoute>
                  <DashboardRoutes />
                </ProtectedRoute>
              }
            />
            <Route path="/login" element={<LoginRedirect />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/invite/accept" element={<InviteAccept />} />
            <Route path="/" element={<Navigate to="/dashboard/overview" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
    </MotionConfig>
  );
}

export default App;
