const { prisma } = require('../configs/database');
const { rfmSync } = require('./mlService');
const { shopifyGraphql } = require('./shopifyGraphql');
const { cancelOrder, upsertOrder, upsertAbandonedCart } = require('./commerceWebhookService');
const { reconcileShopifyWebhooks } = require('./shopifyWebhookService');
const logger = require('../utils/logger');
const { getRedisClient, isRedisReady } = require('../configs/redis');
const { FEATURE_FIELDS, runPredictionChain } = require('./featureWorkerService');

const PAGE_SIZE = 100;

function externalId(gid) {
  return String(gid || '').split('/').pop();
}

function money(value) {
  return Number(value?.shopMoney?.amount || 0);
}

function nextConnectionCursor(connection, previousCursor, rootName) {
  if (!Array.isArray(connection?.nodes) || !connection.pageInfo || typeof connection.pageInfo.hasNextPage !== 'boolean') {
    throw new Error(`shopify_${rootName}_pagination_invalid`);
  }
  if (connection.pageInfo.hasNextPage && (!connection.pageInfo.endCursor || connection.pageInfo.endCursor === previousCursor)) {
    throw new Error(`shopify_${rootName}_pagination_stalled`);
  }
  return connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
}

async function fetchConnection(store, query, rootName, fetchPage = shopifyGraphql) {
  const nodes = [];
  let cursor = null;
  do {
    const data = await fetchPage(store, query, { first: PAGE_SIZE, after: cursor });
    const connection = data[rootName];
    if (!connection) throw new Error(`shopify_${rootName}_response_missing`);
    const nextCursor = nextConnectionCursor(connection, cursor, rootName);
    nodes.push(...connection.nodes);
    cursor = nextCursor;
  } while (cursor);
  return nodes;
}

async function syncCustomers(store) {
  const query = `
    query Customers($first: Int!, $after: String) {
      customers(first: $first, after: $after) {
        nodes {
          id email firstName lastName phone state
          emailMarketingConsent { marketingState consentUpdatedAt }
          smsMarketingConsent { marketingState consentUpdatedAt }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `;
  const customers = await fetchConnection(store, query, 'customers');
  for (const customer of customers) {
    const id = externalId(customer.id);
    const consentEmail = customer.emailMarketingConsent?.marketingState === 'SUBSCRIBED';
    const consentSms = customer.smsMarketingConsent?.marketingState === 'SUBSCRIBED';
    await prisma.customers.upsert({
      where: { store_id_external_id: { store_id: store.id, external_id: id } },
      create: {
        store_id: store.id,
        external_id: id,
        email: customer.email || `${id}@redacted.invalid`,
        full_name: [customer.firstName, customer.lastName].filter(Boolean).join(' ') || null,
        phone: customer.phone || null,
        status: customer.state === 'DISABLED' ? 'inactive' : 'active',
        consent_email: consentEmail,
        consent_sms: consentSms,
        consent_updated_at: new Date(),
      },
      update: {
        email: customer.email || `${id}@redacted.invalid`,
        full_name: [customer.firstName, customer.lastName].filter(Boolean).join(' ') || null,
        phone: customer.phone || null,
        status: customer.state === 'DISABLED' ? 'inactive' : 'active',
        consent_email: consentEmail,
        consent_sms: consentSms,
        consent_updated_at: new Date(),
      },
    });
  }
  return customers.length;
}

function orderPayload(order) {
  return {
    id: externalId(order.id),
    created_at: order.createdAt,
    cancelled_at: order.cancelledAt,
    financial_status: order.displayFinancialStatus,
    // Shopify GraphQL currentTotalPriceSet is already adjusted for refunds.
    // The webhook refund reconciler must not subtract them a second time.
    total_price: money(order.currentTotalPriceSet || order.totalPriceSet),
    refunds: [],
    subtotal_price: money(order.subtotalPriceSet),
    total_discounts: money(order.totalDiscountsSet),
    currency: (order.currentTotalPriceSet || order.totalPriceSet)?.shopMoney?.currencyCode || 'USD',
    customer: order.customer ? {
      id: externalId(order.customer.id),
      email: order.customer.email,
      first_name: order.customer.firstName,
      last_name: order.customer.lastName,
      phone: order.customer.phone,
    } : null,
    discount_codes: (order.discountCodes || []).map((code) => ({ code })),
    line_items: (order.lineItems?.nodes || []).map((item) => ({
      id: externalId(item.id),
      product_id: externalId(item.product?.id),
      variant_id: externalId(item.variant?.id),
      title: item.name,
      quantity: item.quantity,
      price: money(item.originalUnitPriceSet),
    })),
  };
}

