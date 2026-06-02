/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * App.tsx — root of the Affiliate Portal.
 *
 * PHASE 9: Production-grade authentication routing & URL state management.
 * Every auth screen has its own dedicated URL. Browser history, back/forward,
 * deep links, refresh persistence, and route protection all work correctly.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import LandingPage from './components/LandingPage';
import AuthInterface from './components/AuthInterface';
import Dashboard from './components/Dashboard';
import AdminPanel from './components/AdminPanel';
import {
  PartnerProfile, FounderBroadcast, ApprovalStatus,
  WithdrawalRequest, WithdrawalRequestStatus
} from './types';
import * as api from './lib/api';

// ============================================================
// Route Model
// ============================================================

/**
 * Every distinct screen maps to a canonical URL path.
 * This is the single source of truth for routing.
 */
export type AppRoute =
  | '/affiliate'
  | '/affiliate/login'
  | '/affiliate/signup'
  | '/affiliate/verify-email'
  | '/affiliate/access-token'
  | '/affiliate/pending-review'
  | '/affiliate/rejected'
  | '/affiliate/dashboard'
  | '/affiliate/settings'
  | '/affiliate/admin';

type AppView = 'landing' | 'auth' | 'dashboard' | 'admin';

// AuthMode is now a direct derivation of the URL — it is NOT independent state
export type AuthMode =
  | 'login'
  | 'register'
  | 'forgot'
  | 'resetConfirm'
  | 'verifyEmail'
  | 'accessToken'
  | 'pendingApproval'
  | 'rejected';

// ============================================================
// Route ↔ AuthMode mapping
// ============================================================

function routeToAuthMode(route: AppRoute): AuthMode {
  switch (route) {
    case '/affiliate/signup':      return 'register';
    case '/affiliate/verify-email': return 'verifyEmail';
    case '/affiliate/access-token': return 'accessToken';
    case '/affiliate/pending-review': return 'pendingApproval';
    case '/affiliate/rejected':    return 'rejected';
    case '/affiliate/login':
    default:                       return 'login';
  }
}

function authModeToRoute(mode: AuthMode): AppRoute {
  switch (mode) {
    case 'register':       return '/affiliate/signup';
    case 'verifyEmail':    return '/affiliate/verify-email';
    case 'accessToken':    return '/affiliate/access-token';
    case 'pendingApproval': return '/affiliate/pending-review';
    case 'rejected':       return '/affiliate/rejected';
    case 'login':
    case 'forgot':
    case 'resetConfirm':
    default:               return '/affiliate/login';
  }
}

function pathToRoute(pathname: string): AppRoute {
  const p = pathname.replace(/\/+$/, '').toLowerCase();
  const validRoutes: AppRoute[] = [
    '/affiliate/login', '/affiliate/signup', '/affiliate/verify-email',
    '/affiliate/access-token', '/affiliate/pending-review', '/affiliate/rejected',
    '/affiliate/dashboard', '/affiliate/settings', '/affiliate/admin', '/affiliate'
  ];
  return (validRoutes.find(r => p === r || p.startsWith(r + '/')) as AppRoute) ?? '/affiliate';
}

// ============================================================
// Route protection: given auth status, what route is allowed?
// ============================================================

function getProtectedRoute(user: PartnerProfile | null, requestedRoute: AppRoute): AppRoute {
  if (!user) {
    // Unauthenticated: only public routes allowed
    if (['/affiliate', '/affiliate/login', '/affiliate/signup'].includes(requestedRoute)) {
      return requestedRoute;
    }
    return '/affiliate/login';
  }

  const status = (user.status ?? 'pending').toLowerCase();

  switch (status) {
    case 'pending_email_verification':
      return '/affiliate/verify-email';

    case 'pending_access_token':
      return '/affiliate/access-token';

    case 'pending':
    case 'pending_review':
      return '/affiliate/pending-review';

    case 'rejected':
      return '/affiliate/rejected';

    case 'approved':
      if (requestedRoute === '/affiliate/admin') {
        return user.role === 'admin' ? '/affiliate/admin' : '/affiliate/dashboard';
      }
      if (['/affiliate/dashboard', '/affiliate/settings'].includes(requestedRoute)) {
        return requestedRoute;
      }
      return user.role === 'admin' ? '/affiliate/admin' : '/affiliate/dashboard';

    default:
      return '/affiliate/pending-review';
  }
}

