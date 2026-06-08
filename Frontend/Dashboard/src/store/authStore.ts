import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import api from '@/lib/api';
import type { AxiosError } from 'axios';

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
    (set, get) => ({
      user: null,
      loading: true,
      error: null,
      csrfToken: null,
      isHydrated: false,

      setUser: (user) => set({ user }),
      setLoading: (loading) => set({ loading }),
      setError: (error) => set({ error }),
      setCsrfToken: (csrfToken) => set({ csrfToken }),
      setHydrated: (isHydrated) => set({ isHydrated }),

      clearError: () => set({ error: null }),

      checkSession: async () => {
        try {
          const response = await api.get('/session/me', {
            withCredentials: true,
            timeout: 30000
          });

          if (response.data?.authenticated) {
            const userData: User = {
              ...response.data.user,
              onboarding_status:
                response.data.onboarding_status ??
                response.data.user?.onboarding_status ??
                'pending'
            };
            set({ user: userData, error: null, loading: false });
          } else {
            set({ user: null, loading: false });
          }
        } catch (err) {
          const status = (err as AxiosError)?.response?.status;
          if (status === 401 || status === 403) {
            set({ user: null, loading: false });
          } else {
            set({
              error: 'Unable to connect to server. Please check your connection.',
              loading: false
            });
          }
        }
      },

      login: async (email, password) => {
        set({ loading: true, error: null });
        try {
          const response = await api.post(
            '/session/login',
            { email: email.toLowerCase().trim(), password },
            { withCredentials: true }
          );

          if (response.data) {
            if (response.data.csrfToken) {
              set({ csrfToken: response.data.csrfToken });
              sessionStorage.setItem('csrf_token', response.data.csrfToken);
            }

            if (response.data.user) {
              const userData: User = {
                ...response.data.user,
                onboarding_status:
                  response.data.onboarding_status ??
                  response.data.user?.onboarding_status ??
                  'pending'
              };
              set({ user: userData });
            }

            const maxAttempts = 8;
            const delayMs = 250;
            let authenticated = false;

            for (let attempt = 0; attempt < maxAttempts; attempt++) {
              try {
                const me = await api.get('/session/me', {
                  withCredentials: true,
                  timeout: 30000
                });
                if (me.data?.authenticated) {
                  const serverUser = me.data.user;
                  if (serverUser) {
                    const merged: User = {
                      ...serverUser,
                      onboarding_status:
                        me.data.onboarding_status ?? serverUser.onboarding_status ?? 'pending'
                    };
                    set({ user: merged });
                  }
                  authenticated = true;
                  break;
                }
              } catch {
                // retry
              }
              await new Promise((r) => setTimeout(r, delayMs));
            }

            if (authenticated) {
              set({ loading: false });
            } else {
              set({
                error: 'Unable to confirm server session after login. Please try again.',
                user: null,
                loading: false
              });
            }
          }
        } catch (err) {
          const errorMessage =
            err instanceof Error
              ? err.message
              : (err as AxiosError<{ error?: string }>)?.response?.data?.error ||
                'Login failed. Please try again.';
          set({ error: errorMessage, user: null, loading: false });
          throw err;
        }
      },

      logout: async (allSessions = false) => {
        set({ loading: true });
        try {
          const token = get().csrfToken || sessionStorage.getItem('csrf_token');
          const headers: Record<string, string> = {};
          if (token) headers['X-CSRF-Token'] = token;

          const response = await api.post('/session/logout', { allSessions }, { withCredentials: true, headers });

          if (response.data?.logoutBroadcast) {
            try {
              localStorage.setItem('auth_logout_signal', Date.now().toString());
            } catch { /* ignore */ }
          }
        } catch { /* best-effort */ }
        finally {
          set({ user: null, csrfToken: null, loading: false });
          try { sessionStorage.removeItem('csrf_token'); sessionStorage.clear(); } catch { /* ignore */ }
          const authKeys = ['revluma_token', 'revluma_user', 'revluma_pending_token', 'revluma_remembered_email', 'csrf_token', 'auth_bridge'];
          authKeys.forEach((key) => { try { localStorage.removeItem(key); } catch { /* ignore */ } });
          window.location.href = '/auth/loginIn.html';
        }
      }
    }),
    {
      name: 'rv-auth',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        user: state.user,
        csrfToken: state.csrfToken
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.setHydrated(true);
        }
      }
    }
  )
);
