import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { resolveProfileMembership, onSessionTokenChanged, invalidateSession, currentSessionGeneration, onSessionSynchronisation } from '@/lib/auth/organization';
import { queryClient } from '@/lib/queryClient';
import { api } from '@/lib/api';
import { performLogout } from '@/lib/auth/logout';
import { broadcastLogin, storeRefreshToken, getAccessToken } from '@/lib/auth/session';

export interface OrgMembership {
  id: string;
  role: string;
  organization_id: string;
  joined_at: string | null;
  status?: string;
  organizations: { id: string; company_name: string };
}

export interface User {
  id: string;
  email: string;
  full_name: string;
  display_name?: string;
  avatar_url?: string | null;
  role: string;
  profile_picture_url?: string | null;
  tenant_id: string;
  active_organization_id?: string | null;
  email_verified: boolean;
  onboarding_status: string;
  membership_tier?: string;
  account_status?: string;
  last_login_at?: string | null;
  organization_memberships?: OrgMembership[];
}

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
  csrfToken: string | null;
  isHydrated: boolean;
  sessionVerified: boolean;
}

interface AuthActions {
  setUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setCsrfToken: (token: string | null) => void;
  setHydrated: (hydrated: boolean) => void;
  login: (email: string, password: string) => Promise<{ requires2FA: boolean; tempToken?: string } | void>;
  verify2FA: (code: string, tempToken: string, trustDevice: boolean) => Promise<void>;
  logout: (allSessions?: boolean) => Promise<void>;
  checkSession: () => Promise<void>;
  selectWorkspace: (organizationId: string) => Promise<void>;
  clearError: () => void;
  changePassword: (current: string, newPass: string, confirm: string) => Promise<void>;
  requestOtp: (email: string) => Promise<void>;
  verifyOtp: (email: string, otp: string) => Promise<{ resetToken: string }>;
  resetPassword: (email: string, resetToken: string, newPassword: string) => Promise<void>;
  /** Reset in-memory auth state after a cross-tab logout (storage already cleared). */
  resetLocalAuthState: () => void;
  synchroniseSession: () => void;
}

type AuthStore = AuthState & AuthActions;

