import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { api } from '@/lib/api';

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

      changePassword: async (currentPassword, newPassword, confirmNewPassword) => {
        set({ loading: true, error: null });
        try {
          await api.post('/auth/change-password', { currentPassword, newPassword, confirmNewPassword });
          set({ loading: false });
        } catch (err: any) {
          set({ loading: false, error: err?.message || 'Failed to change password. Please try again.' });
          throw err;
        }
      },

      requestOtp: async (email) => {
        set({ loading: true, error: null });
        try {
          await api.post('/auth/forgot-password', { email });
          set({ loading: false });
        } catch (err: any) {
          set({ loading: false, error: err?.message || 'Failed to send OTP.' });
          throw err;
        }
      },

      verifyOtp: async (email, otp) => {
        set({ loading: true, error: null });
        try {
          const res = await api.post<{ data: { resetToken: string } }>('/auth/verify-otp', { email, otp });
          set({ loading: false });
          return { resetToken: res.data.data.resetToken };
        } catch (err: any) {
          set({ loading: false, error: err?.message || 'Invalid or expired OTP.' });
          throw err;
        }
      },

      resetPassword: async (email, resetToken, newPassword) => {
        set({ loading: true, error: null });
        try {
          await api.post('/auth/reset-password', { email, resetToken, newPassword });
          set({ loading: false });
        } catch (err: any) {
          set({ loading: false, error: err?.message || 'Failed to reset password.' });
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
          // Try /auth/me first (preferred), fall back to legacy /auth/getProfile
          type ProfileData = {
            id: string;
            full_name: string;
            email: string;
            email_verified: boolean;
            onboarding_completed: boolean;
            organizations?: Array<{ id: string }>;
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

          set({
            user: {
              id: u.id,
              email: u.email,
              full_name: u.full_name,
              display_name: u.full_name.split(' ')[0],
              avatar_url: null,
              role: 'admin',
              tenant_id: u.organizations?.[0]?.id ?? '',
              email_verified: u.email_verified ?? false,
              onboarding_status: u.onboarding_completed ? 'completed' : 'pending',
            },
            loading: false,
          });
        } catch {
          // 401 handled by api.ts. Any other error: clear session.
          set({ user: null, csrfToken: null, loading: false });
        }
      },
      logout: async (allSessions = false) => {
        try {
          const refreshToken = localStorage.getItem('revluma_refresh_token');
          // Send refresh_token so the server can revoke it from the DB — real logout
          const endpoint = allSessions ? '/auth/logout-all' : '/auth/logout';
          await api.post(endpoint, { refresh_token: refreshToken });
        } catch {
          // Network failure — still clear locally so user is signed out in browser
        }
        localStorage.removeItem('revluma_refresh_token');
        set({ user: null, csrfToken: null });
        window.location.href = '/login';
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
