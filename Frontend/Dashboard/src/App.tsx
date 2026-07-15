import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useThemeStore } from './store';
import { useAuthStore } from './store/authStore';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AuthSync } from './components/AuthSync';
import { DashboardRoutes } from './routes';
import LoginRedirect from './pages/LoginRedirect';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { TooltipProvider } from './components/ui/tooltip';
import { Toaster as Sonner } from './components/ui/sonner';
import { Toaster } from './components/ui/toaster';
import NotFound from './pages/NotFound';
import { getAccessToken } from './lib/auth/session';

function App() {
  const initializeTheme = useThemeStore((s) => s.initializeTheme);
  const checkSession = useAuthStore((s) => s.checkSession);
  const isHydrated = useAuthStore((s) => s.isHydrated);

  useEffect(() => {
    initializeTheme();
  }, [initializeTheme]);

  useEffect(() => {
    if (!isHydrated) return;
    // Only hit the network when a token exists — avoids redirect loops for guests.
    if (getAccessToken()) {
      void checkSession();
    }
  }, [isHydrated, checkSession]);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthSync />
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <Routes>
            <Route
              path="/dashboard/*"
              element={
                <ProtectedRoute>
                  <DashboardRoutes />
                </ProtectedRoute>
              }
            />
            <Route path="/login" element={<LoginRedirect />} />
            <Route path="/" element={<Navigate to="/dashboard/overview" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
