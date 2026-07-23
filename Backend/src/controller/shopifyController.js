const {isValidShopDomain,generateState,buildInstallUrl,verifyHmac,} = require("../utils/shopify");
const logger = require('../utils/logger');
const { buildCookieOptions } = require('../utils/cookieOptions');

const {exchangeAccessToken,getOrganizationByUser,upsertStore,syncShopifyStore,} = require("../services/shopifyService");

/**GET /api/v1/shopify/install, Redirect authenticated merchant to Shopify OAuth.*/

exports.installShopify = async (req, res, next) => {
  try {
    const { shop } = req.query;

    // Read user from the temporary OAuth cookie
    const userId = req.signedCookies.oauth_user;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    if (!shop) {
      return res.status(400).json({
        success: false,
        error: "Shop domain is required",
      });
    }

    if (!isValidShopDomain(shop)) {
      return res.status(400).json({
        success: false,
        error: "Invalid Shopify shop domain",
      });
    }

    const state = generateState();

    res.cookie("shopify_state", state, {
      signed: true,
      ...buildCookieOptions(req),
      maxAge: 10 * 60 * 1000,
    });

    res.cookie("shopify_user", userId, {
      signed: true,
      ...buildCookieOptions(req),
      maxAge: 10 * 60 * 1000,
    });
    
    const installUrl = buildInstallUrl({
      shop,
      state,
    });

    return res.redirect(installUrl);

  } catch (error) {
    next(error);
  }
};

exports.startShopify = async (req, res, next) => {
  try {
    res.cookie("oauth_user", req.user.id, {
      signed: true,
      ...buildCookieOptions(req),
      maxAge: 10 * 60 * 1000,
    });

    return res.status(200).json({
      success: true,
    });
  } catch (error) {
    next(error);
  }
};

/**GET /api/v1/shopify/callback, Handle Shopify OAuth callback.*/
exports.shopifyCallback = async (req, res, next) => {
  try {
    const {
      code,
      shop,
      state,
      hmac,
    } = req.query;

    // Validate required parameters
    if (!code || !shop || !state || !hmac) {
      return res.status(400).json({
        success: false,
        error: "Missing required Shopify callback parameters",
      });
    }

    // Validate shop domain
    if (!isValidShopDomain(shop)) {
      return res.status(400).json({
        success: false,
        error: "Invalid Shopify shop domain",
      });
    }

    // Verify Shopify HMAC
    if (!verifyHmac(req.query)) {
      return res.status(400).json({
        success: false,
        error: "Invalid Shopify HMAC",
      });
    }

     // DEBUG LOGS
    logger.debug('shopify_callback', {
      hasCookies: !!req.headers.cookie,
      signedCookies: Object.keys(req.signedCookies || {}),
      queryKeys: Object.keys(req.query || {}),
    });

    console.log("storedState:", req.signedCookies.shopify_state);
    console.log("userId:", req.signedCookies.shopify_user);

    // Read signed cookies
    const storedState = req.signedCookies.shopify_state;
    const userId = req.signedCookies.shopify_user;

    if (!storedState || !userId) {
      return res.status(400).json({
        success: false,
        error: "OAuth session expired",
      });
    }

    // Verify OAuth state
    if (storedState !== state) {
      return res.status(400).json({
        success: false,
        error: "Invalid OAuth state",
      });
    }

    // Exchange authorization code for access token
    const accessToken = await exchangeAccessToken(shop, code);

    // Retrieve merchant organization
    const organization = await getOrganizationByUser(userId);

    if (!organization) {
      return res.status(404).json({
        success: false,
        error: "Organization not found",
      });
    }

    // Create or update connected store
    const store = await upsertStore({
      organizationId: organization.id,
      shop,
      accessToken,
    });

    // Trigger background sync (do not await)
    syncShopifyStore(store).catch((error) => {
      logger.error('shopify_sync_failed', { storeId: store?.id, message: error?.message });
    });

    // Clear OAuth cookies
    res.clearCookie("shopify_state", {
      ...buildCookieOptions(req),
      path: "/",
    });

    res.clearCookie("shopify_user", {
      ...buildCookieOptions(req),
      path: "/",
    });

    res.clearCookie("oauth_user", {
     ...buildCookieOptions(req),
      path: "/",
     });

    // Redirect merchant back to frontend
    return res.redirect(
      `${process.env.FRONTEND_URL}/dashboard/integrations?connected=shopify`
    );
  } catch (error) {
    next(error);
  }
};