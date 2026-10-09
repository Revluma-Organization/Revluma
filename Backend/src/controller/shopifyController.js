const crypto = require('crypto');
const {
  isValidShopDomain,
  generateState,
  buildInstallUrl,
  verifyHmac,
  getStateContext,
  isStateAccepted,
  getShopifyOAuthConfig,
} = require('../utils/shopify');
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
  const requestId = crypto.randomUUID();
  let stage = 'oauth_configuration';
  const logStage = (outcome, details = {}) => {
    logger.info('shopify_callback_stage', {
      request_id: requestId,
      stage,
      outcome,
      ...details,
    });
  };

  try {
    logStage('started');
    const { redirectUri, apiVersion, backendHost, frontendUrl: configuredFrontendUrl } = getShopifyOAuthConfig();
    logStage('completed', {
      redirect_host: new URL(redirectUri).host,
      redirect_path: new URL(redirectUri).pathname,
      backend_host: backendHost,
      frontend_host: new URL(configuredFrontendUrl).host,
      api_version: apiVersion,
    });

    const {
      code,
      shop,
      state,
      hmac,
    } = req.query;

    // Validate required parameters
    stage = 'callback_parameters';
    logStage('started', { query_keys: Object.keys(req.query || {}) });
    if (!code || !shop || !state || !hmac) {
      logStage('failed', { reason: 'required_parameter_missing' });
      return res.status(400).json({
        success: false,
        error: 'Missing required Shopify callback parameters',
        stage,
        reference: requestId,
      });
    }
    logStage('completed');

    // Validate shop domain
    stage = 'shop_domain_validation';
    logStage('started');
    if (!isValidShopDomain(shop)) {
      logStage('failed', { reason: 'invalid_shop_domain' });
      return res.status(400).json({
        success: false,
        error: "Invalid Shopify shop domain",
        stage,
        reference: requestId,
      });
    }
    logStage('completed', { shop_domain: shop });

    // Verify Shopify HMAC
    stage = 'hmac_validation';
    logStage('started', { api_secret_configured: Boolean(process.env.SHOPIFY_API_SECRET) });
    if (!verifyHmac(req.query)) {
      logStage('failed', { reason: 'hmac_mismatch' });
      return res.status(400).json({
        success: false,
        error: "Invalid Shopify HMAC",
        stage,
        reference: requestId,
      });
    }
    logStage('completed');

    stage = 'oauth_state_validation';
    logStage('started');
    const stateContext = getStateContext(state, req.signedCookies, req.cookies);
    const { storedState, userId } = stateContext;

    if (!storedState) {
      logStage('failed', { reason: 'stored_state_missing' });
      return res.status(400).json({
        success: false,
        error: "OAuth session expired",
        stage,
        reference: requestId,
      });
    }

    if (!userId) {
      logStage('failed', { reason: 'user_cookie_missing' });
      return res.status(400).json({
        success: false,
        error: "OAuth session expired",
        stage,
        reference: requestId,
      });
    }

    // Verify OAuth state
    if (!isStateAccepted(storedState, state)) {
      logStage('failed', { reason: 'state_mismatch' });
      return res.status(400).json({
        success: false,
        error: "Invalid OAuth state",
        stage,
        reference: requestId,
      });
    }
    logStage('completed', { user_id_present: true });

    // Exchange authorization code for access token
    stage = 'access_token_exchange';
    logStage('started', { shop_domain: shop });
    const accessToken = await exchangeAccessToken(shop, code);
    logStage('completed', { access_token_received: Boolean(accessToken) });

    // Retrieve merchant organization
    stage = 'organization_lookup';
    logStage('started');
    const organization = await getOrganizationByUser(userId);

    if (!organization) {
      logStage('failed', { reason: 'organization_not_found' });
      return res.status(404).json({
        success: false,
        error: "Organization not found",
        stage,
        reference: requestId,
      });
    }
    logStage('completed', { organization_found: true });

    // Create or update connected store
    stage = 'store_persistence';
    logStage('started', { shop_domain: shop });
    const store = await upsertStore({
      organizationId: organization.id,
      shop,
      accessToken,
    });
    logStage('completed', { store_id: store.id });

    stage = 'webhook_registration';
    logStage('started', { store_id: store.id });
    await reconcileShopifyWebhooks(store);
    logStage('completed', { store_id: store.id });

    // Trigger background sync (do not await)
    syncShopifyStore(store).catch((error) => {
      logger.error('shopify_sync_failed', {
        store_id: store?.id,
        error_type: error?.code || error?.name || 'sync_error',
      });
    });

    // Clear OAuth cookies
    stage = 'oauth_cookie_cleanup';
    logStage('started');
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
    logStage('completed');

    // Redirect merchant back to frontend
    stage = 'frontend_redirect';
    logStage('started', { frontend_url_configured: Boolean(process.env.FRONTEND_URL) });
    const frontendUrl = new URL('/dashboard/integrations?connected=shopify', configuredFrontendUrl);
    if (!['http:', 'https:'].includes(frontendUrl.protocol)) {
      const error = new Error('Frontend URL must use HTTP or HTTPS.');
      error.code = 'SHOPIFY_FRONTEND_URL_INVALID';
      throw error;
    }
    logStage('completed', { redirect_host: frontendUrl.host });
    return res.redirect(frontendUrl.toString());
  } catch (error) {
    const errorType = error.code || error.name || 'shopify_callback_error';
    logStage('failed', { error_type: errorType });
    logger.error('shopify_callback_failed', {
      request_id: requestId,
      stage,
      shop_domain: typeof req.query?.shop === 'string' ? req.query.shop : null,
      error_type: errorType,
      prisma_code: typeof error.code === 'string' && error.code.startsWith('P') ? error.code : null,
      prisma_model: typeof error.meta?.modelName === 'string' ? error.meta.modelName : undefined,
      prisma_table: typeof error.meta?.table === 'string' ? error.meta.table : undefined,
      prisma_field: typeof error.meta?.field_name === 'string' ? error.meta.field_name : undefined,
      prisma_target: Array.isArray(error.meta?.target) || typeof error.meta?.target === 'string'
        ? error.meta.target
        : undefined,
      provider_status: error.providerStatus || error.response?.status || null,
      missing_config: error.missingConfig || undefined,
      configured_api_version: error.configuredApiVersion || undefined,
    });
    return res.status(error.statusCode || 500).json({
      success: false,
      error: `Shopify installation failed during ${stage}`,
      stage,
      reference: requestId,
    });
  }
};
