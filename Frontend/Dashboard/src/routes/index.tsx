import { Route, Routes, Navigate } from "react-router-dom";
import { DashboardLayout } from "../components/layout/DashboardLayout";
import Overview from "../pages/Overview";
import Intelligence from "../pages/Intelligence";
import Integrations from "../pages/Integrations";
import CartRecovery from "../pages/CartRecovery";
import Customers from "../pages/Customers";
import NotFound from "../pages/NotFound";
import PlaceholderPage from "../pages/PlaceholderPage";

// Settings Pages
import SettingsLayout from "../pages/settings/SettingsLayout";
import Profile from "../pages/settings/Profile";
import TeamManagement from "../pages/settings/TeamManagement";
import SettingsPlaceholder from "../pages/settings/SettingsPlaceholder";

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
        
        {/* Settings Routes */}
        <Route path="settings" element={<SettingsLayout />}>
          <Route index element={<Navigate to="profile" replace />} />
          <Route path="profile" element={<Profile />} />
          
          {/* Account */}
          <Route path="preferences" element={<SettingsPlaceholder title="Preferences" />} />
          <Route path="notifications" element={<SettingsPlaceholder title="Notifications" />} />
          <Route path="active-sessions" element={<SettingsPlaceholder title="Active Sessions" />} />
          
          {/* Workspace */}
          <Route path="organization" element={<SettingsPlaceholder title="Organization" />} />
          <Route path="team" element={<TeamManagement />} />
          <Route path="roles" element={<SettingsPlaceholder title="Roles & Permissions" />} />
          <Route path="branding" element={<SettingsPlaceholder title="Branding" />} />
          
          {/* Billing */}
          <Route path="billing" element={<SettingsPlaceholder title="Billing Overview" />} />
          <Route path="subscription" element={<SettingsPlaceholder title="Subscription" />} />
          <Route path="payment-methods" element={<SettingsPlaceholder title="Payment Methods" />} />
          <Route path="invoices" element={<SettingsPlaceholder title="Invoice History" />} />
          
          {/* Intelligence & Automation */}
          <Route path="ai" element={<SettingsPlaceholder title="AI Settings" />} />
          <Route path="automation" element={<SettingsPlaceholder title="Automation" />} />
          <Route path="customer-data" element={<SettingsPlaceholder title="Customer Data" />} />
          {/* analytics is already defined above, but settings/analytics is separate */}
          <Route path="analytics" element={<SettingsPlaceholder title="Analytics Settings" />} />
          
          {/* Communication */}
          <Route path="communication" element={<SettingsPlaceholder title="Communication Channels" />} />
          <Route path="email" element={<SettingsPlaceholder title="Email Settings" />} />
          <Route path="sms" element={<SettingsPlaceholder title="SMS Settings" />} />
          <Route path="whatsapp" element={<SettingsPlaceholder title="WhatsApp Settings" />} />
          
          {/* Developers */}
          <Route path="api-keys" element={<SettingsPlaceholder title="API Keys" />} />
          <Route path="webhooks" element={<SettingsPlaceholder title="Webhooks" />} />
          <Route path="feature-flags" element={<SettingsPlaceholder title="Feature Flags" />} />
          
          {/* Security & System */}
          <Route path="security" element={<SettingsPlaceholder title="Security" />} />
          <Route path="privacy" element={<SettingsPlaceholder title="Privacy" />} />
          <Route path="compliance" element={<SettingsPlaceholder title="Compliance" />} />
          <Route path="domains" element={<SettingsPlaceholder title="Domains" />} />
          <Route path="backups" element={<SettingsPlaceholder title="Backups" />} />
          <Route path="audit-log" element={<SettingsPlaceholder title="Audit Log" />} />
          <Route path="data-export" element={<SettingsPlaceholder title="Data Export" />} />
          <Route path="danger-zone" element={<SettingsPlaceholder title="Danger Zone" />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default DashboardRoutes;
