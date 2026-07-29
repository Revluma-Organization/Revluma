const crypto = require("crypto");

function encodeState(userId) {
  const payload = Buffer.from(JSON.stringify({ userId })).toString('base64url');
  return payload;
}

function decodeState(state) {
  try {
    const payload = state.includes('.') ? state.split('.').slice(1).join('.') : state;
    const decoded = Buffer.from(payload, 'base64url').toString('utf8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
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
  const params = new URLSearchParams({
    client_id: process.env.SHOPIFY_API_KEY,
    scope: process.env.SHOPIFY_SCOPES,
    redirect_uri: process.env.SHOPIFY_REDIRECT_URI,
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
  buildInstallUrl,
  verifyHmac,
};