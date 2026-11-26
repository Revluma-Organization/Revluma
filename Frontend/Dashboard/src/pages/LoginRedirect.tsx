import { useEffect } from 'react';
import { FORGOT_PASSWORD_PATH, LOGIN_PATH } from '@/lib/auth/constants';

/**
 * Thin redirect: sends users to the HTML login page.
 * Single source of truth for the path: LOGIN_PATH.
 */
export default function LoginRedirect() {
  useEffect(() => {
    window.location.replace(LOGIN_PATH);
  }, []);

  return null;
}

/** Password reset lives on the HTML auth pages too. */
export function ForgotPasswordRedirect() {
  useEffect(() => {
    window.location.replace(FORGOT_PASSWORD_PATH);
  }, []);

  return null;
}
