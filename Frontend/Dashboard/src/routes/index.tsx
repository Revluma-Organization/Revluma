import { Route, Routes, Navigate } from "react-router-dom";
import Overview from "../pages/Overview";
import NotFound from "../pages/NotFound";
import PlaceholderPage from "../pages/PlaceholderPage";

// Define the actual dashboard routes
export function DashboardRoutes() {
  return (
    <Routes>
      {/* Redirect dashboard root to overview */}
      <Route path="/" element={<Navigate to="overview" replace />} />
      <Route path="/dashboard" element={<Navigate to="overview" replace />} />
      
      {/* Dashboard pages */}
      <Route path="overview" element={<Overview />} />
      <Route path="settings" element={<PlaceholderPage title="Settings" description="Manage your account settings" />} />
      <Route path="billing" element={<PlaceholderPage title="Billing" description="View and manage your subscription" />} />
      
      {/* Catch-all for 404s */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default DashboardRoutes;