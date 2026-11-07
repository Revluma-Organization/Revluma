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
const { prisma } = require('../configs/database');
const { getRedisClient, isRedisReady } = require('../configs/redis');

/**GET /api/v1/shopify/install, Redirect authenticated merchant to Shopify OAuth.*/

exports.installShopify = async (req, res, next) => {
  try {
    const { shop } = req.query;
    logger.info("install_request", {
      hasUser: Boolean(req.user?.id),
    });

    const userId = req.user?.id;

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
    const normalizedShop = shop.toLowerCase();
    const reconnectAttemptId = crypto.randomUUID();
    const organization = await getOrganizationByUser(userId, req.user.tenantId);
    if (!organization) return res.status(403).json({ success: false, error: "Active organisation membership required." });

    const reconnectStoreId = req.query.store_id;
    let reconnectStore = null;
    if (req.query.mode === 'reconnect' || reconnectStoreId !== undefined) {
      if (typeof reconnectStoreId !== 'string' || !/^[0-9a-f-]{36}$/i.test(reconnectStoreId)) {
        return res.status(400).json({ success: false, error: 'A valid store_id is required to reconnect.' });
      }
      reconnectStore = await prisma.stores.findFirst({
        where: { id: reconnectStoreId, organization_id: organization.id, platform: 'shopify', shop_domain: normalizedShop, status: { not: 'deleted' } },
      });
      if (!reconnectStore) return res.status(403).json({ success: false, error: 'You cannot reconnect this Shopify store.' });
      if (!isRedisReady()) return res.status(503).json({ success: false, error: 'Reconnect is temporarily unavailable.' });
      const reconnectKey = `shopify:oauth:reconnect:${reconnectStore.id}`;
      const claimed = await getRedisClient().set(reconnectKey, reconnectAttemptId, 'EX', 600, 'NX');
      if (claimed !== 'OK') return res.status(409).json({ success: false, error: 'A reconnect session is already in progress.' });
      const { recordIntegrationEvent } = require('../services/integrationLifecycleStore');
      const transition = await recordIntegrationEvent({ storeId: reconnectStore.id, type: 'reconnect_started', source: 'merchant_oauth', eventReference: `reconnect:${userId}:${Date.now()}` });
      if (!transition.accepted) return res.status(409).json({ success: false, error: 'Reconnect state could not be started safely.' });
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
    res.cookie("shopify_organization", organization.id, cookieOptions);
    res.cookie("shopify_shop", normalizedShop, cookieOptions);
    if (reconnectStore) {
      res.cookie('shopify_reconnect_store', reconnectStore.id, cookieOptions);
      res.cookie('shopify_reconnect_attempt', reconnectAttemptId, cookieOptions);
    }
    
    const installUrl = buildInstallUrl({
      shop: normalizedShop,
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

exports.retryShopifySetup = async (req, res, next) => {
  try {
    const requestedStoreId = req.body?.store_id;
    if (requestedStoreId !== undefined &&
      (typeof requestedStoreId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedStoreId))) {
      return res.status(400).json({ success: false, error: 'Invalid Shopify store ID' });
    }

    const organization = await getOrganizationByUser(req.user.id, req.user.tenantId);
    if (!organization) {
      return res.status(404).json({ success: false, error: 'Organization not found' });
    }

    const store = await prisma.stores.findFirst({
      where: {
        ...(requestedStoreId ? { id: requestedStoreId } : {}),
        organization_id: organization.id,
        platform: 'shopify',
        access_token: { not: null },
        status: { notIn: ['inactive', 'deleted'] },
      },
      orderBy: { installed_at: 'desc' },
    });
    if (!store) {
      return res.status(404).json({ success: false, error: 'Connected Shopify store not found' });
    }
    if (store.status === 'syncing' && store.updated_at &&
      Date.now() - store.updated_at.getTime() < 15 * 60 * 1000) {
      return res.status(409).json({ success: false, error: 'Shopify setup is already in progress' });
    }

    logger.info('shopify_setup_retry_accepted', { store_id: store.id });
    syncShopifyStore(store).catch((error) => {
      logger.error('shopify_setup_retry_failed', {
        store_id: store.id,
        error_type: error.code || error.name || 'sync_error',
        http_status: error.status || error.response?.status || null,
        network_code: error.networkCode || error.code || null,
        shopify_errors: error.shopifyErrors || [],
      });
    });
    return res.status(202).json({
      success: true,
      data: { store_id: store.id, setup_status: 'in_progress' },
    });
  } catch (error) {
    next(error);
  }
};

exports.disconnectShopify = async (req, res, next) => {
  try {
    const storeId = req.body?.store_id;
    if (typeof storeId !== 'string' || !/^[0-9a-f-]{36}$/i.test(storeId)) {
      return res.status(400).json({ success: false, error: 'A valid store_id is required.' });
    }
    const organization = await getOrganizationByUser(req.user.id, req.user.tenantId);
    if (!organization) return res.status(403).json({ success: false, error: 'Active organisation membership required.' });
    const store = await prisma.stores.findFirst({ where: { id: storeId, organization_id: organization.id, platform: 'shopify' } });
    if (!store) return res.status(404).json({ success: false, error: 'Shopify store not found.' });
    const { recordIntegrationEvent } = require('../services/integrationLifecycleStore');
    const result = await recordIntegrationEvent({ storeId, type: 'merchant_disconnected', reasonCode: 'MERCHANT_DISCONNECTED', source: 'merchant_api', eventReference: `disconnect:${req.user.id}:${Date.now()}` });
    if (!result.accepted) return res.status(409).json({ success: false, error: 'The integration state changed; refresh before disconnecting.' });
    return res.status(200).json({ success: true, data: { store_id: storeId, connection_state: 'disconnected', reason_code: 'MERCHANT_DISCONNECTED' } });
  } catch (error) { next(error); }
};

/**GET /api/v1/shopify/callback, Handle Shopify OAuth callback.*/
exports.shopifyCallback = async (req, res, next) => {
  const requestId = crypto.randomUUID();
  let stage = 'oauth_configuration';
  let frontendOrigin = null;
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
    frontendOrigin = configuredFrontendUrl;
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
      error: authorizationError,
    } = req.query;

    if (authorizationError === 'access_denied') {
      const reconnectStoreId = req.signedCookies?.shopify_reconnect_store;
      if (reconnectStoreId) {
        const { recordIntegrationEvent } = require('../services/integrationLifecycleStore');
        await recordIntegrationEvent({ storeId: reconnectStoreId, type: 'reconnect_failed', reasonCode: 'OAUTH_CANCELLED', source: 'merchant_oauth' }).catch(() => null);
      }
      for (const name of ['shopify_state', 'shopify_user', 'shopify_shop', 'oauth_user', 'shopify_organization', 'shopify_reconnect_store', 'shopify_reconnect_attempt']) {
        res.clearCookie(name, { ...buildCookieOptions(req), path: '/' });
      }
      const frontendUrl = new URL('/dashboard/integrations?shopify=cancelled', configuredFrontendUrl);
      return res.redirect(frontendUrl.toString());
    }

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
    const normalizedShop = shop.toLowerCase();
    logStage('completed', { shop_domain: normalizedShop });

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
    const decodedUserId = stateContext.decodedState?.userId;

    if (!storedState) {
      logStage('failed', { reason: 'stored_state_missing' });
      return res.status(400).json({
        success: false,
        error: "OAuth session expired",
        stage,
        reference: requestId,
      });
    }

    if (!userId || !decodedUserId || decodedUserId !== userId) {
      logStage('failed', { reason: 'user_cookie_missing_or_state_account_mismatch' });
      return res.status(400).json({
        success: false,
        error: "OAuth session expired",
        stage,
        reference: requestId,
      });
    }

    // Bind this authorization attempt to the exact shop that initiated it.
    if (req.signedCookies?.shopify_shop !== normalizedShop) {
      logStage('failed', { reason: 'shop_mismatch' });
      return res.status(400).json({ success: false, error: 'Invalid OAuth shop', stage, reference: requestId });
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

    // Reject callbacks for accounts without an active organization before consuming the one-use code.
    stage = 'organization_lookup';
    const organization = await getOrganizationByUser(userId, req.signedCookies?.shopify_organization || undefined);
    if (!organization) {
      logStage('failed', { reason: 'organization_not_found' });
      return res.status(404).json({ success: false, error: 'Organization not found', stage, reference: requestId });
    }

    // Atomically consume OAuth state across backend instances. Fail closed if Redis is unavailable.
    stage = 'oauth_replay_guard';
    if (!isRedisReady()) {
      logStage('failed', { reason: 'replay_store_unavailable' });
      return res.status(503).json({ success: false, error: 'OAuth verification temporarily unavailable', stage, reference: requestId });
    }
    const stateDigest = crypto.createHash('sha256').update(state).digest('hex');
    const replayClaim = await getRedisClient().set('shopify:oauth:consumed:' + stateDigest, requestId, 'EX', 900, 'NX');
    if (replayClaim !== 'OK') {
      logStage('failed', { reason: 'oauth_state_replayed' });
      return res.status(409).json({ success: false, error: 'OAuth authorization already processed', stage, reference: requestId });
    }

    // Exchange authorization code for access token
    stage = 'access_token_exchange';
    logStage('started', { shop_domain: normalizedShop });
    const { accessToken, grantedScopes } = await exchangeAccessToken(normalizedShop, code);
    logger.info('shopify_oauth_scopes_granted', { shop_domain: normalizedShop, granted_scope_count: grantedScopes.split(',').filter(Boolean).length });
    logStage('completed', { access_token_received: Boolean(accessToken) });


    // Create or update connected store
    stage = 'store_persistence';
    logStage('started', { shop_domain: shop });
    const store = await upsertStore({
      organizationId: organization.id,
      shop: normalizedShop,
      accessToken,
      grantedScopes,
    });
    logStage('completed', { store_id: store.id });

    stage = 'authorization_verification';
    const { verifyShopifyAuthorization } = require('../services/shopifyAuthorization');
    const { recordIntegrationEvent } = require('../services/integrationLifecycleStore');
    const authorization = await verifyShopifyAuthorization(store);
    if (!authorization.verified) {
      const eventType = authorization.reasonCode === 'PERMISSIONS_MISSING' ? 'permissions_missing'
        : authorization.reasonCode === 'AUTHORIZATION_EXPIRED' ? 'authorization_expired'
          : authorization.reasonCode === 'AUTHORIZATION_REQUIRED' ? 'authorization_required' : 'reconnect_failed';
      await recordIntegrationEvent({ storeId: store.id, type: eventType, reasonCode: authorization.reasonCode, source: 'shopify_oauth', eventReference: `oauth:${requestId}:authorization` });
      const frontendUrl = new URL('/dashboard/integrations', configuredFrontendUrl);
      frontendUrl.searchParams.set('shopify', 'reconnect_failed');
      frontendUrl.searchParams.set('reason', authorization.reasonCode);
      frontendUrl.searchParams.set('shop', normalizedShop);
      return res.redirect(frontendUrl.toString());
    }
    await prisma.stores.update({
      where: { id: store.id },
      data: { granted_scopes: authorization.grantedScopes.join(','), authorization_verified_at: authorization.verifiedAt },
    });
    await recordIntegrationEvent({ storeId: store.id, type: 'authorization_verified', reasonCode: 'CONNECTED', observedAt: authorization.verifiedAt, source: 'shopify_oauth', eventReference: `oauth:${requestId}:verified` });

    stage = 'webhook_reconciliation';
    let webhookSetupComplete = false;
    try {
      const { reconcileShopifyWebhooks } = require('../services/shopifyWebhookService');
      await reconcileShopifyWebhooks(store);
      webhookSetupComplete = true;
    } catch (webhookError) {
      logger.warn('shopify_reconnect_webhooks_incomplete', { store_id: store.id, error_type: webhookError.code || webhookError.name || 'webhook_error' });
      await recordIntegrationEvent({ storeId: store.id, type: 'webhook_failed', reasonCode: 'WEBHOOK_REGISTRATION_FAILED', source: 'shopify_oauth', eventReference: `oauth:${requestId}:webhooks` });
    }

    stage = 'sync_recovery';
    logStage('started', { store_id: store.id });
    // The response reports authorization/recovery progress, never initial-sync
    // completion. The sync owns its distributed lock and durable lifecycle.
    syncShopifyStore(store, { reconcileWebhooks: false }).catch((error) => {
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

    res.clearCookie("shopify_organization", { ...buildCookieOptions(req), path: "/" });
    res.clearCookie("shopify_shop", { ...buildCookieOptions(req), path: "/" });

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
    const frontendUrl = new URL('/dashboard/integrations', configuredFrontendUrl);
    frontendUrl.searchParams.set('shopify', webhookSetupComplete ? 'authorized' : 'recovery_pending');
    frontendUrl.searchParams.set('shop', normalizedShop);
    if (!['http:', 'https:'].includes(frontendUrl.protocol)) {
      const error = new Error('Frontend URL must use HTTP or HTTPS.');
      error.code = 'SHOPIFY_FRONTEND_URL_INVALID';
      throw error;
    }
    logStage('completed', { redirect_host: frontendUrl.host });
    return res.redirect(frontendUrl.toString());
  } catch (error) {
    const reconnectStoreId = req.signedCookies?.shopify_reconnect_store;
    if (reconnectStoreId) {
      const { recordIntegrationEvent } = require('../services/integrationLifecycleStore');
      await recordIntegrationEvent({ storeId: reconnectStoreId, type: 'reconnect_failed', reasonCode: stage === 'store_persistence' ? 'BACKEND_FAILURE' : 'TOKEN_EXCHANGE_FAILED', source: 'shopify_oauth', eventReference: `oauth:${requestId}:failed` }).catch(() => null);
    }
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
    if (frontendOrigin) {
      for (const name of ['shopify_state', 'shopify_user', 'shopify_shop', 'oauth_user', 'shopify_organization', 'shopify_reconnect_store', 'shopify_reconnect_attempt']) {
        res.clearCookie(name, { ...buildCookieOptions(req), path: '/' });
      }
      const frontendUrl = new URL('/dashboard/integrations', frontendOrigin);
      frontendUrl.searchParams.set('shopify', 'error');
      frontendUrl.searchParams.set('stage', stage);
      frontendUrl.searchParams.set('reference', requestId);
      if (typeof req.query?.shop === 'string' && isValidShopDomain(req.query.shop)) {
        frontendUrl.searchParams.set('shop', req.query.shop);
      }
      return res.redirect(frontendUrl.toString());
    }
    return res.status(error.statusCode || 500).json({
      success: false,
      error: 'Shopify installation could not be completed',
      stage,
      reference: requestId,
    });
  } finally {
    const reconnectStoreId = req.signedCookies?.shopify_reconnect_store;
    const reconnectAttemptId = req.signedCookies?.shopify_reconnect_attempt;
    if (reconnectStoreId && reconnectAttemptId && isRedisReady()) {
      try {
        await getRedisClient().eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          1,
          `shopify:oauth:reconnect:${reconnectStoreId}`,
          reconnectAttemptId,
        );
      } catch (lockError) {
        logger.warn('shopify_reconnect_lock_release_failed', { store_id: reconnectStoreId, error_type: lockError.code || lockError.name });
      }
    }
  }
};