function grantedOrderScopes(data) {
  const scopes = data?.currentAppInstallation?.accessScopes;
  if (!Array.isArray(scopes)) throw Object.assign(new Error('Shopify did not return granted access scopes'), { code: 'SHOPIFY_SCOPES_UNVERIFIED' });
  return new Set(scopes.map(item => item?.handle).filter(Boolean));
}

async function verifyOrderReadScope(store, graphql = shopifyGraphql) {
  const data = await graphql(store, 'query RevlumaGrantedScopes { currentAppInstallation { accessScopes { handle } } }');
  const scopes = grantedOrderScopes(data);
  const persistedScopes = new Set(String(store.granted_scopes || '').split(',').map(scope => scope.trim()).filter(Boolean));
  // Log only capability booleans; never log access tokens or complete permission lists.
  logger.info('shopify_order_scope_comparison', {
    store_id: store.id,
    oauth_recorded_read_orders: persistedScopes.has('read_orders'),
    shopify_current_read_orders: scopes.has('read_orders'),
    oauth_scopes_recorded: persistedScopes.size > 0,
    shopify_scopes_returned: scopes.size > 0,
    mismatch: persistedScopes.has('read_orders') !== scopes.has('read_orders'),
  });
  if (!scopes.has('read_orders')) {
    // Only log the missing capability, never the access token or other granted scopes.
    // This distinguishes an OAuth authorization failure from a GraphQL/network failure.
    logger.warn('shopify_order_scope_missing', {
      store_id: store.id,
      required_scope: 'read_orders',
      resolution: 'merchant_reauthorization_required',
    });
    throw Object.assign(new Error('Shopify has not granted read_orders; merchant reauthorization is required'), {
      code: 'SHOPIFY_READ_ORDERS_NOT_GRANTED',
      setupStage: 'order_sync',
      requiresReauthorization: true,
    });
  }
  return { readOrders: true, readAllOrders: scopes.has('read_all_orders') };
}

async function syncOrders(store) {
  await verifyOrderReadScope(store);
  const query = `
    query Orders($first: Int!, $after: String) {
      orders(first: $first, after: $after, sortKey: CREATED_AT, reverse: true) {
        nodes {
          id createdAt cancelledAt displayFinancialStatus discountCodes
          currentTotalPriceSet { shopMoney { amount currencyCode } }
          totalPriceSet { shopMoney { amount currencyCode } }
          subtotalPriceSet { shopMoney { amount currencyCode } }
          totalDiscountsSet { shopMoney { amount currencyCode } }
          customer { id email firstName lastName phone }
          lineItems(first: 250) {
            nodes {
              id name quantity product { id } variant { id }
              originalUnitPriceSet { shopMoney { amount currencyCode } }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `;
  const orders = await fetchConnection(store, query, 'orders');
  let completed = 0;
  for (const order of orders) {
    const payload = orderPayload(order);
    if (payload.cancelled_at || ['CANCELLED', 'FAILED', 'VOIDED'].includes(payload.financial_status)) {
      await cancelOrder(store, payload);
    } else {
      await upsertOrder(store, 'shopify', payload);
    }
    completed += 1;
  }
  return completed;
}

function abandonedPayload(checkout) {
  return {
    id: externalId(checkout.id),
    created_at: checkout.createdAt,
    updated_at: checkout.updatedAt,
    completed_at: checkout.completedAt,
    abandoned_checkout_url: checkout.abandonedCheckoutUrl,
    total_price: money(checkout.totalPriceSet),
    currency: checkout.totalPriceSet?.shopMoney?.currencyCode || 'USD',
    customer: checkout.customer ? {
      id: externalId(checkout.customer.id),
      email: checkout.customer.email,
      first_name: checkout.customer.firstName,
      last_name: checkout.customer.lastName,
      phone: checkout.customer.phone,
    } : null,
    line_items: (checkout.lineItems?.nodes || []).map((item) => ({
      id: externalId(item.id),
      product_id: externalId(item.product?.id),
      variant_id: externalId(item.variant?.id),
      title: item.title || item.name || 'Unknown product',
      quantity: item.quantity,
      price: money(item.originalUnitPriceSet),
    })),
  };
}

