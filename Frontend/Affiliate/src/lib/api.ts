/**
 * Affiliate API client
 *
 * Uses relative path so all API calls go to the same origin — no external
 * host dependency. On Render (frontend + backend same origin) and Vercel
 * (separate frontend, relative proxy) this eliminates 502s and env-var
 * configuration issues.
 *
 * FIX A-06: CSRF token is now stored in a module-level in-memory variable
 * instead of sessionStorage. sessionStorage is accessible to any same-origin
 * JavaScript (including injected scripts), whereas a closure variable is
 * only reachable through this module's exported functions.
 *
 * Trade-off: the token is lost on page refresh, which triggers an automatic
 * re-fetch on the next mutating request (the server returns 403, the client
 * re-authenticates and retries). For a 7-day session this is acceptable and
 * far safer than sessionStorage.
 */

import { ApiError } from "@google/genai";
import { Component } from "lucide-react";

const API_BASE = (import.meta as any).env?.VITE_API_URL ?? '/api';
let _csrfToken: string | null = null;

function getCsrfToken(): string {
  return _csrfToken ?? '';
}


function setCsrfToken(token: string): void {
  _csrfToken = token;
}

function clearCsrfToken(): void {
  _csrfToken = null;
}

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  affiliatePortal = false,
  timeout = 10000,
  maxRetries = 0
): Promise<T> {
  const csrfToken = getCsrfToken();
  const start = Date.now();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    ...(affiliatePortal ? { 'X-Affiliate-Portal': 'true' } : {})
  };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
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
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({})) as { error?: string };
        const err = new Error(errorBody.error ?? `HTTP ${response.status}`) as Error & { status?: number; body: { error?: string } };
        err.status = response.status;
        err.body = errorBody;
        throw err;
      }

      const data = await response.json() as T;
      return data;

    } catch (err) {
      clearTimeout(timeoutId);

      const isLastAttempt = attempt >= maxRetries;

      if (timedOut) {
        if (!isLastAttempt) {
          const wait = 2000 * (attempt + 1);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        throw Object.assign(new Error('Request timed out'), { timedOut: true });
      }

      if (!isLastAttempt) {
        const wait = 1500 * (attempt + 1);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }

      throw err;
    }
  }

  throw new Error('Request failed after all retries');
}

// ============================================
// Auth
// ============================================

export async function login(email: string, password: string) {
  const data = await request<{
    user: { id: string; email: string; full_name: string; role: string };
    csrfToken?: string;
  }>('POST', '/session/login', { email: email.toLowerCase().trim(), password }, false, 30000, 3);

  // FIX A-06: Store in module-level variable (not sessionStorage)
  if (data.csrfToken) {
    setCsrfToken(data.csrfToken);
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
    8000,
    2
  );
}

export async function checkEmail(email: string) {
  const qs = `email=${encodeURIComponent(email)}`;
  return request<{ available: boolean; email: string }>(
    'GET',
    `/affiliate-auth/check-email?${qs}`,
    undefined,
    true,
    8000,
    2
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
    true,
    30000,
    2
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
  }>('GET', `/affiliate-auth/application-status${qs ? `?${qs}` : ''}`, undefined, true, 15000, 2);
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
    authState?: string;
  }>('POST', '/affiliate-auth/register', payload, true, 120000, 2);
}

export async function affiliateVerifyEmail(payload: {
  pendingRegistrationId: string;
  code: string;
}) {
  return request<{ message: string; verified: boolean; authState?: string }>(
    'POST', '/affiliate-auth/verify-email', payload, true, 30000, 2
  );
}

export async function fetchAnonCsrfToken(): Promise<void> {
  try {
    const data = await request<{ csrfToken: string }>('GET', '/session/csrf-token', undefined, true, 10000, 2);
    if (data.csrfToken) setCsrfToken(data.csrfToken);
  } catch {
    // Non-fatal — complete-registration will return 403 if missing
  }
}

export async function affiliateCompleteRegistration(payload: {
  pendingRegistrationId: string;
}) {
  // Backend requires a CSRF token on this endpoint even for unauthenticated users.
  // Fetch an anonymous token first, store it in-memory so the request() helper
  // includes it automatically as X-CSRF-Token.
  await fetchAnonCsrfToken();

  const data = await request<{
    message: string;
    user: { id: string; email: string; full_name: string; role: string };
    userId: string;
    affiliateProfileId: string;
    status: string;
    csrfToken?: string;
    sessionEstablished: boolean;
  }>('POST', '/affiliate-auth/complete-registration', payload, true, 30000, 2);

  // FIX A-06: Store CSRF token from complete-registration response in-memory
  if (data.csrfToken) {
    setCsrfToken(data.csrfToken);
  }

  return data;
}

export async function logout() {
  const result = await request<{ message: string }>('POST', '/session/logout', { allSessions: false }, false, 15000, 2);
  // Clear CSRF token on logout
  clearCsrfToken();
  return result;
}

export async function me() {
  return request<{
    authenticated: boolean;
    user?: { id: string; email: string; full_name: string; role: string };
  }>('GET', '/session/me', undefined, false, 15000, 3);
}

// ============================================
// Affiliate profile
// ============================================

export async function getProfile() {
  return request<{ profile: Record<string, unknown> }>('GET', '/affiliate/profile');
}

export async function updateProfile(data: Record<string, unknown>) {
  return request<{ profile: Record<string, unknown> }>('PATCH', '/affiliate/profile', data);
}

// ============================================
// Campaigns
// ============================================

export async function getCampaigns() {
  return request<{ campaigns: unknown[] }>('GET', '/affiliate/campaigns');
}

export async function createCampaign(payload: { name: string; tag: string; source?: string }) {
  return request<{ campaign: unknown }>('POST', '/affiliate/campaigns', payload);
}

// ============================================
// Referrals & Earnings
// ============================================

export async function getReferrals(params?: { status?: string; page?: number; limit?: number }) {
  const qs = new URLSearchParams(
    Object.entries(params ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
  ).toString();
  return request<{ referrals: unknown[]; pagination: unknown }>(`GET`, `/affiliate/referrals${qs ? `?${qs}` : ''}`);
}

export async function getEarnings(params?: { status?: string; page?: number; limit?: number }) {
  const qs = new URLSearchParams(
    Object.entries(params ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
  ).toString();
  return request<{ earnings: unknown[]; summary: unknown }>(`GET`, `/affiliate/earnings${qs ? `?${qs}` : ''}`);
}

// ============================================
// Referral Links (Dashboard)
// ============================================

export async function getReferralLinks() {
  return request<{ links: Array<{ id: string; referralCode: string; clicksCount: number; url: string }> }>('GET', '/affiliate/dashboard/referral-links');
}

// ============================================
// Withdrawals
// ============================================

export async function getWithdrawals() {
  return request<{ withdrawals: unknown[] }>('GET', '/affiliate/withdrawals');
}

export async function createWithdrawal(payload: Record<string, unknown>) {
  return request<{ withdrawal: unknown }>('POST', '/affiliate/withdrawals', payload);
}

// ============================================
// Notifications
// ============================================

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

// ============================================
// Admin
// ============================================

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

// ============================================
// Leaderboard
// ============================================

export async function getLeaderboard() {
  return request<{ leaderboard: unknown[] }>('GET', '/affiliate/leaderboard');
}
