import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { DashboardRoutes } from "./routes";
import LoadingSpinner from "./components/LoadingSpinner";


import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "./components/ui/tooltip";
import { Toaster as Sonner } from "./components/ui/sonner";

import { Toaster } from "./components/ui/toaster";

const queryClient = new QueryClient();


function App() {
  const { user, loading } = useAuth();


  console.log('[DASHBOARD APP] Render state', { loading, hasUser: !!user, userId: user?.id });

  // While checking authentication, show loading spinner
  if (loading) {
    console.log('[DASHBOARD APP] Still loading auth state, showing spinner');
    return <LoadingSpinner />;
  }

  // If not authenticated, redirect to login
  if (!user) {
  console.error('[DASHBOARD APP] No user authenticated, redirecting to login');
  window.location.href = '/auth/loginIn.html';
  return null;
}

  console.log('[DASHBOARD APP] User authenticated, rendering dashboard routes');
  // User is authenticated, render dashboard routes
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />

        <Routes>
          {/* Protect all dashboard routes */}
          <Route path="/dashboard/*" element={<DashboardRoutes />} />
          {/* Redirect root to dashboard */}
          <Route path="/" element={<Navigate to="/dashboard/overview" replace />} />
          {/* Catch-all redirect to dashboard */}
          <Route path="*" element={<Navigate to="/dashboard/overview" replace />} />
        </Routes>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

