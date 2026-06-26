import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

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

const MOCK_USER: User = {
  id: "mock-user-001",
  email: "alex@mystore.com",
  full_name: "Alex Johnson",
  display_name: "Alex",
  avatar_url: null,
  role: "admin",
  tenant_id: "tenant-001",
  email_verified: true,
  onboarding_status: "completed",
  membership_tier: "pro",
  account_status: "active",
  last_login_at: new Date().toISOString(),
};

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user: MOCK_USER,
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

      checkSession: async () => {
        set({ user: MOCK_USER, error: null, loading: false });
      },

      login: async (_email, _password) => {
        set({ user: MOCK_USER, loading: false, error: null });
      },

      logout: async () => {
        set({ user: null, csrfToken: null, loading: false });
        window.location.href = '/auth/loginIn.html';
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