async function syncAbandonedCheckouts(store) {
  const query = `
    query AbandonedCheckouts($first: Int!, $after: String) {
      abandonedCheckouts(first: $first, after: $after, sortKey: CREATED_AT, reverse: true) {
        nodes {
          id createdAt updatedAt completedAt abandonedCheckoutUrl
          totalPriceSet { shopMoney { amount currencyCode } }
          customer { id email firstName lastName phone }
          lineItems(first: 250) {
            nodes {
              id title quantity product { id } variant { id }
              originalUnitPriceSet { shopMoney { amount currencyCode } }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `;
  const checkouts = await fetchConnection(store, query, 'abandonedCheckouts');
  for (const checkout of checkouts) {
    const payload = abandonedPayload(checkout);
    const cart = await upsertAbandonedCart(store, payload);
    if (!cart) continue;
    await prisma.$transaction(async (tx) => {
      if (payload.line_items.length) {
        await tx.abandoned_cart_items.deleteMany({ where: { abandoned_cart_id: cart.id } });
        await tx.abandoned_cart_items.createMany({
          data: payload.line_items.map((item) => ({
            abandoned_cart_id: cart.id,
            external_product_id: item.product_id || 'unknown',
            external_variant_id: item.variant_id || null,
            product_name: item.title,
            price: item.price,
            quantity: Math.max(1, Number(item.quantity || 1)),
          })),
        });
      }
    });
    if (cart.customer_id && cart.status === 'abandoned') {
      const snapshot = await prisma.ml_session_features.findFirst({
        where: {
          store_id: store.id,
          customer_id: cart.customer_id,
          created_at: { gte: new Date(cart.abandoned_at.getTime() - 4 * 60 * 60 * 1000) },
        },
        orderBy: { created_at: 'desc' },
      });
      if (snapshot) {
        const features = Object.fromEntries(FEATURE_FIELDS.map((field) => {
          const value = snapshot[field];
          return [field, value && typeof value.toNumber === 'function' ? value.toNumber() : value];
        }));
        await runPredictionChain({
          envelope: {
            customer_id: cart.customer_id,
            session_id: snapshot.session_id,
            anonymous_id: snapshot.anonymous_id,
            features,
          },
          store,
          snapshot,
          cartOverride: cart,
        }).catch((error) => {
          logger.warn('shopify_cart_recovery_evaluation_deferred', {
            store_id: store.id,
            cart_id: cart.id,
            error_type: error.code || error.name || 'evaluation_error',
          });
        });
      }
    }
  }
  return checkouts.length;
}

