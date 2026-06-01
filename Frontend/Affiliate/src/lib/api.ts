/**
 * Affiliate API client
 *
 * All affiliate frontend → backend communication goes through this module.
 * Configure the backend URL via the VITE_API_URL environment variable.
 *
 * Example .env:
 *   VITE_API_URL=https://revluma.onrender.com/api   # production
 *   VITE_API_URL=http://localhost:5000/api           # local dev
 */

const RAW_BASE = (import.meta as { env?: Record<string, string> }).env?.VITE_API_URL ?? '';
const API_BASE = RAW_BASE ? RAW_BASE.replace(/\/$/, '') : `${window.location.origin.replace(/\/+$/, '')}/api`;

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  affiliatePortal = false
): Promise<T> {
  const csrfToken = sessionStorage.getItem('csrf_token') ?? '';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    ...(affiliatePortal ? { 'X-Affiliate-Portal': 'true' } : {})
  };

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({})) as { error?: string };
    throw Object.assign(new Error(errorBody.error ?? `HTTP ${response.status}`), {
      status: response.status,
      body: errorBody
    });
  }

  return response.json() as Promise<T>;
}

// ============================================================
// Auth
// ============================================================

export async function login(email: string, password: string) {
  const data = await request<{
    user: { id: string; email: string; full_name: string; role: string };
    csrfToken?: string;
  }>('POST', '/session/login', { email: email.toLowerCase().trim(), password });

  if (data.csrfToken) {
    sessionStorage.setItem('csrf_token', data.csrfToken);
  }

  return data;
}

export async function affiliateRegister(payload: {
  email: string; password: string;
  firstName: string; lastName: string;
  username: string; phoneNumber: string; country: string;
  twitterHandle?: string; instagramHandle?: string;
  linkedinProfile?: string; youtubeChannel?: string;
  tiktokHandle?: string; facebookProfile?: string;
  website?: string; newsletterUrl?: string;
  communityUrl?: string; otherPlatform1?: string;
  otherPlatform2?: string;
  audienceNiche: string; audienceSize: string;
  affiliateExperience: string; whyJoin: string;
  referralSource?: string;
}) {
  return request<{
    message: string;
    pendingRegistrationId: string;
    email: string;
    expiresAt: string;
  }>('POST', '/affiliate-auth/register', payload, true);
}

export async function affiliateVerifyEmail(payload: {
  pendingRegistrationId: string;
  code: string;
}) {
  return request<{ message: string; verified: boolean }>(
    'POST', '/affiliate-auth/verify-email', payload, true
  );
}

export async function affiliateValidateToken(payload: {
  pendingRegistrationId: string;
  token: string;
}) {
  return request<{ message: string; valid: boolean; tokenId: string }>(
    'POST', '/affiliate-auth/validate-access-token', payload, true
  );
}

export async function affiliateCompleteRegistration(payload: {
  pendingRegistrationId: string;
}) {
  return request<{
    message: string;
    userId: string;
    affiliateProfileId: string;
    status: string;
  }>('POST', '/affiliate-auth/complete-registration', payload, true);
}

export async function logout() {
  return request<{ message: string }>('POST', '/session/logout', { allSessions: false });
}

export async function me() {
  return request<{
    authenticated: boolean;
    user?: { id: string; email: string; full_name: string; role: string };
  }>('GET', '/session/me');
}

// ============================================================
// Affiliate profile
// ============================================================

export async function getProfile() {
  return request<{ profile: Record<string, unknown> }>('GET', '/affiliate/profile');
}

export async function updateProfile(data: Record<string, unknown>) {
  return request<{ profile: Record<string, unknown> }>('PATCH', '/affiliate/profile', data);
}

// ============================================================
// Campaigns
// ============================================================

export async function getCampaigns() {
  return request<{ campaigns: unknown[] }>('GET', '/affiliate/campaigns');
}

export async function createCampaign(payload: { name: string; tag: string; source?: string }) {
  return request<{ campaign: unknown }>('POST', '/affiliate/campaigns', payload);
}

// ============================================================
// Referrals & Earnings
// ============================================================

export async function getReferrals(params?: { status?: string; page?: number; limit?: number }) {
  const qs = new URLSearchParams(
    Object.entries(params ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
  ).toString();
  return request<{ referrals: unknown[]; pagination: unknown }>('GET', `/affiliate/referrals${qs ? `?${qs}` : ''}`);
}

export async function getEarnings(params?: { status?: string; page?: number; limit?: number }) {
  const qs = new URLSearchParams(
    Object.entries(params ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
  ).toString();
  return request<{ earnings: unknown[]; pagination: unknown; summary: unknown }>('GET', `/affiliate/earnings${qs ? `?${qs}` : ''}`);
}

// ============================================================
// Referral Links (Dashboard)
// ============================================================
export async function getReferralLinks() {
  return request<{ links: Array<{ id: string; referralCode: string; clicksCount: number; url: string }> }>('GET', '/affiliate/dashboard/referral-links');
}

// ============================================================
// Withdrawals
// ============================================================

export async function getWithdrawals() {
  return request<{ withdrawals: unknown[] }>('GET', '/affiliate/withdrawals');
}

export async function createWithdrawal(payload: Record<string, unknown>) {
  return request<{ withdrawal: unknown }>('POST', '/affiliate/withdrawals', payload);
}

// ============================================================
// Notifications
// ============================================================

export async function getNotifications(unreadOnly = false) {
  return request<{ notifications: unknown[]; unreadCount: number }>(
    'GET',
    `/affiliate/notifications${unreadOnly ? '?unreadOnly=true' : ''}`
  );
}

export async function markNotificationRead(id: string) {
  return request<{ message: string }>('PATCH', `/affiliate/notifications/${id}/read`, {});
}

export async function markAllNotificationsRead() {
  return request<{ message: string }>('POST', '/affiliate/notifications/mark-all-read', {});
}

// ============================================================
// Admin
// ============================================================

export async function updateAffiliateStatus(profileId: string, status: string) {
  return request<{ profile: unknown }>('PATCH', `/affiliate/admin/${profileId}/status`, { status });
}

export async function updateAffiliateRole(profileId: string, role: 'user' | 'admin' | 'affiliate') {
  return request<{ message: string; profileId: string; role: string }>(
    'PATCH',
    `/affiliate/admin/${profileId}/role`,
    { role }
  );
}

// ============================================================
// Leaderboard
// ============================================================

export async function getLeaderboard() {
  return request<{ leaderboard: unknown[] }>('GET', '/affiliate/leaderboard');
}