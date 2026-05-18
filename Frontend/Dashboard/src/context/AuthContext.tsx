import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { api } from '@/lib/utils';
import type { AxiosError } from 'axios';

export interface User {
  id: string;
  email: string;
  full_name: string;
  tenant_id: string;
  onboarding_status: 'completed' | 'pending';
  email_verified: boolean;
}

export interface AuthContextProps {
  user: User | null;
  loading: boolean;
  error: string | null;
  csrfToken: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkSession: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextProps | undefined>(undefined);

const SESSION_POLL_INTERVAL = 5 * 60 * 1000;
const SESSION_VALIDATION_TIMEOUT = 30 * 1000;

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const checkSessionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const userRef = useRef<User | null>(null);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const checkSession = useCallback(async () => {
    console.log('[DASHBOARD AUTH] Starting session validation', { timestamp: new Date().toISOString() });
    try {
      const response = await api.get('/session/me', {
        withCredentials: true,
        timeout: SESSION_VALIDATION_TIMEOUT
      });

      if (response.data && response.data.authenticated) {
        // ✅ Merge tenant-level onboarding_status into user object
        const authenticatedUser: User = {
          ...response.data.user,
          onboarding_status:
            response.data.onboarding_status ??
            response.data.user?.onboarding_status ??
            'pending'
        };

        console.log('[DASHBOARD AUTH] User authenticated', {
          userId: authenticatedUser.id,
          onboarding_status: authenticatedUser.onboarding_status
        });

        setUser(authenticatedUser);
        setError(null);
      } else {
        console.warn('[DASHBOARD AUTH] Response not authenticated');
        setUser(null);
      }
    } catch (err) {
      const status = (err as AxiosError)?.response?.status;
      console.error('[DASHBOARD AUTH] Session validation error:', {
        message: err instanceof Error ? err.message : String(err),
        status
      });

      if (status === 401 || status === 403) {
        // Genuinely not authenticated
        setUser(null);
      } else {
        // ✅ Server down or network error — show error, don't clear user
        setError('Unable to connect to server. Please check your connection.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setLoading(true);
    setError(null);

    try {
      const response = await api.post('/session/login', {
        email: email.toLowerCase().trim(),
        password
      }, { withCredentials: true });

      if (response.data) {
        if (response.data.csrfToken) {
          setCsrfToken(response.data.csrfToken);
          sessionStorage.setItem('csrf_token', response.data.csrfToken);
        }

        if (response.data.user) {
          const loggedInUser: User = {
            ...response.data.user,
            onboarding_status:
              response.data.onboarding_status ??
              response.data.user?.onboarding_status ??
              'pending'
          };
          setUser(loggedInUser);
          userRef.current = loggedInUser;
        }

        setTimeout(() => {
          window.location.href = '/dashboard/overview';
        }, 100);
      }
    } catch (err) {
      const errorMessage = err instanceof Error
        ? err.message
        : (err as AxiosError<{ error?: string }>)?.response?.data?.error || 'Login failed. Please try again.';
      setError(errorMessage);
      setUser(null);
      setLoading(false);
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    setLoading(true);

    try {
      const token = csrfToken || sessionStorage.getItem('csrf_token');
      const headers: Record<string, string> = {};
      if (token) headers['X-CSRF-Token'] = token;
      await api.post('/session/logout', {}, { withCredentials: true, headers });
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      setUser(null);
      userRef.current = null;
      setCsrfToken(null);
      sessionStorage.removeItem('csrf_token');
      sessionStorage.clear();
      localStorage.setItem('auth_logout_signal', Date.now().toString());
      localStorage.removeItem('auth_logout_signal');
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      setLoading(false);
      window.location.href = '/auth/loginIn.html';
    }
  }, [csrfToken]);

  const clearError = useCallback(() => setError(null), []);

  useEffect(() => {
    console.log('[DASHBOARD AUTH] AuthProvider mounted, starting initial session check');
    checkSession();

    pollIntervalRef.current = setInterval(() => {
      checkSession();
    }, SESSION_POLL_INTERVAL);

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'auth_logout_signal') {
        setUser(null);
        userRef.current = null;
        setCsrfToken(null);
        window.location.href = '/auth/loginIn.html';
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (checkSessionTimeoutRef.current) clearTimeout(checkSessionTimeoutRef.current);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [checkSession]);

  useEffect(() => {
    const requestInterceptor = api.interceptors.request.use((config) => {
      const token = csrfToken || sessionStorage.getItem('csrf_token');
      if (token) config.headers['X-CSRF-Token'] = token;
      return config;
    });

    const errorInterceptor = api.interceptors.response.use(
      (response) => response,
      (err) => {
        if (err.response?.status === 401 || err.response?.status === 403) {
          if (userRef.current) {
            console.warn('[DASHBOARD AUTH] Session expired, redirecting to login');
            setUser(null);
            userRef.current = null;
            setCsrfToken(null);
            sessionStorage.removeItem('csrf_token');
            window.location.href = '/auth/loginIn.html';
          }
        }
        return Promise.reject(err);
      }
    );

    return () => {
      api.interceptors.request.eject(requestInterceptor);
      api.interceptors.response.eject(errorInterceptor);
    };
  }, [csrfToken]);

  return (
    <AuthContext.Provider value={{ user, loading, error, csrfToken, login, logout, checkSession, clearError }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextProps => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};