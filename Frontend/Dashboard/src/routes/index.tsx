import { Route, Routes, Navigate } from "react-router-dom";
import { DashboardLayout } from "../components/layout/DashboardLayout";
import Overview from "../pages/Overview";
import Intelligence from "../pages/Intelligence";
import NotFound from "../pages/NotFound";
import PlaceholderPage from "../pages/PlaceholderPage";

export function DashboardRoutes() {
  return (
    <Routes>
      {/*
        BrowserRouter basename="/dashboard/" strips the base.
        React Router sees "" (root) or "overview", "settings" etc — no leading slashes.
        All paths here are relative to the basename.
      */}
      <Route element={<DashboardLayout />}>
        {/* Index route — matches "" (i.e. /dashboard/ or /dashboard) */}
        <Route index element={<Navigate to="overview" replace />} />
        <Route path="overview" element={<Overview />} />
        <Route path="intelligence" element={<Intelligence />} />
        <Route path="settings" element={<PlaceholderPage title="Settings" description="Manage your account settings" />} />
        <Route path="billing" element={<PlaceholderPage title="Billing" description="View and manage your subscription" />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default DashboardRoutes;