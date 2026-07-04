import { useEffect } from 'react';

// Thin redirect component: sends unauthenticated users to the HTML login page.
// When a proper React login page is built in Phase 2, swap the href here — one place.
export default function LoginRedirect() {
  useEffect(() => {
    window.location.href = '/auth/loginIn.html';
  }, []);

  return null;
}