// ============================================================
// History management
// ============================================================

function pushRoute(route: AppRoute) {
  if (typeof window === 'undefined') return;
  if (window.location.pathname !== route) {
    window.history.pushState({ route }, '', route);
  }
}

function replaceRoute(route: AppRoute) {
  if (typeof window === 'undefined') return;
  if (window.location.pathname !== route) {
    window.history.replaceState({ route }, '', route);
  }
}

// ============================================================
// Helpers
// ============================================================

function convertBackendTierToDisplay(backendTier: unknown): PartnerProfile['tier'] {
  const tier = (backendTier as string)?.toUpperCase() ?? 'AFFILIATE';
  const tierMap: Record<string, PartnerProfile['tier']> = {
    'AFFILIATE': 'Affiliate',
    'GROWTH': 'Growth',
    'ELITE': 'Elite',
    'FOUNDING_AMBASSADOR': 'Founding Ambassador'
  };
  return tierMap[tier] ?? 'Affiliate';
}

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
    tier: convertBackendTierToDisplay(profile?.tier),
    commissionRate: (profile?.commissionRate as number) ?? 0.20,
    avatarUrl: (profile?.avatarUrl as string) ?? undefined,
    referralCode: (profile?.referralCode as string) ?? (profile?.referralLinks ? ((profile.referralLinks as Array<Record<string, unknown>>)[0]?.referralCode as string) : undefined),
    termsAccepted: (profile?.termsAccepted as boolean) ?? false,
    marketingConsent: (profile?.marketingConsent as boolean) ?? false,
    emailVerified: true
  };
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
// Derive top-level view from route
// ============================================================

function routeToView(route: AppRoute): AppView {
  if (route === '/affiliate') return 'landing';
  if (route === '/affiliate/dashboard' || route === '/affiliate/settings') return 'dashboard';
  if (route === '/affiliate/admin') return 'admin';
  return 'auth';
}

// ============================================================
// App
// ============================================================

