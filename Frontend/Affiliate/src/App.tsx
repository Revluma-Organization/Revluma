/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * App.tsx — root of the Affiliate Portal.
 *
 * Auth and data are served by the Express backend via HTTP-only session
 * cookies and the /api/affiliate/* endpoints.
 *
 * The child components (Dashboard, AdminPanel, LandingPage) retain their
 * existing prop interfaces so they do not need to be rewritten all at once.
 * App.tsx hydrates their props from the backend on mount.
 */

import { useState, useEffect, useCallback } from 'react';
import LandingPage from './components/LandingPage';
import AuthInterface from './components/AuthInterface';
import Dashboard from './components/Dashboard';
import AdminPanel from './components/AdminPanel';
import {
  PartnerProfile, FounderBroadcast, ApprovalStatus,
  WithdrawalRequest, WithdrawalRequestStatus
} from './types';
import * as api from './lib/api';

type AppView = 'landing' | 'auth' | 'dashboard' | 'admin';
type AuthSubView = 'login' | 'register';

// ============================================================
// Helpers
// ============================================================

function buildPartnerProfile(
  serverUser: { id: string; email: string; full_name: string; role: string },
  profile?: Record<string, unknown>
): PartnerProfile {
  return {
    id: serverUser.id,
    fullName: serverUser.full_name ?? '',
    username: (profile?.username as string) ?? serverUser.email.split('@')[0],
    email: serverUser.email,
    phoneNumber: (profile?.phoneNumber as string) ?? '',
    country: (profile?.country as string) ?? '',
    twitterHandle: (profile?.twitterHandle as string) ?? undefined,
    instagramHandle: (profile?.instagramHandle as string) ?? undefined,
    linkedInProfile: (profile?.linkedinProfile as string) ?? undefined,
    website: (profile?.website as string) ?? undefined,
    audienceNiche: (profile?.audienceNiche as string) ?? '',
    audienceSize: (profile?.audienceSize as string) ?? '',
    affiliateExperience: (profile?.affiliateExperience as string) ?? '',
    whyJoin: (profile?.whyJoin as string) ?? '',
    status: ((profile?.status as string ?? 'pending').toLowerCase()) as ApprovalStatus,
    role: (serverUser.role === 'admin' ? 'admin' : 'affiliate') as PartnerProfile['role'],
    createdAt: (profile?.createdAt as string) ?? new Date().toISOString(),
    tier: (profile?.tier as PartnerProfile['tier']) ?? 'Affiliate',
    commissionRate: (profile?.commissionRate as number) ?? 0.20,
    avatarUrl: (profile?.avatarUrl as string) ?? undefined,
    referralCode: (profile?.referralCode as string) ?? (profile?.referralLinks ? ((profile.referralLinks as Array<Record<string, unknown>>)[0]?.referralCode as string) : undefined),
    termsAccepted: (profile?.termsAccepted as boolean) ?? false,
    marketingConsent: (profile?.marketingConsent as boolean) ?? false,
    emailVerified: true
  };
}

type RouteState = {
  view: AppView;
  authSubView?: AuthSubView;
};

function routePath(view: AppView, authSubView: AuthSubView = 'login') {
  switch (view) {
    case 'landing': return '/affiliate';
    case 'auth': return authSubView === 'register' ? '/affiliate/signup' : '/affiliate/login';
    case 'dashboard': return '/affiliate/dashboard';
    case 'admin': return '/affiliate/admin';
    default: return '/affiliate';
  }
}

function resolveAffiliateRoute(pathname: string, user: PartnerProfile | null): RouteState {
  const normalized = pathname.replace(/\/+$|^\/affiliate/, '') || '/';
  switch (normalized.toLowerCase()) {
    case '/':
      return user ? { view: user.role === 'admin' ? 'admin' : 'dashboard' } : { view: 'landing' };
    case '/login':
    case '/signin':
      return user ? { view: user.role === 'admin' ? 'admin' : 'dashboard' } : { view: 'auth', authSubView: 'login' };
    case '/signup':
    case '/register':
      return user ? { view: user.role === 'admin' ? 'admin' : 'dashboard' } : { view: 'auth', authSubView: 'register' };
    case '/dashboard':
    case '/settings':
      return user ? { view: user.role === 'admin' ? 'admin' : 'dashboard' } : { view: 'auth', authSubView: 'login' };
    case '/admin':
      return user?.role === 'admin' ? { view: 'admin' } : { view: 'auth', authSubView: 'login' };
    default:
      return user ? { view: user.role === 'admin' ? 'admin' : 'dashboard' } : { view: 'landing' };
  }
}

