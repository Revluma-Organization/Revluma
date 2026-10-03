const {isValidShopDomain,generateState,buildInstallUrl,verifyHmac,getStateContext,isStateAccepted,} = require("../utils/shopify");
const logger = require('../utils/logger');
const { buildCookieOptions } = require('../utils/cookieOptions');

const {exchangeAccessToken,getOrganizationByUser,upsertStore,syncShopifyStore,} = require("../services/shopifyService");
const { reconcileShopifyWebhooks } = require('../services/shopifyWebhookService');

/**GET /api/v1/shopify/install, Redirect authenticated merchant to Shopify OAuth.*/

exports.installShopify = async (req, res, next) => {
  try {
    const { shop } = req.query;
    logger.info("install_request", {
      hasUser: Boolean(req.user?.id),
    });

    // Prefer the authenticated user from JWT, fall back to the legacy OAuth cookie.
    const userId = req.user?.id || req.signedCookies?.oauth_user || req.signedCookies?.shopify_user;

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

    const state = generateState(userId);
    const cookieOptions = {
      ...buildCookieOptions(req),
      maxAge: 10 * 60 * 1000,
      signed: true,
    };

    res.cookie("oauth_user", userId, cookieOptions);

    res.cookie("shopify_state", state, cookieOptions);

    res.cookie("shopify_user", userId, cookieOptions);
    
    const installUrl = buildInstallUrl({
      shop,
      state,
    });

    return res.status(200).json({
      success: true,
      redirectUrl: installUrl,
    });

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

    logger.debug('shopify_callback', {
      queryKeys: Object.keys(req.query || {}),
    });

    const stateContext = getStateContext(state, req.signedCookies, req.cookies);
    const { storedState, userId } = stateContext;

    if (!storedState) {
      return res.status(400).json({
        success: false,
        error: "OAuth session expired",
      });
    }

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "OAuth session expired",
      });
    }

    // Verify OAuth state
    if (!isStateAccepted(storedState, state)) {
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

    await reconcileShopifyWebhooks(store);

    // Trigger background sync (do not await)
    syncShopifyStore(store).catch((error) => {
      logger.error('shopify_sync_failed', {
        store_id: store?.id,
        error_type: error?.code || error?.name || 'sync_error',
      });
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
