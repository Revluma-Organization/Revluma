import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { api } from '@/lib/api';
import { performLogout } from '@/lib/auth/logout';
import { broadcastLogin, storeRefreshToken } from '@/lib/auth/session';

export interface OrgMembership {
  id: string;
  role: string;
  organization_id: string;
  joined_at: string | null;
  organizations: { id: string; company_name: string };
}

export interface User {
  id: string;
  email: string;
  full_name: string;
  display_name?: string;
  avatar_url?: string | null;
  role: string;
  tenant_id: string;
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
}

interface AuthActions {
  setUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setCsrfToken: (token: string | null) => void;
  setHydrated: (hydrated: boolean) => void;
  login: (email: string, password: string) => Promise<void>;
  logout: (allSessions?: boolean) => Promise<void>;
  checkSession: () => Promise<void>;
  clearError: () => void;
  changePassword: (current: string, newPass: string, confirm: string) => Promise<void>;
  requestOtp: (email: string) => Promise<void>;
  verifyOtp: (email: string, otp: string) => Promise<{ resetToken: string }>;
  resetPassword: (email: string, resetToken: string, newPassword: string) => Promise<void>;
  /** Reset in-memory auth state after a cross-tab logout (storage already cleared). */
  resetLocalAuthState: () => void;
}

type AuthStore = AuthState & AuthActions;

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user: null,
      loading: false,
      error: null,
      csrfToken: null,
      isHydrated: false,

      setUser: (user) => set({ user }),
      setLoading: (loading) => set({ loading }),
      setError: (error) => set({ error }),
      setCsrfToken: (csrfToken) => set({ csrfToken }),
      setHydrated: (isHydrated) => set({ isHydrated }),
      clearError: () => set({ error: null }),
      resetLocalAuthState: () => set({ user: null, csrfToken: null, loading: false, error: null }),

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
        set({ loading: true, error: null });
        try {
          const res = await api.post<{
            data: {
              access_token: string;
              refresh_token: string;
              user: { id: string; full_name: string; email: string };
            };
          }>('/auth/login', { account: { email, password } });

          const { access_token, refresh_token, user } = res.data.data;

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
              role: 'admin',
              tenant_id: '',
              email_verified: true,
              onboarding_status: 'completed',
            },
            loading: false,
            error: null,
          });
        } catch {
          set({ loading: false, error: 'Invalid email or password. Please try again.' });
        }
      },

      checkSession: async () => {
        set({ loading: true });
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
            organizations?: Array<{ id: string }>;
            organization_memberships?: Membership[];
          };
          let u: ProfileData | null = null;
          try {
            const res = await api.get<{ success: boolean; data: ProfileData }>('/auth/me');
            u = res.data.data;
          } catch {
            const res2 = await api.get<{ success: boolean; data: ProfileData }>('/auth/getProfile');
            u = res2.data.data;
          }

          if (!u) throw new Error('No user data returned');

          const memberships = u.organization_memberships ?? [];
          const primaryMembership = memberships[0];
          const role = primaryMembership?.role ?? 'member';
          const tenantId = u.organizations?.[0]?.id ?? primaryMembership?.organization_id ?? '';

          set({
            user: {
              id: u.id,
              email: u.email,
              full_name: u.full_name,
              display_name: u.full_name.split(' ')[0],
              avatar_url: null,
              role,
              tenant_id: tenantId,
              email_verified: u.email_verified ?? false,
              onboarding_status: u.onboarding_completed ? 'completed' : 'pending',
              organization_memberships: memberships,
            },
            loading: false,
          });
        } catch {
          // 401 already clears storage + redirects via api.ts.
          set({ user: null, csrfToken: null, loading: false });
        }
      },

      logout: async (allSessions = false) => {
        // Clear Zustand state first so ProtectedRoute cannot flash auth UI during redirect.
        set({ user: null, csrfToken: null, loading: false, error: null });
        await performLogout({ allSessions });
      },
    }),
    {
      name: 'rv-auth',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        user: state.user,
        csrfToken: state.csrfToken,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.setHydrated(true);
        }
      },
    }
  )
);
