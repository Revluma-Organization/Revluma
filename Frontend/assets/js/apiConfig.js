/**
 * Revluma API Runtime Configuration
 *
 * BUG FIX: The previous version set window.APP_API_BASE to the absolute
 * https://revluma.onrender.com/api URL when running on Vercel. This caused:
 *
 *   1. Dashboard React app (Axios): bypassed the Vercel /api proxy, sending
 *      cross-origin requests directly to Render — these fail on Render cold
 *      starts, leaving the dashboard with a blank screen.
 *
 *   2. Login/auth HTML pages (fetch): same cross-origin issue, manifesting as
 *      "CSRF token fetch failed" and login errors.
 *
 * FIX: On Vercel and custom domains, use the same-origin origin + /api.
 * Vercel's vercel.json rewrites /api/* → https://revluma.onrender.com/api/*,
 * so the proxy handles the backend routing transparently.
 *
 * On the Render host itself (backend serves frontend), use the absolute URL
 * since there is no proxy layer.
 */
(function () {
  function sanitizeUrl(url) {
    return typeof url === 'string' ? url.replace(/\/$/, '') : url;
  }

  const prodBackendUrl = 'https://revluma.onrender.com/api';
  const hostname = (window.location.hostname || '').toLowerCase();
  const origin   = window.location.origin ? window.location.origin.replace(/\/+$/, '') : '';

  const isRenderHost   = hostname === 'revluma.onrender.com' || hostname.endsWith('.revluma.onrender.com');
  const isFileProtocol = window.location.protocol === 'file:';

  // Explicit override from the environment (e.g. set by Vercel env vars via a build step)
  const envOverride = window._REVLUMA_API_BASE_OVERRIDE
    ? sanitizeUrl(String(window._REVLUMA_API_BASE_OVERRIDE).trim())
    : null;

  let apiBase;

  if (envOverride) {
    // Explicit override wins
    apiBase = envOverride;
  } else if (isFileProtocol || !origin) {
    // Local file:// protocol — hit local dev server
    apiBase = 'http://localhost:5000/api';
  } else if (isRenderHost) {
    // Running on the Render backend host — use absolute URL directly
    apiBase = prodBackendUrl;
  } else {
    // Vercel, custom domain, or local dev server:
    // Use same-origin /api — the Vercel proxy (vercel.json rewrites) routes it to Render.
    // This avoids cross-origin requests and keeps session cookies working correctly.
    apiBase = `${origin}/api`;
  }

  window.APP_API_BASE = apiBase;
  window.REVLUMA_CONFIG = window.REVLUMA_CONFIG || {};
  window.REVLUMA_CONFIG.apiBase = apiBase;
  window.REVLUMA_CONFIG.mode = envOverride ? 'override' : (isRenderHost ? 'render-direct' : 'proxy');

  const mode = window.REVLUMA_CONFIG.mode;
  console.info('Revluma API runtime config:', {
    host: hostname,
    protocol: window.location.protocol,
    appApiBase: apiBase,
    mode,
    prodBackendUrl
  });

  if (mode === 'override') {
    console.info('Revluma API base overridden:', apiBase);
  } else if (mode === 'render-direct') {
    console.info('Revluma API base (Render direct):', apiBase);
  } else {
    console.info('Revluma API base (same-origin proxy):', apiBase);
  }
})();