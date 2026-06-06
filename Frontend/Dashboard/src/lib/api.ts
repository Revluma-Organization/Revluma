import axios from 'axios';

/**
 * Dashboard API client
 *
 * BUG FIX (blank screen): The previous version always used the absolute
 * https://revluma.onrender.com/api URL when running on Vercel. This caused
 * two problems:
 *
 *   1. Cross-origin requests bypass the Vercel /api proxy rewrite, which means
 *      CORS pre-flight must succeed directly with the Render backend. When Render
 *      is cold-starting or the network path is slow, these fail silently, leaving
 *      loading=true forever → blank screen.
 *
 *   2. HTTP-only SameSite=None cookies set by Render are correctly forwarded when
 *      the browser goes through the same-origin Vercel proxy, but can be dropped
 *      or rejected in strict browser privacy modes when sent cross-origin.
 *
 * FIX: On Vercel hosts, use the relative origin (/api) so requests go through
 * the Vercel rewrites (vercel.json: /api/:path* → https://revluma.onrender.com/api/:path*).
 * This keeps everything same-origin from the browser's perspective.
 *
 * On the Render host itself (backend + frontend served together), use the absolute
 * Render URL as before.
 *
 * For local development, fall back to same-origin /api.
 */
function resolveApiBase(): string {
  // Never trust window.APP_API_BASE for the Dashboard — it's set by apiConfig.js
  // which uses the absolute Render URL for all production hosts, defeating the proxy.
  // We compute the correct base ourselves here.

  if (typeof window === 'undefined') return '/api';
  if (window.location.protocol === 'file:') return 'http://localhost:5000/api';

  const hostname = window.location.hostname.toLowerCase();
  const origin   = window.location.origin.replace(/\/+$/, '');

  const isRenderHost  = hostname === 'revluma.onrender.com' || hostname.endsWith('.revluma.onrender.com');
  const isVercelHost  = hostname.endsWith('.vercel.app') || hostname.endsWith('.vercel.sh');
  const isCustomDomain = hostname === 'revluma.com' || hostname.endsWith('.revluma.com') || hostname.endsWith('.revluma.app');

  // On Render (backend host): use absolute URL — no proxy needed
  if (isRenderHost) {
    return 'https://revluma.onrender.com/api';
  }

  // On Vercel or custom domain: use relative /api — goes through vercel.json proxy rewrite.
  // This keeps the request same-origin, avoiding CORS, and ensures cookies are sent correctly.
  if (isVercelHost || isCustomDomain) {
    return `${origin}/api`;
  }

  // Local dev fallback
  return `${origin}/api`;
}

const API_BASE = resolveApiBase();

const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true, // Always send cookies with requests
  timeout: 30000,
});

export { API_BASE };
export default api;