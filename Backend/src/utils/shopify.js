const crypto = require("crypto");

function getShopifyApiVersion() {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = Math.floor(now.getUTCMonth() / 3) * 3 + 1;
  const latestVersion = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
  const version = String(process.env.SHOPIFY_API_VERSION || latestVersion).trim();
  const match = /^(\d{4})-(01|04|07|10)$/.exec(version);
  if (!match) {
    const error = new Error('Shopify API version must use a supported YYYY-MM quarter.');
    error.code = 'SHOPIFY_API_VERSION_INVALID';
    error.configuredApiVersion = version;
    throw error;
  }

  const [year, month] = [Number(match[1]), Number(match[2])];
  const versionQuarter = year * 4 + (month - 1) / 3;
  const currentQuarter = currentYear * 4 + Math.floor(now.getUTCMonth() / 3);
  if (versionQuarter < currentQuarter - 3 || versionQuarter > currentQuarter) {
    const error = new Error('Configured Shopify API version is outside the currently supported window.');
    error.code = 'SHOPIFY_API_VERSION_UNSUPPORTED';
    error.configuredApiVersion = version;
    throw error;
  }

  return version;
}

function getShopifyOAuthConfig() {
  const missingConfig = [
    'SHOPIFY_API_KEY',
    'SHOPIFY_API_SECRET',
    'SHOPIFY_REDIRECT_URI',
    'BACKEND_URL',
    'FRONTEND_URL',
  ]
    .filter((name) => !String(process.env[name] || '').trim());
  if (missingConfig.length) {
    const error = new Error('Shopify OAuth configuration is incomplete.');
    error.code = 'SHOPIFY_OAUTH_CONFIG_MISSING';
    error.missingConfig = missingConfig;
    throw error;
  }

  let redirectUri;
  let backendUrl;
  let frontendUrl;
  try {
    redirectUri = new URL(process.env.SHOPIFY_REDIRECT_URI);
    backendUrl = new URL(process.env.BACKEND_URL);
    frontendUrl = new URL(process.env.FRONTEND_URL);
  } catch {
    const error = new Error('Shopify, backend, or frontend URL configuration is invalid.');
    error.code = 'SHOPIFY_URL_CONFIG_INVALID';
    throw error;
  }

  const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(redirectUri.hostname);
  if (
    !['https:', ...(localHost ? ['http:'] : [])].includes(redirectUri.protocol) ||
    !['/api/v1/shopify/callback', '/api/v1/shopify/callback/'].includes(redirectUri.pathname) ||
    redirectUri.username ||
    redirectUri.password ||
    redirectUri.search ||
    redirectUri.hash
  ) {
    const error = new Error('Shopify redirect URI must point to the Shopify callback endpoint.');
    error.code = 'SHOPIFY_REDIRECT_URI_INVALID';
    throw error;
  }
  if (
    backendUrl.protocol !== 'https:' ||
    backendUrl.pathname !== '/' ||
    backendUrl.search ||
    backendUrl.hash ||
    backendUrl.username ||
    backendUrl.password
  ) {
    const error = new Error('BACKEND_URL must be an HTTPS origin for Shopify webhooks.');
    error.code = 'SHOPIFY_BACKEND_URL_INVALID';
    throw error;
  }
  if (!['https:', 'http:'].includes(frontendUrl.protocol) || frontendUrl.username || frontendUrl.password) {
    const error = new Error('FRONTEND_URL must be an HTTP or HTTPS URL.');
    error.code = 'SHOPIFY_FRONTEND_URL_INVALID';
    throw error;
  }

  return {
    apiKey: process.env.SHOPIFY_API_KEY,
    redirectUri: redirectUri.toString(),
    apiVersion: getShopifyApiVersion(),
    backendHost: backendUrl.host,
    frontendUrl: frontendUrl.toString(),
  };
}

function encodeState(userId) {
  const payload = Buffer.from(JSON.stringify({ userId })).toString('base64url');
  return payload;
}

function decodeState(state) {
  try {
    if (!state) return null;
    const payload = state.includes('.') ? state.split('.').slice(1).join('.') : state;
    const decoded = Buffer.from(payload, 'base64url').toString('utf8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function getStateContext(state, signedCookies = {}, cookies = {}) {
  const decodedState = decodeState(state);
  const storedState = signedCookies?.shopify_state ?? cookies?.shopify_state;
  const userId = signedCookies?.shopify_user ?? cookies?.shopify_user ?? signedCookies?.oauth_user ?? cookies?.oauth_user;

  return {
    decodedState,
    storedState,
    userId,
  };
}

function isStateAccepted(storedState, incomingState) {
  return Boolean(storedState && incomingState && storedState === incomingState);
}

/*** Validate Shopify shop domain Example: mystore.myshopify.com*/
const isValidShopDomain = (shop) => {
  if (!shop) return false;
  const regex = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;
  return regex.test(shop);
};

/** Generate secure OAuth state*/
const generateState = (userId) => {
  const randomPart = crypto.randomBytes(16).toString("hex");
  if (!userId) return randomPart;
  return `${randomPart}.${encodeState(userId)}`;
};

/**Build Shopify OAuth URL*/
const buildInstallUrl = ({ shop, state }) => {
  const { apiKey, redirectUri } = getShopifyOAuthConfig();
  const configuredScopes = String(process.env.SHOPIFY_SCOPES || '')
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean);
  const scope = [...new Set([
    ...configuredScopes,
    'read_orders',
    'read_customers',
    'write_discounts',
  ])].join(',');
  const params = new URLSearchParams({
    client_id: apiKey,
    scope,
    redirect_uri: redirectUri,
    state,
  });

  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
};

/* Verify Shopify HMAC */
const verifyHmac = (query) => {
  // Make sure the Shopify API secret exists
  if (!process.env.SHOPIFY_API_SECRET) {
    throw new Error(
      "SHOPIFY_API_SECRET environment variable is missing."
    );
  }

  const { hmac, signature, ...params } = query;
  if (typeof hmac !== 'string' || !Object.values(params).every((value) => typeof value === 'string')) {
    return false;
  }

  const message = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");

  const generatedHmac = crypto
    .createHmac("sha256", process.env.SHOPIFY_API_SECRET)
    .update(message)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(generatedHmac),
      Buffer.from(hmac)
    );
  } catch {
    return false;
  }
};

module.exports = {
  isValidShopDomain,
  generateState,
  encodeState,
  decodeState,
  getStateContext,
  isStateAccepted,
  getShopifyApiVersion,
  getShopifyOAuthConfig,
  buildInstallUrl,
  verifyHmac,
};
