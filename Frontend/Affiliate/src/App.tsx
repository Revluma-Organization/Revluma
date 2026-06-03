/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * App.tsx — root of the Affiliate Portal.
 *
 * PHASE 9: Production-grade authentication routing & URL state management.
 * Every auth screen has its own dedicated URL. Browser history, back/forward,
 * deep links, refresh persistence, and route protection all work correctly.
 *
 * PERF: Cold-start optimizations:
 *  - Landing page (/affiliate) renders instantly without waiting for session check
 *  - Public pre-registration routes skip session check entirely
 *  - AuthInterface mounts with its own backend warm-up ping scoped to component
 *  - Loading screen uses premium circular spinner matching brand design
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
    case '/affiliate/signup':        return 'register';
    case '/affiliate/verify-email':  return 'verifyEmail';
    case '/affiliate/access-token':  return 'accessToken';
    case '/affiliate/pending-review': return 'pendingApproval';
    case '/affiliate/rejected':      return 'rejected';
    case '/affiliate/login':
    default:                         return 'login';
  }
}

function authModeToRoute(mode: AuthMode): AppRoute {
  switch (mode) {
    case 'register':        return '/affiliate/signup';
    case 'verifyEmail':     return '/affiliate/verify-email';
    case 'accessToken':     return '/affiliate/access-token';
    case 'pendingApproval': return '/affiliate/pending-review';
    case 'rejected':        return '/affiliate/rejected';
    case 'login':
    case 'forgot':
    case 'resetConfirm':
    default:                return '/affiliate/login';
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
// Route protection
// ============================================================

function getProtectedRoute(user: PartnerProfile | null, requestedRoute: AppRoute): AppRoute {
  if (!user) {
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
    case 'under_review':
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

const BASE_URL = '/api';

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
// Premium Loading Screen Component
// Matches the circular gradient spinner in the brand reference image.
// ============================================================

function LoadingScreen() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#09090b',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1.5rem',
      }}
    >
      <style>{`
        @keyframes revluma-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes revluma-fade-pulse {
          0%, 100% { opacity: 0.5; }
          50%       { opacity: 1; }
        }
      `}</style>

      {/* Circular gradient spinner — matches the reference image */}
      <div
        style={{
          position: 'relative',
          width: 72,
          height: 72,
          animation: 'revluma-spin 1s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite',
        }}
      >
        {/* Ring with conic-gradient fade */}
        <svg
          viewBox="0 0 72 72"
          width="72"
          height="72"
          style={{ position: 'absolute', inset: 0 }}
        >
          <defs>
            <linearGradient id="rl-spinner-grad" x1="1" y1="0" x2="0" y2="0">
              <stop offset="0%"   stopColor="#ffffff" stopOpacity="1" />
              <stop offset="40%"  stopColor="#a1a1aa" stopOpacity="0.7" />
              <stop offset="75%"  stopColor="#52525b" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#27272a" stopOpacity="0.04" />
            </linearGradient>
          </defs>
          <circle
            cx="36"
            cy="36"
            r="28"
            fill="none"
            stroke="url(#rl-spinner-grad)"
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray="155 20"
          />
        </svg>

        {/* Bright leading dot */}
        <div
          style={{
            position: 'absolute',
            top: 4,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 11,
            height: 11,
            borderRadius: '50%',
            background: '#ffffff',
            boxShadow: '0 0 10px 3px rgba(255,255,255,0.6)',
          }}
        />
      </div>

      {/* Label */}
      <span
        style={{
          fontFamily: 'ui-monospace, "SF Mono", Consolas, monospace',
          fontSize: 11,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'rgba(255,255,255,0.45)',
          fontWeight: 500,
          animation: 'revluma-fade-pulse 2s ease-in-out infinite',
        }}
      >
        Loading...
      </span>
    </div>
  );
}

// ============================================================
// Routes that never need a session check
// ============================================================

/** Public-only routes: render immediately, skip session fetch entirely */
const PUBLIC_ONLY_ROUTES: AppRoute[] = [
  '/affiliate/signup',
  '/affiliate/verify-email',
  '/affiliate/access-token',
  '/affiliate/pending-review',
  '/affiliate/rejected',
];

