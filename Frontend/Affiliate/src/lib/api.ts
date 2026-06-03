/**
 * Affiliate API client
 *
 * Uses relative path so all API calls go to the same origin — no external
 * host dependency. On Render (frontend + backend same origin) and Vercel
 * (separate frontend, relative proxy) this eliminates 502s and env-var
 * configuration issues.
 */

const API_BASE = '/api';

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  affiliatePortal = false,
  timeout = 10000
): Promise<T> {
  const csrfToken = sessionStorage.getItem('csrf_token') ?? '';
  const start = Date.now();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    ...(affiliatePortal ? { 'X-Affiliate-Portal': 'true' } : {})
  };

  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeout);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'include',
      headers,
      signal: controller.signal,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({})) as { error?: string };
      console.error(`[API] ${method} ${path} -> ${response.status} (${Date.now() - start}ms)`, errorBody);
      throw Object.assign(new Error(errorBody.error ?? `HTTP ${response.status}`), {
        status: response.status,
        body: errorBody
      });
    }

    const data = await response.json() as T;
    console.log(`[API] ${method} ${path} -> ${response.status} (${Date.now() - start}ms)`);
    return data;
  } catch (err) {
    if (timedOut) {
      console.error(`[API] ${method} ${path} -> TIMEOUT after ${timeout}ms`);
      throw Object.assign(new Error('Request timed out'), { timedOut: true });
    }
    console.error(`[API] ${method} ${path} -> ERROR (${Date.now() - start}ms)`, err instanceof Error ? err.message : err);
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
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

export async function checkUsername(username: string) {
  const qs = `username=${encodeURIComponent(username)}`;
  return request<{ available: boolean; username: string }>(
    'GET',
    `/affiliate-auth/check-username?${qs}`,
    undefined,
    true,
    15000
  );
}

export async function checkEmail(email: string) {
  const qs = `email=${encodeURIComponent(email)}`;
  return request<{ available: boolean; email: string }>(
    'GET',
    `/affiliate-auth/check-email?${qs}`,
    undefined,
    true,
    15000
  );
}

export async function affiliateResendVerification(payload: {
  pendingRegistrationId: string;
  email?: string;
}) {
  return request<{ message: string; expiresAt: string }>(
    'POST',
    '/affiliate-auth/resend-verification',
    payload,
    true
  );
}

export async function affiliateApplicationStatus(params: {
  pendingRegistrationId?: string;
  userId?: string;
}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
  ).toString();
  return request<{
    phase: string;
    authState: string;
    emailVerified?: boolean;
    step?: number;
    expiresAt?: string;
  }>('GET', `/affiliate-auth/application-status${qs ? `?${qs}` : ''}`, undefined, true);
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
  // Registration includes bcrypt hashing plus a cold-start margin,
  // so it needs a longer timeout than regular API calls.
  return request<{
    message: string;
    pendingRegistrationId: string;
    email: string;
    expiresAt: string;
    authState?: string;
  }>('POST', '/affiliate-auth/register', payload, true, 60000);
}

export async function affiliateVerifyEmail(payload: {
  pendingRegistrationId: string;
  code: string;
}) {
  return request<{ message: string; verified: boolean; authState?: string }>(
    'POST', '/affiliate-auth/verify-email', payload, true
  );
}

export async function affiliateCompleteRegistration(payload: {
  pendingRegistrationId: string;
}) {
  return request<{
    message: string;
    user: { id: string; email: string; full_name: string; role: string };
    userId: string;
    affiliateProfileId: string;
    status: string;
    csrfToken?: string;
    sessionEstablished: boolean;
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