async function syncShopifyStore(store, { reconcileWebhooks = true } = {}) {
  if (!isRedisReady()) {
    const error = new Error('Shopify setup requires distributed lock service');
    error.code = 'SHOPIFY_SETUP_LOCK_UNAVAILABLE';
    throw error;
  }
  const redis = getRedisClient();
  const lockKey = `shopify:setup:lock:${store.id}`;
  const lockOwner = require('crypto').randomUUID();
  const acquired = await redis.set(lockKey, lockOwner, 'EX', 900, 'NX');
  if (acquired !== 'OK') {
    return { success: false, alreadyRunning: true };
  }
  let setupStage = 'marking_store_syncing';
  logger.info('shopify_setup_stage', { store_id: store.id, stage: setupStage, outcome: 'started' });
  try {
    // A fresh ingestion attempt invalidates any historical completeness attestation.
    // This generic Shopify sync cannot certify complete historical access, refunds,
    // or customer lifetime history. Never mint coverage here merely from pagination.
    await prisma.intelligence_order_coverage.deleteMany({ where: { store_id: store.id } });
    await prisma.stores.update({
      where: { id: store.id },
      data: { status: 'syncing', updated_at: new Date() },
    });
    setupStage = 'webhook_reconciliation';
    logger.info('shopify_setup_stage', { store_id: store.id, stage: setupStage, outcome: 'started' });
    // Webhook setup and read-only commerce ingestion are independent.
    // A failed subscription must remain visible but must not prevent a
    // merchant from receiving verified data via an authorized initial sync.
    let webhookSetupError = null;
    if (reconcileWebhooks) {
      try {
        const webhookResult = await reconcileShopifyWebhooks(store);
        logger.info('shopify_setup_stage', { store_id: store.id, stage: setupStage, outcome: 'completed', registered: webhookResult.required });
      } catch (error) {
        webhookSetupError = error;
        logger.warn('shopify_webhook_setup_incomplete', {
          store_id: store.id,
          error_type: error.code || error.name || 'webhook_setup_error',
          shopify_errors: error.shopifyErrors || [],
        });
      }
    } else {
      logger.info('shopify_setup_stage', { store_id: store.id, stage: setupStage, outcome: 'skipped_for_background_order_reconciliation' });
    }

    setupStage = 'customer_sync';
    logger.info('shopify_setup_stage', { store_id: store.id, stage: setupStage, outcome: 'started' });
    let customers = 0;
    let customerSyncLimited = false;
    try {
      customers = await syncCustomers(store);
      logger.info('shopify_setup_stage', { store_id: store.id, stage: setupStage, outcome: 'completed', count: customers });
    } catch (error) {
      // Customer access is optional for the observation-first MVP. Only an
      // explicit Shopify customers-field access denial can be downgraded;
      // network failures, malformed data and database failures remain fatal.
      const deniedCustomers = error.code === 'SHOPIFY_GRAPHQL_ERROR' &&
        Array.isArray(error.shopifyErrors) &&
        error.shopifyErrors.some(item =>
          Array.isArray(item.codes) && item.codes.includes('ACCESS_DENIED') &&
          /customers field/i.test(String(item.message || '')));
      if (!deniedCustomers) throw error;
      customerSyncLimited = true;
      logger.warn('shopify_customer_sync_permission_limited', {
        store_id: store.id, stage: setupStage, reason: 'SHOPIFY_CUSTOMERS_ACCESS_DENIED',
      });
    }

    setupStage = 'order_sync';
    logger.info('shopify_setup_stage', { store_id: store.id, stage: setupStage, outcome: 'started' });
    const orders = await syncOrders(store);
    logger.info('shopify_setup_stage', { store_id: store.id, stage: setupStage, outcome: 'completed', count: orders });

    setupStage = 'abandoned_checkout_sync';
    logger.info('shopify_setup_stage', { store_id: store.id, stage: setupStage, outcome: 'started' });
    const abandoned = await syncAbandonedCheckouts(store);
    logger.info('shopify_setup_stage', { store_id: store.id, stage: setupStage, outcome: 'completed', count: abandoned });
    await prisma.stores.update({
      where: { id: store.id },
      data: { status: 'active', last_synced_at: new Date(), updated_at: new Date() },
    });
    // Certification is best-effort and strictly fail-closed. A failed proof
    // must never block routine order reconciliation or fabricate findings.
    try {
      if (webhookSetupError) {
        throw Object.assign(new Error('Webhook reconciliation incomplete'), { code: 'ORDER_COVERAGE_WEBHOOK_SETUP_INCOMPLETE' });
      }
      const { verifyShopifyOrderCoverage } = require('./intelligenceShopifyCoverageProducer');
      await verifyShopifyOrderCoverage(prisma, store);
      logger.info('shopify_order_coverage_certified', { store_id: store.id });
    } catch (coverageError) {
      logger.warn('shopify_order_coverage_unverified', {
        store_id: store.id,
        reason: coverageError.code || coverageError.name || 'verification_failed',
      });
    }
    const rfm = await rfmSync({ storeId: store.id, correlationId: `shopify-sync-${store.id}-${Date.now()}` });
    if (!rfm.success) logger.warn('shopify_rfm_sync_deferred', { store_id: store.id, code: rfm.error?.code });
    logger.info('shopify_sync_completed', { store_id: store.id, customers, orders, abandoned, webhook_setup_complete: !webhookSetupError });
    return { success: true, customers, orders, abandoned, rfm: rfm.success, customerSyncLimited, webhookSetupComplete: !webhookSetupError, webhookSetupErrorCode: webhookSetupError?.code || null };
  } catch (error) {
    try {
      await prisma.stores.update({
        where: { id: store.id },
        // A setup failure must never revoke a successfully authorized OAuth connection.
        // Token invalidation belongs to explicit uninstall / verified revocation handling.
        data: { status: 'active', updated_at: new Date() },
      });
    } catch (stateError) {
      logger.error('shopify_sync_failure_state_update_failed', {
        store_id: store.id,
        error_type: stateError.code || stateError.name || 'store_state_update_error',
      });
    }
    logger.error('shopify_sync_failed', {
      store_id: store.id,
      stage: error.setupStage || setupStage,
      error_type: error.code || error.name || 'sync_error',
      http_status: error.status || error.response?.status || null,
      network_code: error.networkCode || error.code || null,
      shopify_errors: error.shopifyErrors || [],
    });
    throw error;
  } finally {
    try {
      await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, lockKey, lockOwner);
    } catch (lockError) {
      logger.warn('shopify_setup_lock_release_failed', { store_id: store.id, error_type: lockError.code || lockError.name });
    }
  }
}

module.exports = {
  grantedOrderScopes,
  verifyOrderReadScope,
  fetchConnection,
  nextConnectionCursor,
  abandonedPayload,
  orderPayload,
  syncAbandonedCheckouts,
  syncCustomers,
  syncOrders,
  syncShopifyStore,
};
