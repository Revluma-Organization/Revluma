export type AffiliateRoute =
  | '/affiliate'
  | '/affiliate/login'
  | '/affiliate/signup'
  | '/affiliate/verify-email'
  | '/affiliate/forgot-password'
  | '/affiliate/pending-review'
  | '/affiliate/rejected'
  | '/affiliate/dashboard'
  | '/affiliate/dashboard/home'
  | '/affiliate/dashboard/referrals'
  | '/affiliate/dashboard/referrals/all'
  | '/affiliate/dashboard/referrals/active'
  | '/affiliate/dashboard/referrals/pending'
  | '/affiliate/dashboard/earnings'
  | '/affiliate/dashboard/earnings/history'
  | '/affiliate/dashboard/earnings/payouts'
  | '/affiliate/dashboard/campaigns'
  | '/affiliate/dashboard/campaigns/utm-builder'
  | '/affiliate/dashboard/campaigns/tracking'
  | '/affiliate/dashboard/copilot'
  | '/affiliate/dashboard/resources'
  | '/affiliate/dashboard/academy'
  | '/affiliate/dashboard/leaderboard'
  | '/affiliate/dashboard/notifications'
  | '/affiliate/dashboard/search'
  | '/affiliate/dashboard/help'
  | '/affiliate/settings'
  | '/affiliate/settings/profile'
  | '/affiliate/settings/account'
  | '/affiliate/settings/security'
  | '/affiliate/settings/preferences'
  | '/affiliate/settings/notifications'
  | '/affiliate/settings/appearance'
  | '/affiliate/settings/billing'
  | '/affiliate/admin';

export const ROUTE_LABELS: Record<string, string> = {
  '/affiliate/dashboard/home': 'Dashboard Home',
  '/affiliate/dashboard/referrals': 'Referrals',
  '/affiliate/dashboard/referrals/all': 'All Referrals',
  '/affiliate/dashboard/referrals/active': 'Active Referrals',
  '/affiliate/dashboard/referrals/pending': 'Pending Referrals',
  '/affiliate/dashboard/earnings': 'Earnings',
  '/affiliate/dashboard/earnings/history': 'Earnings History',
  '/affiliate/dashboard/earnings/payouts': 'Payouts',
  '/affiliate/dashboard/campaigns': 'Campaigns',
  '/affiliate/dashboard/campaigns/utm-builder': 'UTM Builder',
  '/affiliate/dashboard/campaigns/tracking': 'Tracking',
  '/affiliate/dashboard/copilot': 'AI Copilot',
  '/affiliate/dashboard/resources': 'Resources',
  '/affiliate/dashboard/academy': 'Academy',
  '/affiliate/dashboard/leaderboard': 'Leaderboard',
  '/affiliate/dashboard/notifications': 'Notifications',
  '/affiliate/dashboard/search': 'Search',
  '/affiliate/dashboard/help': 'Help',
  '/affiliate/settings': 'Settings',
  '/affiliate/settings/profile': 'Profile Settings',
  '/affiliate/settings/account': 'Account Settings',
  '/affiliate/settings/security': 'Security',
  '/affiliate/settings/preferences': 'Preferences',
  '/affiliate/settings/notifications': 'Notification Settings',
  '/affiliate/settings/appearance': 'Appearance',
  '/affiliate/settings/billing': 'Billing',
  '/affiliate/admin': 'Admin',
};

export function getRouteLabel(path: string): string {
  return ROUTE_LABELS[path] ?? path.split('/').pop()?.replace(/-/g, ' ') ?? path;
}

export function buildBreadcrumbs(pathname: string): Array<{ label: string; path: string }> {
  const parts = pathname.split('/').filter(Boolean);
  const crumbs: Array<{ label: string; path: string }> = [];
  let current = '';
  for (const part of parts) {
    current += '/' + part;
    const label = ROUTE_LABELS[current] ?? part.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    crumbs.push({ label, path: current });
  }
  return crumbs;
}
