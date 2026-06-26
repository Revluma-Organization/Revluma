// /dashboard/integrations now renders <Integrations /> (was PlaceholderPage)
// All other routes unchanged.

import { Route, Routes, Navigate } from "react-router-dom";
import { DashboardLayout } from "../components/layout/DashboardLayout";
import Overview from "../pages/Overview";
import Intelligence from "../pages/Intelligence";
import Integrations from "../pages/Integrations";
import NotFound from "../pages/NotFound";
import PlaceholderPage from "../pages/PlaceholderPage";

export function DashboardRoutes() {
  return (
    <Routes>
      <Route element={<DashboardLayout />}>
        {/* Index: /dashboard/ → /dashboard/overview */}
        <Route index element={<Navigate to="/dashboard/overview" replace />} />
        <Route path="overview"      element={<Overview />} />
        <Route path="intelligence"  element={<Intelligence />} />
        <Route path="integrations"  element={<Integrations />} />
        <Route path="cart-recovery" element={<PlaceholderPage title="Cart Recovery"  description="Recover abandoned carts and win back lost revenue" />} />
        <Route path="campaigns"     element={<PlaceholderPage title="Campaigns"      description="Create and manage your marketing campaigns" />} />
        <Route path="customers"     element={<PlaceholderPage title="Customers"      description="View and manage your customer base" />} />
        <Route path="analytics"     element={<PlaceholderPage title="Analytics"      description="Deep dive into your store performance" />} />
        <Route path="beta"          element={<PlaceholderPage title="Beta Features"  description="Early access to new Revluma features" />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default DashboardRoutes;