let sessionRequest = 0;

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      user: null,
      loading: false,
      error: null,
      csrfToken: null,
      isHydrated: false,
      sessionVerified: false,

      setUser: (user) => set({ user }),
      setLoading: (loading) => set({ loading }),
      setError: (error) => set({ error }),
      setCsrfToken: (csrfToken) => set({ csrfToken }),
      setHydrated: (isHydrated) => set({ isHydrated }),
      clearError: () => set({ error: null }),
      resetLocalAuthState: () => {
        invalidateSession();
        sessionRequest += 1;
        try { sessionStorage.removeItem('rv-auth'); } catch { /* Storage may be unavailable. */ }
        set({ sessionVerified: false, user: null, csrfToken: null, loading: false, error: null });
      },
      synchroniseSession: () => {
        const token = getAccessToken();
        if (token === get().csrfToken) return;
        invalidateSession();
        sessionRequest += 1;
        // Adopt shared credentials before any persisted set can overwrite them.
        let user: User | null = null;
        for (const storage of [localStorage, sessionStorage]) {
          try {
            const stored = JSON.parse(storage.getItem('rv-auth') || 'null')?.state;
            if (token && (stored?.accessToken || stored?.csrfToken) === token) {
              user = stored.user ? { ...stored.user, tenant_id: stored.user.tenant_id || stored.user.active_organization_id || '', role: 'unknown' } : null;
              break;
            }
          } catch { /* Ignore malformed legacy records and verify with the server. */ }
        }
        set({ csrfToken: token, user, sessionVerified: false });
        queryClient.clear();
        if (get().csrfToken) void get().checkSession();
      },

      changePassword: async (currentPassword, newPassword) => {
  set({ loading: true, error: null });
  try {
    await api.post('/auth/change-password', {
      current_password: currentPassword,
      new_password: newPassword,
    });
    set({ loading: false });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to change password';
    set({ loading: false, error: message });
    throw err;
  }
},

      requestOtp: async (email) => {
  set({ loading: true, error: null });
  try {
    await api.post('/auth/forgot-password', { email });
    set({ loading: false });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to request OTP';
    set({ loading: false, error: message });
    throw err;
  }
},

      verifyOtp: async (email, otp) => {
  set({ loading: true, error: null });
  try {
    const res = await api.post<any>('/auth/forgot-password/verify', {
      email,
      code: otp,
    });
    set({ loading: false });
    return res.data.resetToken || res.data.data.resetToken;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invalid OTP';
    set({ loading: false, error: message });
    throw err;
  }
},

      resetPassword: async (email, resetToken, newPassword) => {
  set({ loading: true, error: null });
  try {
        await api.post('/auth/forgot-password/reset', {
        email: email,
        reset_token: resetToken,
        new_password: newPassword,
        password: newPassword,
      });
    set({ loading: false });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to reset password';
    set({ loading: false, error: message });
    throw err;
  }
},

      login: async (email, password) => {
        let generation = currentSessionGeneration();
        set({ loading: true, error: null });
        try {
          // Changed typing to 'any' to dynamically handle both 2FA and normal login responses
          const res = await api.post<any>('/auth/login', { account: { email, password } });
          if (generation !== currentSessionGeneration()) return;

          // --- PHASE 1: 2FA INTERCEPTION ---
          if (res.data.requires_2fa || res.data.data?.requires_2fa) {
            set({ loading: false });
            return { 
              requires2FA: true, 
              tempToken: res.data.temp_token || res.data.data?.temp_token || res.data.data?.access_token 
            };
          }

          // --- PHASE 1: STANDARD LOGIN (If 2FA is OFF) ---
          const { access_token, refresh_token, user } = res.data.data;

          invalidateSession();
          generation = currentSessionGeneration();
          queryClient.clear();
          storeRefreshToken(refresh_token);
          broadcastLogin();

          set({
            csrfToken: access_token,
            user: {
              id: user.id,
              email: user.email,
              full_name: user.full_name,
              display_name: user.full_name.split(' ')[0],
              avatar_url: null,
              profile_picture_url: (user as any).profile_picture_url || null,
              role: 'unknown',
              tenant_id: user.active_organization_id || '',
              email_verified: user.email_verified === true,
              onboarding_status: user.onboarding_completed ? 'completed' : 'pending',
            },
            loading: false,
            error: null,
          });
        } catch (err: any) {
          if (generation !== currentSessionGeneration()) return;
          set({ loading: false, error: 'Invalid email or password. Please try again.' });
          throw err;
        }
        await get().checkSession();
      },

      // --- PHASE 2: 2FA VERIFICATION ---
      verify2FA: async (code, tempToken, trustDevice) => {
        let generation = currentSessionGeneration();
        set({ loading: true, error: null });
        try {
          // Pass the boolean to backend's endpoint
          const res = await api.post<any>('/auth/2fa/verify', 
            { code, trust_device: trustDevice }, 
            { accessToken: tempToken, skipAuthRedirect: true }
          );
          if (generation !== currentSessionGeneration()) return;

          // Once verified, grab the real tokens and finally log the user in!
          const { access_token, refresh_token, user } = res.data.data;

          invalidateSession();
          generation = currentSessionGeneration();
          queryClient.clear();
          storeRefreshToken(refresh_token);
          broadcastLogin();

          set({
            csrfToken: access_token,
            user: {
              id: user.id,
              email: user.email,
              full_name: user.full_name,
              display_name: user.full_name.split(' ')[0],
              avatar_url: null,
              profile_picture_url: (user as any).profile_picture_url || null,
              role: 'unknown',
              tenant_id: user.active_organization_id || '',
              email_verified: user.email_verified === true,
              onboarding_status: user.onboarding_completed ? 'completed' : 'pending',
            },
            loading: false,
            error: null,
          });
        } catch (err: any) {
          if (generation !== currentSessionGeneration()) return;
          set({ loading: false, error: 'Invalid 2FA code. Please try again.' });
          throw err;
        }
        await get().checkSession();
      },

      checkSession: async () => {
        const requestId = ++sessionRequest;
        const generation = currentSessionGeneration();
        const isCurrent = () => requestId === sessionRequest && generation === currentSessionGeneration();
        set({ loading: true, sessionVerified: false });
        try {
          type Membership = {
            id: string;
            role: string;
            organization_id: string;
            joined_at: string | null;
            organizations: { id: string; company_name: string };
          };
          type ProfileData = {
            id: string;
            full_name: string;
            email: string;
            email_verified: boolean;
            onboarding_completed: boolean;
            profile_picture_url?: string;
            organizations?: Array<{ id: string }>;
            organization_members?: Membership[];
            organization_memberships?: Membership[];
            active_organization_id?: string | null;
          };
          let u: ProfileData | null = null;
          try {
            const res = await api.get<{ success: boolean; data: ProfileData }>('/auth/me');
            if (!res.data.success) throw new Error('Session could not be verified.');
            u = res.data.data;
          } catch {
            if (!isCurrent()) return;
            const res2 = await api.get<{ success: boolean; data: ProfileData }>('/auth/getProfile');
            if (!res2.data.success) throw new Error('Session could not be verified.');
            u = res2.data.data;
          }

          if (!isCurrent()) return;
          if (!u) throw new Error('No user data returned');

          const memberships = u.organization_members ?? u.organization_memberships ?? [];
          const selected = resolveProfileMembership(memberships, u.active_organization_id);
          const role = selected?.role ?? 'unknown';
          const tenantId = selected?.organization_id ?? '';

          set({
            csrfToken: getAccessToken(),
            user: {
              id: u.id,
              email: u.email,
              full_name: u.full_name,
              display_name: u.full_name.split(' ')[0],
              avatar_url: u.profile_picture_url || null,
              profile_picture_url: u.profile_picture_url || null,
              role,
              tenant_id: tenantId,
              email_verified: u.email_verified ?? false,
              onboarding_status: u.onboarding_completed ? 'completed' : 'pending',
              organization_memberships: memberships.filter(member => !("status" in member) || member.status === "active"),
            },
            loading: false,
            sessionVerified: true,
          });
        } catch {
          if (!isCurrent()) return;
          // 401 already clears storage + redirects via api.ts.
          set({ user: null, csrfToken: null, loading: false, sessionVerified: false });
        }
      },

      selectWorkspace: async (organizationId) => {
        const current = get().user;
        if (!current) throw new Error('Sign in before selecting a workspace.');
        invalidateSession();
        sessionRequest += 1;
        let generation = currentSessionGeneration();
        set({ sessionVerified: false, user: { ...current, role: 'unknown' } });
        queryClient.clear();
        try {
          const response = await api.post<{ success: boolean; data: { access_token: string; active_organization_id: string; role: string } }>('/auth/workspace', { organization_id: organizationId });
          if (generation !== currentSessionGeneration()) throw new Error('Session changed during workspace selection.');
          const context = response.data.data;
          if (!response.data.success || context?.active_organization_id !== organizationId || !context.access_token) throw new Error('Workspace selection could not be verified.');
          invalidateSession();
          generation = currentSessionGeneration();
          queryClient.clear();
          set({ csrfToken: context.access_token, sessionVerified: false, user: { ...current, tenant_id: organizationId, role: 'unknown' } });
          await get().checkSession();
          if (!get().sessionVerified || get().user?.tenant_id !== organizationId) throw new Error('Workspace membership could not be verified.');
        } catch (error) {
          if (generation === currentSessionGeneration()) await get().checkSession();
          throw error;
        }
      },

      logout: async (allSessions = false) => {
        // Clear Zustand state first so ProtectedRoute cannot flash auth UI during redirect.
        const accessToken = getAccessToken() || undefined;
        get().resetLocalAuthState();
        await performLogout({ allSessions, accessToken });
      },
    }),
    {
      name: 'rv-auth',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        user: state.user,
        csrfToken: state.csrfToken,
      }),
      merge: (persisted, current) => {
        const stored = persisted as Partial<AuthState> | undefined;
        return { ...current, csrfToken: stored?.csrfToken || null,
          user: stored?.user ? { ...stored.user, tenant_id: stored.user.tenant_id || stored.user.active_organization_id || '', role: 'unknown' } : null,
          sessionVerified: false };
      },
      onRehydrateStorage: () => {
        invalidateSession();
        sessionRequest += 1;
        return (state) => {
          if (state) {
            state.setHydrated(true);
          }
        };
      },
    }
  )
);

// Refresh rotates storage and in-memory credentials together, then rechecks roles.
onSessionTokenChanged(accessToken => {
  if (!useAuthStore.getState().csrfToken || getAccessToken() !== accessToken) return;
  useAuthStore.setState({ csrfToken: accessToken });
  void useAuthStore.getState().checkSession();
});
onSessionSynchronisation(() => useAuthStore.getState().synchroniseSession());
