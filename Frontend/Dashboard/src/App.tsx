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
  const { user, loading, error } = useAuth();

  console.log('[DASHBOARD APP] Render state', { loading, hasUser: !!user, userId: user?.id });

  if (loading) {
    return <LoadingSpinner />;
  }

  if (!user) {
    if (error) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-gray-950">
          <div className="text-center p-8">
            <p className="text-red-400 text-lg font-semibold mb-2">Connection Error</p>
            <p className="text-gray-400 text-sm mb-6">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-white text-gray-900 rounded-lg text-sm font-medium hover:bg-gray-100 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }

    console.error('[DASHBOARD APP] No user authenticated, redirecting to login');
    window.location.href = '/auth/loginIn.html';
    return null;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <Routes>
          {/* No basename — use full absolute paths */}
          <Route path="/dashboard/*" element={<DashboardRoutes />} />
          <Route path="/" element={<Navigate to="/dashboard/overview" replace />} />
          <Route path="*" element={<Navigate to="/dashboard/overview" replace />} />
        </Routes>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;