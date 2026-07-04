import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useThemeStore } from './store';
import { useAuthStore } from './store/authStore';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { DashboardRoutes } from './routes';
import LoginRedirect from './pages/LoginRedirect';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from './components/ui/tooltip';
import { Toaster as Sonner } from './components/ui/sonner';
import { Toaster } from './components/ui/toaster';
import NotFound from './pages/NotFound';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

function App() {
  const initializeTheme = useThemeStore((s) => s.initializeTheme);
  const checkSession = useAuthStore((s) => s.checkSession);

  useEffect(() => {
    initializeTheme();
    // Validate persisted token against the live backend on every page load.
    // If the token is expired, checkSession clears the user and api.ts
    // handles the 401 redirect to /login automatically.
    checkSession();
  }, [initializeTheme, checkSession]);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <Routes>
            {/* Protected dashboard — ProtectedRoute redirects to /login when user is null */}
            <Route
              path="/dashboard/*"
              element={
                <ProtectedRoute>
                  <DashboardRoutes />
                </ProtectedRoute>
              }
            />
            {/* Login route — thin redirect to HTML login page until React login page is built */}
            <Route path="/login" element={<LoginRedirect />} />
            {/* Root redirect */}
            <Route path="/" element={<Navigate to="/dashboard/overview" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;