/** Landing page renders instantly — session check runs in the background */
const INSTANT_RENDER_ROUTES: AppRoute[] = [
  '/affiliate',
  ...PUBLIC_ONLY_ROUTES,
];

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

  // isInitializing is false from the start for instant-render routes so the
  // landing page / public screens appear immediately without any spinner.
  const [isInitializing, setIsInitializing] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const route = pathToRoute(window.location.pathname);
    return !INSTANT_RENDER_ROUTES.includes(route);
  });

  const currentUserRef = useRef<PartnerProfile | null>(null);
  currentUserRef.current = currentUser;

  // ============================================================
  // Authoritative route setter
  // ============================================================

  const navigateTo = useCallback((route: AppRoute, replace = false) => {
    setCurrentRouteState(route);
    if (replace) replaceRoute(route);
    else pushRoute(route);
  }, []);

  const protectedNavigate = useCallback((requestedRoute: AppRoute, user: PartnerProfile | null, replace = false) => {
    const safeRoute = getProtectedRoute(user, requestedRoute);
    navigateTo(safeRoute, replace);
    return safeRoute;
  }, [navigateTo]);

  // ============================================================
  // Browser back/forward
  // ============================================================

  useEffect(() => {
    const handlePopState = () => {
      const route = pathToRoute(window.location.pathname);
      const user = currentUserRef.current;
      const safeRoute = getProtectedRoute(user, route);
      if (safeRoute !== route) {
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

    // Public-only routes: no session needed, render immediately.
    if (PUBLIC_ONLY_ROUTES.includes(initialRoute)) {
      setCurrentRouteState(initialRoute);
      setIsInitializing(false);
      return;
    }

    // Landing page: render immediately, then silently check session
    // to see if we should redirect an already-logged-in user.
    if (initialRoute === '/affiliate') {
      setCurrentRouteState(initialRoute);
      setIsInitializing(false);
      // Background session check — if the user is already logged in
      // we'll redirect them to the dashboard without showing the landing.
      api.me()
        .then(async (data) => {
          if (data.authenticated && data.user) {
            try {
              const profileRes = await api.getProfile();
              const profile = profileRes.profile as Record<string, unknown>;
              const restoredUser = buildPartnerProfile(data.user, profile);
              setCurrentUser(restoredUser);
              const safeRoute = getProtectedRoute(restoredUser, initialRoute);
              if (safeRoute !== initialRoute) {
                replaceRoute(safeRoute);
                setCurrentRouteState(safeRoute);
                await loadUserData(restoredUser);
              }
            } catch { /* profile fetch failed — stay on landing */ }
          }
        })
        .catch(() => { /* no session — stay on landing */ });
      return;
    }

    // All other routes (dashboard, auth screens): check session first.
    api.me()
      .then(async (data) => {
        if (data.authenticated && data.user) {
          try {
            const profileRes = await api.getProfile();
            const profile = profileRes.profile as Record<string, unknown>;
            const restoredUser = buildPartnerProfile(data.user, profile);
            setCurrentUser(restoredUser);
            const safeRoute = getProtectedRoute(restoredUser, initialRoute);
            replaceRoute(safeRoute);
            setCurrentRouteState(safeRoute);
            await loadUserData(restoredUser);
          } catch {
            const safeRoute = getProtectedRoute(null, initialRoute);
            replaceRoute(safeRoute);
            setCurrentRouteState(safeRoute);
          }
        } else {
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
  // Auth callbacks
  // ============================================================

  const handleAuthSuccess = useCallback(async (profile: PartnerProfile) => {
    setCurrentUser(profile);
    const safeRoute = getProtectedRoute(profile, '/affiliate/dashboard');
    navigateTo(safeRoute);
    if (profile.status === 'approved') {
      await loadUserData(profile).catch(() => {});
    }
  }, [navigateTo]);

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
    return <LoadingScreen />;
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

  // Auth screens
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

  // Dashboard / admin route guard
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