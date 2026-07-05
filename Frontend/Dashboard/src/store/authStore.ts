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

          // Store refresh token separately for the refresh endpoint
          localStorage.setItem('revluma_refresh_token', refresh_token);

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
      logout: async () => {
        try {
          await api.post('/auth/logout');
        } catch {
          // ignore — clear session regardless
        }
        localStorage.removeItem('revluma_refresh_token');
        set({ user: null, csrfToken: null });
        window.location.href = '/auth/loginIn.html';
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