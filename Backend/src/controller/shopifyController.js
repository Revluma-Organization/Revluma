const {isValidShopDomain,generateState,buildInstallUrl,verifyHmac,} = require("../utils/shopify");
const logger = require('../utils/logger');

const {exchangeAccessToken,getOrganizationByUser,upsertStore,syncShopifyStore,} = require("../services/shopifyService");

/**GET /api/v1/shopify/install, Redirect authenticated merchant to Shopify OAuth.*/
exports.installShopify = async (req, res, next) => {
  try {
    const { shop } = req.query;

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

    // Store OAuth state
    res.cookie("shopify_state", state, {
    signed: true,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: 10 * 60 * 1000,
    });

    // Store authenticated user ID
    res.cookie("shopify_user", req.user.id, {
    signed: true,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: 10 * 60 * 1000,
    });

    const installUrl = buildInstallUrl({
      shop,
      state,
    });

    // Return the URL instead of redirecting
    return res.status(200).json({
      success: true,
      install_url: installUrl,
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
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      path: "/",
    });

    res.clearCookie("shopify_user", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
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