function syncRoute(view: AppView, authSubView: AuthSubView) {
  if (typeof window === 'undefined') return;
  const desiredPath = routePath(view, authSubView);
  if (window.location.pathname !== desiredPath) {
    window.history.replaceState({}, '', desiredPath);
  }
}

const BASE_URL = (import.meta as { env?: Record<string, string> }).env?.VITE_API_URL
  ? (import.meta as { env?: Record<string, string> }).env!.VITE_API_URL.replace(/\/$/, '')
  : `${typeof window !== 'undefined' ? window.location.origin : ''}/api`;

async function backendFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const csrfToken = sessionStorage.getItem('csrf_token') ?? '';
  const res = await fetch(`${BASE_URL}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {})
    },
    ...init
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ============================================================
// App
// ============================================================

export default function App() {
  const [view, setView] = useState<AppView>('landing');
  const [authSubView, setAuthSubView] = useState<AuthSubView>('login');
  const [currentUser, setCurrentUser] = useState<PartnerProfile | null>(null);
  const [allProfiles, setAllProfiles] = useState<PartnerProfile[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [broadcasts, setBroadcasts] = useState<FounderBroadcast[]>([]);
  const [isInitializing, setIsInitializing] = useState(true);

  // ============================================================
  // Session restore and route initialization on mount
  // ============================================================

  useEffect(() => {
    const initialState = resolveAffiliateRoute(window.location.pathname, null);
    setView(initialState.view);
    if (initialState.authSubView) {
      setAuthSubView(initialState.authSubView);
    }

    api.me()
      .then(async (data) => {
        if (data.authenticated && data.user) {
          try {
            const profileRes = await api.getProfile();
            const profile = profileRes.profile as Record<string, unknown>;
            const restoredUser = buildPartnerProfile(data.user, profile);
            setCurrentUser(restoredUser);
            setView(resolveAffiliateRoute(window.location.pathname, restoredUser).view);
            setAuthSubView(resolveAffiliateRoute(window.location.pathname, restoredUser).authSubView ?? authSubView);
            await loadUserData(restoredUser);
          } catch {
            // Profile fetch failed — fall back to route state
          }
        }
      })
      .catch(() => { /* no active session */ })
      .finally(() => setIsInitializing(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    syncRoute(view, authSubView);
  }, [view, authSubView]);

  // ============================================================
  // Data loading
  // ============================================================

  async function loadUserData(user: PartnerProfile) {
    const results = await Promise.allSettled([
      api.getWithdrawals(),
      fetch(`${BASE_URL}/affiliate/admin/list`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      })
        .then(r => r.ok ? r.json() : Promise.reject())
        .catch(() => null)
    ]);

    if (results[0].status === 'fulfilled') {
      const wResult = results[0].value as { withdrawals: WithdrawalRequest[] };
      setWithdrawals(wResult.withdrawals ?? []);
    }

    if (user.role === 'admin' && results[1].status === 'fulfilled' && results[1].value) {
      const aResult = results[1].value as { affiliates: Record<string, unknown>[] };
      if (aResult.affiliates) {
        setAllProfiles(
          aResult.affiliates.map(a => buildPartnerProfile(
            {
              id: (a.user as Record<string, unknown>)?.id as string ?? a.id as string,
              email: (a.user as Record<string, unknown>)?.email as string ?? '',
              full_name: (a.user as Record<string, unknown>)?.fullName as string ?? '',
              role: 'affiliate'
            },
            a
          ))
        );
      }
    }
  }

  // ============================================================
  // Auth callbacks
  // ============================================================

  const handleAuthSuccess = useCallback(async (profile: PartnerProfile) => {
    setCurrentUser(profile);
    await loadUserData(profile).catch(() => { });
    setView(profile.role === 'admin' ? 'admin' : 'dashboard');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogout = useCallback(async () => {
    try { await api.logout(); } catch { /* best-effort */ }
    try { sessionStorage.clear(); } catch { /* ignore */ }
    setCurrentUser(null);
    setAllProfiles([]);
    setWithdrawals([]);
    setBroadcasts([]);
    setView('landing');
  }, []);

  // ============================================================
  // Profile callbacks (Dashboard → modify profile)
  // ============================================================

  const handleModifyProfile = useCallback(async (updated: PartnerProfile) => {
    await backendFetch('/affiliate/profile', {
      method: 'PATCH',
      body: JSON.stringify({
        websiteUrl: updated.website,
        twitterHandle: updated.twitterHandle,
        instagramHandle: updated.instagramHandle,
        linkedinProfile: updated.linkedInProfile,
        audienceNiche: updated.audienceNiche,
        audienceSize: updated.audienceSize
      })
    });
    setCurrentUser(updated);
  }, []);

  const handleDeleteAccount = useCallback(() => {
    // Best effort — log out client side, backend cleanup is a separate admin action
    handleLogout();
  }, [handleLogout]);

  // ============================================================
  // Withdrawal callbacks
  // ============================================================

  const handleAddWithdrawal = useCallback(async (
    req: Omit<WithdrawalRequest, 'id' | 'createdAt' | 'updatedAt' | 'partnerId'>
  ) => {
    const result = await backendFetch<{ withdrawal: WithdrawalRequest }>('/affiliate/withdrawals', {
      method: 'POST',
      body: JSON.stringify(req)
    });
    setWithdrawals(prev => [result.withdrawal, ...prev]);
  }, []);

  const handleUpdateWithdrawalStatus = useCallback(async (
    requestId: string,
    newStatus: WithdrawalRequestStatus,
    adminNotes?: string
  ) => {
    await backendFetch(`/affiliate/admin/withdrawals/${requestId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus, adminNotes })
    });
    setWithdrawals(prev =>
      prev.map(w => w.id === requestId ? { ...w, status: newStatus, adminNotes } : w)
    );
  }, []);

  // ============================================================
  // Admin profile status / role callbacks
  // ============================================================

  const handleModifyProfileStatus = useCallback(async (userId: string, newStatus: ApprovalStatus) => {
    await backendFetch(`/affiliate/admin/${userId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus.toUpperCase() })
    });
    setAllProfiles(prev =>
      prev.map(p => p.id === userId ? { ...p, status: newStatus } : p)
    );
  }, []);

  const handleModifyProfileRole = useCallback(async (userId: string, newRole: 'user' | 'admin') => {
    const backendRole = newRole === 'admin' ? 'admin' : 'affiliate';
    await api.updateAffiliateRole(userId, backendRole);
    setAllProfiles(prev =>
      prev.map(p => p.id === userId ? { ...p, role: backendRole } : p)
    );
  }, []);

  // ============================================================
  // Broadcast callbacks (admin only)
  // ============================================================

  const handleAddBroadcast = useCallback(async (title: string, content: string) => {
    const newBroadcast: FounderBroadcast = {
      id: `broadcast_${Date.now()}`,
      title,
      content,
      date: new Date().toISOString(),
      author: currentUser?.fullName ?? 'Admin'
    };
    // TODO: POST /affiliate/admin/broadcasts to persist
    setBroadcasts(prev => [newBroadcast, ...prev]);
  }, [currentUser]);

  // ============================================================
  // Render
  // ============================================================

  if (isInitializing) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-6 h-6 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (view === 'landing') {
    return (
      <LandingPage
        onNavigateToAuth={(subView) => { setAuthSubView(subView); setView('auth'); }}
        currentProfile={currentUser}
        onNavigateToDashboard={() => setView(currentUser?.role === 'admin' ? 'admin' : 'dashboard')}
      />
    );
  }

  if (view === 'auth') {
    return (
      <AuthInterface
        onAuthSuccess={handleAuthSuccess}
        onBackToLanding={() => setView('landing')}
      />
    );
  }

  if (view === 'admin' && currentUser?.role === 'admin') {
    return (
      <AdminPanel
        allProfiles={allProfiles}
        onModifyProfileStatus={handleModifyProfileStatus}
        onModifyProfileRole={handleModifyProfileRole}
        broadcastsList={broadcasts}
        onAddBroadcast={handleAddBroadcast}
        onBackToDashboard={() => setView('dashboard')}
        withdrawalRequests={withdrawals}
        onUpdateWithdrawalRequestStatus={handleUpdateWithdrawalStatus}
      />
    );
  }

  if (currentUser) {
    return (
      <Dashboard
        currentProfile={currentUser}
        allProfiles={allProfiles}
        onLogout={handleLogout}
        onModifyProfile={handleModifyProfile}
        onDeleteAccount={handleDeleteAccount}
        broadcastsList={broadcasts}
        onAddBroadcast={handleAddBroadcast}
        withdrawalRequests={withdrawals}
        onAddWithdrawalRequest={handleAddWithdrawal}
        sentEmails={[]}
      />
    );
  }

  return (
    <LandingPage
      onNavigateToAuth={(subView) => { setAuthSubView(subView); setView('auth'); }}
      currentProfile={null}
      onNavigateToDashboard={() => setView('landing')}
    />
  );
}