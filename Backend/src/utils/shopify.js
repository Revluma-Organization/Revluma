const crypto = require("crypto");

/*** Validate Shopify shop domain Example: mystore.myshopify.com*/
const isValidShopDomain = (shop) => {
  if (!shop) return false;
  const regex = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;
  return regex.test(shop);
};

/** Generate secure OAuth state*/
const generateState = () => {
  return crypto.randomBytes(32).toString("hex");
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
  buildInstallUrl,
  verifyHmac,
};