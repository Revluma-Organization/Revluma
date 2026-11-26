/**
 * Sign in with Apple: identity-token verification.
 *
 * The browser (Apple JS, popup mode) returns a signed JWT ("id_token"). We
 * accept it only when:
 *   - it is signed (RS256) by a current Apple key from APPLE_JWKS_URL,
 *   - iss is https://appleid.apple.com,
 *   - aud is our Services ID (APPLE_CLIENT_ID; comma-separated to allow a
 *     native bundle id alongside the web Services ID),
 *   - it has not expired (60s clock tolerance) and was not issued in the future,
 *   - its nonce equals SHA-256(raw nonce) that this browser session generated,
 *     which binds the token to the session and stops replay of a leaked token,
 *   - it carries a subject, and any email is marked verified by Apple.
 *
 * Apple's keys are cached for an hour and refetched once when a token names
 * an unknown key id, so key rotation needs no deploy.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const APPLE_ISSUER = 'https://appleid.apple.com';
const DEFAULT_JWKS_URL = 'https://appleid.apple.com/auth/keys';
const JWKS_TTL_MS = 60 * 60 * 1000;
const JWKS_MIN_REFRESH_MS = 60 * 1000;

let cache = { keys: new Map(), fetchedAt: 0 };
let inflight = null;

function clientIds() {
  return String(process.env.APPLE_CLIENT_ID || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function isAppleConfigured() {
  return clientIds().length > 0;
}

function httpError(statusCode, message, code) {
  return Object.assign(new Error(message), { statusCode, ...(code ? { code } : {}) });
}

async function fetchJwks() {
  const url = process.env.APPLE_JWKS_URL || DEFAULT_JWKS_URL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`Apple keys request failed with ${response.status}`);
    const body = await response.json();
    const keys = new Map();
    for (const jwk of Array.isArray(body?.keys) ? body.keys : []) {
      if (jwk?.kty !== 'RSA' || !jwk.kid || (jwk.use && jwk.use !== 'sig')) continue;
      keys.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' }));
    }
    if (!keys.size) throw new Error('Apple returned no usable signing keys');
    cache = { keys, fetchedAt: Date.now() };
    return keys;
  } finally {
    clearTimeout(timer);
  }
}

async function loadKeys(force = false) {
  const age = Date.now() - cache.fetchedAt;
  if (cache.keys.size && !force && age < JWKS_TTL_MS) return cache.keys;
  // Unknown kid: refresh, but never more than once a minute.
  if (cache.keys.size && force && age < JWKS_MIN_REFRESH_MS) return cache.keys;
  if (!inflight) inflight = fetchJwks().finally(() => { inflight = null; });
  return inflight;
}

async function signingKey(kid) {
  let keys = await loadKeys();
  if (!keys.has(kid)) keys = await loadKeys(true);
  const key = keys.get(kid);
  if (!key) throw httpError(401, 'Invalid Apple credential.');
  return key;
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * @param {string} idToken  Apple identity token from the browser.
 * @param {string} rawNonce The unhashed nonce generated for this sign-in.
 * @returns {Promise<{sub: string, email: string|null, isPrivateEmail: boolean}>}
 */
async function verifyAppleIdentityToken(idToken, rawNonce) {
  if (!isAppleConfigured()) throw httpError(503, 'Sign in with Apple is not available right now.', 'APPLE_NOT_CONFIGURED');
  if (typeof idToken !== 'string' || idToken.length < 20 || idToken.length > 8192) {
    throw httpError(400, 'Apple credential is required.');
  }
  if (typeof rawNonce !== 'string' || rawNonce.length < 16 || rawNonce.length > 256) {
    throw httpError(400, 'Apple sign-in nonce is required.');
  }

  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded?.header?.kid || decoded.header.alg !== 'RS256') throw httpError(401, 'Invalid Apple credential.');

  const key = await signingKey(decoded.header.kid);
  let payload;
  try {
    payload = jwt.verify(idToken, key, {
      algorithms: ['RS256'],
      issuer: APPLE_ISSUER,
      audience: clientIds(),
      clockTolerance: 60,
    });
  } catch (error) {
    throw httpError(401, error?.name === 'TokenExpiredError' ? 'Apple sign-in expired. Please try again.' : 'Invalid Apple credential.');
  }

  if (typeof payload.iat === 'number' && payload.iat > Math.floor(Date.now() / 1000) + 60) {
    throw httpError(401, 'Invalid Apple credential.');
  }
  if (typeof payload.nonce !== 'string' || !timingSafeEqualString(payload.nonce, sha256Hex(rawNonce))) {
    throw httpError(401, 'Apple sign-in could not be confirmed. Please try again.');
  }
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 255) {
    throw httpError(401, 'Invalid Apple credential.');
  }

  // Apple sends booleans as booleans or as the strings "true"/"false".
  const truthy = (value) => value === true || value === 'true';
  let email = null;
  if (typeof payload.email === 'string' && payload.email.trim()) {
    if (!truthy(payload.email_verified)) throw httpError(401, 'Apple account email is not verified.');
    email = payload.email.trim().toLowerCase();
  }

  return { sub: payload.sub, email, isPrivateEmail: truthy(payload.is_private_email) };
}

// Apple sends the name once, from the browser, on the first authorisation
// only. It is unsigned, so it is used purely as a display name.
function appleDisplayName(user) {
  const name = user && typeof user === 'object' ? user.name : null;
  const clean = (value) => (typeof value === 'string' ? value.replace(/[<>\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) : '');
  const first = clean(name?.firstName);
  const last = clean(name?.lastName);
  return { firstName: first, fullName: [first, last].filter(Boolean).join(' ') };
}

// What the browser needs for Apple JS. The Services ID is public by design.
// The return URL must be registered on the Services ID in Apple Developer.
function appleWebConfig() {
  const clientId = clientIds()[0] || null;
  if (!clientId) return { enabled: false };
  const frontend = String(process.env.FRONTEND_URL || 'https://revluma.vercel.app').split(',')[0].trim().replace(/\/+$/, '');
  return {
    enabled: true,
    client_id: clientId,
    redirect_uri: process.env.APPLE_REDIRECT_URI || `${frontend}/auth/login`,
    scope: 'name email',
  };
}

function resetAppleKeyCache() {
  cache = { keys: new Map(), fetchedAt: 0 };
  inflight = null;
}

module.exports = {
  APPLE_ISSUER,
  isAppleConfigured,
  verifyAppleIdentityToken,
  appleDisplayName,
  appleWebConfig,
  sha256Hex,
  resetAppleKeyCache,
};
