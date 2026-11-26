/**
 * Same-origin proxy for the Founding Merchants application (/waitlist).
 *
 * The page calls /api/waitlist/application/<action> on the site itself
 * (vercel.json rewrites those paths here with ?path=<action>). This function
 * forwards the request to the backend and relays its answer, so the HttpOnly
 * resume cookie the backend sets is a first-party cookie for the site. Only
 * the application's own cookie is forwarded or relayed; nothing is logged.
 */
const BACKEND_BASE_URL = (process.env.BACKEND_API_URL || 'https://revluma-backend-lqve.onrender.com').replace(/\/+$/, '');
const COOKIE_NAME = 'rv_wl_session';
const TIMEOUT_MS = 15000;

// action -> allowed methods. Anything else is a 404 / 405 here.
const ROUTES = {
  start: ['POST'],
  'steps/1': ['PUT'],
  'steps/2': ['PUT'],
  'steps/3': ['PUT'],
  resume: ['GET'],
  status: ['GET'],
  submit: ['POST'],
  'resume/request-code': ['POST'],
  'resume/verify-code': ['POST'],
  session: ['DELETE'],
};

function actionOf(req) {
  let path = req.query?.path;
  if (path === undefined) {
    // Direct calls without the rewrite: /api/waitlist/application/<action>
    const url = String(req.url || '').split('?')[0];
    path = url.replace(/^\/api\/waitlist\/application\/?/, '');
  }
  if (Array.isArray(path)) path = path.join('/');
  return String(path || '').replace(/^\/+|\/+$/g, '');
}

function sessionCookie(header) {
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE_NAME) {
      const value = rest.join('=');
      return /^[A-Za-z0-9_-]{1,128}$/.test(value) ? `${COOKIE_NAME}=${value}` : null;
    }
  }
  return null;
}

function relayedCookies(headers) {
  const all = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [headers.get('set-cookie')].filter(Boolean);
  return all.filter((cookie) => cookie.startsWith(`${COOKIE_NAME}=`));
}

function parseBody(req) {
  if (req.body === undefined || req.body === null || req.body === '') return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  return req.body;
}

module.exports = async function waitlistApplication(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const action = actionOf(req);
  const methods = ROUTES[action];
  if (!methods) return res.status(404).json({ success: false, error: 'Not found.' });
  if (!methods.includes(req.method)) {
    res.setHeader('Allow', methods.join(', '));
    return res.status(405).json({ success: false, error: 'Method not allowed.' });
  }

  // Writes only from this site's own pages (the cookie is SameSite=Strict too).
  if (req.method !== 'GET') {
    const origin = req.headers?.origin;
    const host = req.headers?.['x-forwarded-host'] || req.headers?.host;
    if (origin && host) {
      let originHost = '';
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = '';
      }
      if (originHost !== host) return res.status(403).json({ success: false, error: 'This request must come from the Revluma site.' });
    }
  }

  const headers = { Accept: 'application/json' };
  let body;
  if (req.method === 'POST' || req.method === 'PUT') {
    const input = parseBody(req);
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return res.status(400).json({ success: false, error: 'Please check the form and try again.' });
    }
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(input);
  }
  const cookie = sessionCookie(req.headers?.cookie);
  if (cookie) headers.Cookie = cookie;
  const key = req.headers?.['idempotency-key'];
  if (typeof key === 'string' && /^[A-Za-z0-9-]{16,64}$/.test(key)) headers['Idempotency-Key'] = key;
  // Preserve the client address for the backend's per-IP limits (first hop only).
  const forwarded = req.headers?.['x-forwarded-for'];
  const clientAddress = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '';
  if (clientAddress && clientAddress.length <= 64) headers['X-Forwarded-For'] = clientAddress;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(`${BACKEND_BASE_URL}/api/v1/waitlist/application/${action}`, {
      method: req.method,
      headers,
      body,
      signal: controller.signal,
    });
    const cookies = relayedCookies(upstream.headers);
    if (cookies.length) res.setHeader('Set-Cookie', cookies);
    const retryAfter = upstream.headers.get('retry-after');
    if (retryAfter) res.setHeader('Retry-After', retryAfter);
    const text = await upstream.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      result = { success: false, error: 'The application service returned an unexpected response.' };
    }
    return res.status(upstream.status).json(result);
  } catch {
    return res.status(502).json({
      success: false,
      code: 'UPSTREAM_UNAVAILABLE',
      error: 'The application service is temporarily unavailable. Your saved answers are safe. Please try again.',
    });
  } finally {
    clearTimeout(timeout);
  }
};

module.exports.config = { api: { bodyParser: { sizeLimit: '32kb' } } };
module.exports.ROUTES = ROUTES;
