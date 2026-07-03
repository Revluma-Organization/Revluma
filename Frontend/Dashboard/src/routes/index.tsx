import { Route, Routes, Navigate } from "react-router-dom";
import { DashboardLayout } from "../components/layout/DashboardLayout";
import Overview from "../pages/Overview";
import Intelligence from "../pages/Intelligence";
import Integrations from "../pages/Integrations";
import CartRecovery from "../pages/CartRecovery";
import Customers from "../pages/Customers";
import NotFound from "../pages/NotFound";
import PlaceholderPage from "../pages/PlaceholderPage";

export function DashboardRoutes() {
  return (
    <Routes>
      <Route element={<DashboardLayout />}>
        <Route index element={<Navigate to="/dashboard/overview" replace />} />
        <Route path="overview"      element={<Overview />} />
        <Route path="intelligence"  element={<Intelligence />} />
        <Route path="integrations"  element={<Integrations />} />
        <Route path="cart-recovery" element={<CartRecovery />} />
        <Route path="customers"     element={<Customers />} />
        <Route path="campaigns"     element={<PlaceholderPage title="Campaigns"     description="Create and manage your marketing campaigns" />} />
        <Route path="analytics"     element={<PlaceholderPage title="Analytics"     description="Deep dive into your store performance" />} />
        <Route path="beta"          element={<PlaceholderPage title="Beta Features" description="Early access to new Revluma features" />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default DashboardRoutes;