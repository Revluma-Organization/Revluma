import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { DashboardRoutes } from "./routes";
import LoadingSpinner from "./components/LoadingSpinner";

function App() {
  const { user, loading } = useAuth();

  // While checking authentication, show loading spinner
  if (loading) {
    return <LoadingSpinner />;
  }

  // If not authenticated, redirect to login
  if (!user) {
    window.location.href = '/loginIn.html';
    return null;
  }

  // User is authenticated, render dashboard routes
  return (
    <Routes>
      {/* Protect all dashboard routes */}
      <Route path="/dashboard/*" element={<DashboardRoutes />} />
      {/* Redirect root to dashboard */}
      <Route path="/" element={<Navigate to="/dashboard/overview" replace />} />
      {/* Catch-all redirect to dashboard */}
      <Route path="*" element={<Navigate to="/dashboard/overview" replace />} />
    </Routes>
  );
}

export default App;