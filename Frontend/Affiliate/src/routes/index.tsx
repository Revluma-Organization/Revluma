import { lazy } from 'react';
import { Navigate, type RouteObject } from 'react-router-dom';

const AuthLayout = lazy(() => import('../layouts/AuthLayout'));
const DashboardLayout = lazy(() => import('../layouts/DashboardLayout'));

// Auth pages
const LandingPage = lazy(() => import('../pages/LandingPage'));
const LoginPage = lazy(() => import('../pages/auth/LoginPage'));
const SignupPage = lazy(() => import('../pages/auth/SignupPage'));
const VerifyEmailPage = lazy(() => import('../pages/auth/VerifyEmailPage'));
const ForgotPasswordPage = lazy(() => import('../pages/auth/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('../pages/auth/ResetPasswordPage'));
const PendingReviewPage = lazy(() => import('../pages/auth/PendingReviewPage'));
const RejectedPage = lazy(() => import('../pages/auth/RejectedPage'));

// Dashboard pages
const DashboardHome = lazy(() => import('../pages/dashboard/DashboardHome'));
const ReferralsPage = lazy(() => import('../pages/referrals/ReferralsPage'));
const EarningsPage = lazy(() => import('../pages/earnings/EarningsPage'));
const CampaignsPage = lazy(() => import('../pages/campaigns/CampaignsPage'));
const CopilotPage = lazy(() => import('../pages/dashboard/CopilotPage'));
const LeaderboardPage = lazy(() => import('../pages/dashboard/LeaderboardPage'));
const AcademyPage = lazy(() => import('../pages/dashboard/AcademyPage'));
const ResourcesPage = lazy(() => import('../pages/dashboard/ResourcesPage'));
const NotificationsPage = lazy(() => import('../pages/dashboard/NotificationsPage'));
const SearchPage = lazy(() => import('../pages/dashboard/SearchPage'));
const HelpPage = lazy(() => import('../pages/dashboard/HelpPage'));

// Settings pages
const ProfileSettings = lazy(() => import('../pages/settings/ProfileSettings'));
const AccountSettings = lazy(() => import('../pages/settings/AccountSettings'));
const SecuritySettings = lazy(() => import('../pages/settings/SecuritySettings'));
const PreferencesSettings = lazy(() => import('../pages/settings/PreferencesSettings'));
const NotificationSettings = lazy(() => import('../pages/settings/NotificationSettings'));
const AppearanceSettings = lazy(() => import('../pages/settings/AppearanceSettings'));
const BillingSettings = lazy(() => import('../pages/settings/BillingSettings'));

// Admin
const AdminPage = lazy(() => import('../pages/admin/AdminPage'));

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AuthLayout />,
    children: [
      { index: true, element: <LandingPage /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'signup', element: <SignupPage /> },
      { path: 'verify-email', element: <VerifyEmailPage /> },
      { path: 'forgot-password', element: <ForgotPasswordPage /> },
      { path: 'reset-password', element: <ResetPasswordPage /> },
      { path: 'pending-review', element: <PendingReviewPage /> },
      { path: 'rejected', element: <RejectedPage /> },
    ],
  },
  {
    path: '/dashboard',
    element: <DashboardLayout />,
    children: [
      { index: true, element: <Navigate to="home" replace /> },
      { path: 'home', element: <DashboardHome /> },
      { path: 'referrals', element: <ReferralsPage /> },
      { path: 'referrals/all', element: <ReferralsPage /> },
      { path: 'referrals/active', element: <ReferralsPage /> },
      { path: 'referrals/pending', element: <ReferralsPage /> },
      { path: 'earnings', element: <EarningsPage /> },
      { path: 'earnings/history', element: <EarningsPage /> },
      { path: 'earnings/payouts', element: <EarningsPage /> },
      { path: 'campaigns', element: <CampaignsPage /> },
      { path: 'campaigns/utm-builder', element: <CampaignsPage /> },
      { path: 'campaigns/tracking', element: <CampaignsPage /> },
      { path: 'copilot', element: <CopilotPage /> },
      { path: 'leaderboard', element: <LeaderboardPage /> },
      { path: 'academy', element: <AcademyPage /> },
      { path: 'resources', element: <ResourcesPage /> },
      { path: 'notifications', element: <NotificationsPage /> },
      { path: 'search', element: <SearchPage /> },
      { path: 'help', element: <HelpPage /> },
    ],
  },
  {
    path: '/settings',
    element: <DashboardLayout />,
    children: [
      { index: true, element: <Navigate to="profile" replace /> },
      { path: 'profile', element: <ProfileSettings /> },
      { path: 'account', element: <AccountSettings /> },
      { path: 'security', element: <SecuritySettings /> },
      { path: 'preferences', element: <PreferencesSettings /> },
      { path: 'notifications', element: <NotificationSettings /> },
      { path: 'appearance', element: <AppearanceSettings /> },
      { path: 'billing', element: <BillingSettings /> },
    ],
  },
  {
    path: '/admin',
    element: <DashboardLayout />,
    children: [
      { index: true, element: <AdminPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
];
