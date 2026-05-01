import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { api } from '@/lib/utils';

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

// Session polling interval in milliseconds
const SESSION_POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes
const SESSION_VALIDATION_TIMEOUT = 30 * 1000; // 30 seconds for quick validation

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const checkSessionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Validate current session with backend
  const checkSession = useCallback(async () => {
    try {
      const response = await api.get('/session/me', {
        withCredentials: true,
        timeout: SESSION_VALIDATION_TIMEOUT
      });

      if (response.data && response.data.authenticated) {
        setUser(response.data.user);
        setError(null);
      } else {
        setUser(null);
      }
    } catch (error) {
      console.error('Session validation error:', error);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Enhanced login with CSRF token handling
  const login = useCallback(async (email: string, password: string) => {
    setLoading(true);
    setError(null);

    try {
      const response = await api.post('/session/login', {
        email: email.toLowerCase().trim(),
        password
      }, {
        withCredentials: true
      });

      // Backend returns user data + CSRF token
      if (response.data) {
        if (response.data.csrfToken) {
          setCsrfToken(response.data.csrfToken);
          // Store CSRF token in memory for subsequent requests
          sessionStorage.setItem('csrf_token', response.data.csrfToken);
        }

        if (response.data.user) {
          setUser(response.data.user);
        }

        // Validate session is actually set
        await checkSession();
      }
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || 'Login failed. Please try again.';
      setError(errorMessage);
      setUser(null);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [checkSession]);

  // Enhanced logout with proper cleanup
  const logout = useCallback(async () => {
    setLoading(true);

    try {
      // Get CSRF token for logout request
      const token = csrfToken || sessionStorage.getItem('csrf_token');
      const headers: any = { withCredentials: true };

      if (token) {
        headers['X-CSRF-Token'] = token;
      }

      // Call backend logout endpoint
      await api.post('/session/logout', {}, headers);
    } catch (error) {
      console.error('Logout error:', error);
      // Continue with local cleanup even if server logout fails
    } finally {
      // Always perform local cleanup
      setUser(null);
      setCsrfToken(null);
      sessionStorage.removeItem('csrf_token');

      // Clear any stored auth data
      sessionStorage.clear();

      // Broadcast logout to other tabs
      localStorage.setItem('auth_logout_signal', Date.now().toString());
      localStorage.removeItem('auth_logout_signal');

      // Stop polling before redirecting
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }

      setLoading(false);

      // Redirect to login page
      window.location.href = '/loginIn.html';
    }
  }, [csrfToken]);

  // Clear error message
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Set up session polling
  useEffect(() => {
    checkSession();

    // Poll session every 5 minutes to catch externally-invalidated sessions
    pollIntervalRef.current = setInterval(() => {
      checkSession();
    }, SESSION_POLL_INTERVAL);

    // Listen for storage events from other tabs (logout sync)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'auth_logout_signal') {
        // Another tab logged out, clear local state
        setUser(null);
        setCsrfToken(null);
        window.location.href = '/loginIn.html';
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      if (checkSessionTimeoutRef.current) {
        clearTimeout(checkSessionTimeoutRef.current);
      }
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [checkSession]);

  // Add CSRF token to all API requests
  useEffect(() => {
    const interceptor = api.interceptors.request.use((config) => {
      const token = csrfToken || sessionStorage.getItem('csrf_token');
      if (token) {
        config.headers['X-CSRF-Token'] = token;
      }
      return config;
    });

    // Handle 401/403 responses (session expired, CSRF token invalid)
    const errorInterceptor = api.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401 || error.response?.status === 403) {
          // Session is invalid, clear local state
          setUser(null);
          setCsrfToken(null);
          sessionStorage.removeItem('csrf_token');
          window.location.href = '/loginIn.html';
        }
        return Promise.reject(error);
      }
    );

    return () => {
      api.interceptors.request.eject(interceptor);
      api.interceptors.response.eject(errorInterceptor);
    };
  }, [csrfToken]);

  const value = {
    user,
    loading,
    error,
    csrfToken,
    login,
    logout,
    checkSession,
    clearError
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};