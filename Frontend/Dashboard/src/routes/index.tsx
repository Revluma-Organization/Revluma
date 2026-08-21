import { Route, Routes, Navigate } from "react-router-dom";
import { DashboardLayout } from "../components/layout/DashboardLayout";
import Overview from "../pages/Overview";
import RevIntell from "../pages/RevIntell";
import Integrations from "../pages/Integrations";
import CartRecovery from "../pages/CartRecovery";
import Customers from "../pages/Customers";
import NotFound from "../pages/NotFound";
import PlaceholderPage from "../pages/PlaceholderPage";
import Checkout from "../pages/Checkout";
import AcceptInvite from "../pages/auth/AcceptInvite";


// Settings Pages
import SettingsLayout from "../pages/settings/SettingsLayout";
import Profile from "../pages/settings/Profile";
import TeamManagement from "../pages/settings/TeamManagement";
import DangerZone from "../pages/settings/DangerZone";
import Organization from "../pages/settings/Organization";
import TeamMembers from "../pages/settings/TeamMembers";
import RolesPermissions from "../pages/settings/RolesPermissions";
import Branding from "../pages/settings/Branding";
import Preferences from "../pages/settings/Preferences";
import Notifications from "../pages/settings/Notifications";
import ActiveSessions from "../pages/settings/ActiveSessions";
import Subscription from "../pages/settings/Subscription";
import PaymentMethods from "../pages/settings/PaymentMethods";
import InvoiceHistory from "../pages/settings/InvoiceHistory";
import BillingOverview from "../pages/settings/BillingOverview";
import SettingsPlaceholder from "../pages/settings/SettingsPlaceholder";

export function DashboardRoutes() {
  return (
    <Routes>
      <Route path="checkout" element={<Checkout />} />
      <Route path="/auth/accept-invite" element={<AcceptInvite />} />
      <Route element={<DashboardLayout />}>
        <Route index element={<Navigate to="/dashboard/overview" replace />} />
        <Route path="overview"      element={<Overview />} />
        <Route path="rev-intell"     element={<RevIntell />} />
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
          <Route path="preferences" element={<Preferences />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="notification" element={<Notifications />} />
          <Route path="active-sessions" element={<ActiveSessions />} />
          
          {/* Workspace */}
          <Route path="organization" element={<Organization />} />
          <Route path="team" element={<TeamMembers />} />
          <Route path="roles" element={<RolesPermissions />} />
          <Route path="branding" element={<Branding />} />
          
          {/* Billing */}
          <Route path="billing" element={<BillingOverview />} />
          <Route path="subscription" element={<Subscription />} />
          <Route path="payment-methods" element={<PaymentMethods />} />
          <Route path="invoices" element={<InvoiceHistory />} />
          <Route path="invoice-history" element={<InvoiceHistory />} />
          
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
          <Route path="danger-zone" element={<DangerZone />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default DashboardRoutes;