export default function App() {
  const [currentRoute, setCurrentRouteState] = useState<AppRoute>(() =>
    pathToRoute(typeof window !== 'undefined' ? window.location.pathname : '/affiliate')
  );
  const [currentUser, setCurrentUser] = useState<PartnerProfile | null>(null);
  const [allProfiles, setAllProfiles] = useState<PartnerProfile[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [broadcasts, setBroadcasts] = useState<FounderBroadcast[]>([]);
  const [isInitializing, setIsInitializing] = useState(true);

  // Ref to avoid stale closures in popstate handler
  const currentUserRef = useRef<PartnerProfile | null>(null);
  currentUserRef.current = currentUser;

  // ============================================================
  // Authoritative route setter — always syncs URL
  // ============================================================

  const navigateTo = useCallback((route: AppRoute, replace = false) => {
    setCurrentRouteState(route);
    if (replace) {
      replaceRoute(route);
    } else {
      pushRoute(route);
    }
  }, []);

  const protectedNavigate = useCallback((requestedRoute: AppRoute, user: PartnerProfile | null, replace = false) => {
    const safeRoute = getProtectedRoute(user, requestedRoute);
    navigateTo(safeRoute, replace);
    return safeRoute;
  }, [navigateTo]);

  // ============================================================
  // Browser back/forward support
  // ============================================================

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const route = pathToRoute(window.location.pathname);
      const user = currentUserRef.current;
      const safeRoute = getProtectedRoute(user, route);
      if (safeRoute !== route) {
        // Route not allowed — correct it without adding to history
        replaceRoute(safeRoute);
        setCurrentRouteState(safeRoute);
      } else {
        setCurrentRouteState(route);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // ============================================================
  // Session restore on mount
  // ============================================================

  useEffect(() => {
    const initialRoute = pathToRoute(window.location.pathname);

    api.me()
      .then(async (data) => {
        if (data.authenticated && data.user) {
          try {
            const profileRes = await api.getProfile();
            const profile = profileRes.profile as Record<string, unknown>;
            const restoredUser = buildPartnerProfile(data.user, profile);
            setCurrentUser(restoredUser);

            // Now that we have the user, enforce route protection
            const safeRoute = getProtectedRoute(restoredUser, initialRoute);
            // Use replaceState so we don't pollute history on restore
            replaceRoute(safeRoute);
            setCurrentRouteState(safeRoute);

            await loadUserData(restoredUser);
          } catch {
            // Profile fetch failed — protect the route without user
            const safeRoute = getProtectedRoute(null, initialRoute);
            replaceRoute(safeRoute);
            setCurrentRouteState(safeRoute);
          }
        } else {
          // No session — protect route
          const safeRoute = getProtectedRoute(null, initialRoute);
          replaceRoute(safeRoute);
          setCurrentRouteState(safeRoute);
        }
      })
      .catch(() => {
        const safeRoute = getProtectedRoute(null, initialRoute);
        replaceRoute(safeRoute);
        setCurrentRouteState(safeRoute);
      })
      .finally(() => setIsInitializing(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  // Auth callbacks — every transition goes through navigateTo
  // ============================================================

  const handleAuthSuccess = useCallback(async (profile: PartnerProfile) => {
    setCurrentUser(profile);
    const safeRoute = getProtectedRoute(profile, '/affiliate/dashboard');
    navigateTo(safeRoute);
    if (profile.status === 'approved') {
      await loadUserData(profile).catch(() => {});
    }
  }, [navigateTo]);

  /**
   * Called by AuthInterface when the user transitions between auth screens.
   * This is the bridge that keeps AuthInterface's internal mode in sync with the URL.
   */
  const handleAuthRouteChange = useCallback((mode: AuthMode) => {
    const route = authModeToRoute(mode);
    navigateTo(route);
  }, [navigateTo]);

  const handleLogout = useCallback(async () => {
    try { await api.logout(); } catch { /* best-effort */ }
    try { sessionStorage.clear(); } catch { /* ignore */ }
    setCurrentUser(null);
    setAllProfiles([]);
    setWithdrawals([]);
    setBroadcasts([]);
    navigateTo('/affiliate/login');
  }, [navigateTo]);

  // ============================================================
  // Profile callbacks
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
  // Admin callbacks
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

  const handleAddBroadcast = useCallback(async (title: string, content: string) => {
    const newBroadcast: FounderBroadcast = {
      id: `broadcast_${Date.now()}`,
      title,
      content,
      date: new Date().toISOString(),
      author: currentUser?.fullName ?? 'Admin'
    };
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

  const view = routeToView(currentRoute);

  // Landing
  if (view === 'landing') {
    return (
      <LandingPage
        onNavigateToAuth={(subView) => navigateTo(subView === 'register' ? '/affiliate/signup' : '/affiliate/login')}
        currentProfile={currentUser}
        onNavigateToDashboard={() => navigateTo(currentUser?.role === 'admin' ? '/affiliate/admin' : '/affiliate/dashboard')}
      />
    );
  }

  // Auth screens — AuthInterface receives the current mode derived from URL
  if (view === 'auth') {
    const authMode = routeToAuthMode(currentRoute);
    return (
      <AuthInterface
        initialMode={authMode}
        onAuthSuccess={handleAuthSuccess}
        onRouteChange={handleAuthRouteChange}
        onBackToLanding={() => navigateTo('/affiliate')}
        currentUser={currentUser}
      />
    );
  }

  // Dashboard route guard
  if (view === 'dashboard' || view === 'admin') {
    if (!currentUser || currentUser.status !== 'approved') {
      const safeRoute = getProtectedRoute(currentUser, currentRoute);
      if (safeRoute !== currentRoute) {
        replaceRoute(safeRoute);
        setCurrentRouteState(safeRoute);
      }
      return (
        <AuthInterface
          initialMode={routeToAuthMode(safeRoute)}
          onAuthSuccess={handleAuthSuccess}
          onRouteChange={handleAuthRouteChange}
          onBackToLanding={() => navigateTo('/affiliate')}
          currentUser={currentUser}
        />
      );
    }
  }

  if (view === 'admin' && currentUser?.role === 'admin') {
    return (
      <AdminPanel
        allProfiles={allProfiles}
        onModifyProfileStatus={handleModifyProfileStatus}
        onModifyProfileRole={handleModifyProfileRole}
        broadcastsList={broadcasts}
        onAddBroadcast={handleAddBroadcast}
        onBackToDashboard={() => navigateTo('/affiliate/dashboard')}
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
      onNavigateToAuth={(subView) => navigateTo(subView === 'register' ? '/affiliate/signup' : '/affiliate/login')}
      currentProfile={null}
      onNavigateToDashboard={() => navigateTo('/affiliate')}
    />
  );
}