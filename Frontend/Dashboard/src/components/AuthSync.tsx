import { useEffect } from 'react';
import {
  clearAuthStorage,
  getAccessToken,
  onAuthBroadcast,
  redirectToLogin,
} from '@/lib/auth/session';
import { LOGIN_PATH } from '@/lib/auth/constants';
import { queryClient } from '@/lib/queryClient';
import { useAuthStore } from '@/store/authStore';

/**
 * Keeps authentication synchronized across browser tabs.
 * When one tab logs out, every other tab clears state and redirects to login.
 * Does not re-broadcast (avoids feedback loops).
 * Also blocks bfcache restoration of protected pages after logout.
 */
export function AuthSync() {
  const resetLocalAuthState = useAuthStore((s) => s.resetLocalAuthState);

  useEffect(() => {
    return onAuthBroadcast((message) => {
      if (message.type !== 'logout') return;
      resetLocalAuthState();
      clearAuthStorage();
      try {
        queryClient.clear();
      } catch {
        // ignore
      }
      redirectToLogin(true);
    });
  }, [resetLocalAuthState]);

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      if (!getAccessToken()) {
        resetLocalAuthState();
        window.location.replace(LOGIN_PATH);
      }
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [resetLocalAuthState]);

  return null;
}
