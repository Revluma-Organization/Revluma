import { Route, Routes, Navigate } from "react-router-dom";
import Overview from "../pages/Overview";
import NotFound from "../pages/NotFound";
import PlaceholderPage from "../pages/PlaceholderPage";

// Define the actual dashboard routes
export function DashboardRoutes() {
  return (
    <Routes>
      {/* Redirect dashboard root to overview */}
      <Route path="/" element={<Navigate to="/dashboard/overview" replace />} />
      <Route path="/dashboard" element={<Navigate to="/dashboard/overview" replace />} />
      
      {/* Dashboard pages */}
      <Route path="/dashboard/overview" element={<Overview />} />
      <Route path="/dashboard/settings" element={<PlaceholderPage title="Settings" description="Manage your account settings" />} />
      <Route path="/dashboard/billing" element={<PlaceholderPage title="Billing" description="View and manage your subscription" />} />
      
      {/* Catch-all for 404s */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default DashboardRoutes;