const { prisma } = require('../configs/database');
const { rfmSync } = require('./mlService');
const { shopifyGraphql } = require('./shopifyGraphql');
const { cancelOrder, upsertOrder, upsertAbandonedCart } = require('./commerceWebhookService');
const { reconcileShopifyWebhooks } = require('./shopifyWebhookService');
const logger = require('../utils/logger');
const { getRedisClient, isRedisReady } = require('../configs/redis');
const { shopifyGraphqlOrderTotals } = require('./shopifyOrderFinancials');
const { FEATURE_FIELDS, runPredictionChain } = require('./featureWorkerService');
const { syncProducts } = require('./productSync');

const PAGE_SIZE = 100;
const MAX_SYNC_PAGES = 100; // Explicit cap: never report a partial import as successful.
const OPTIONAL_PREDICTION_TIMEOUT_MS = 12_000;

// A non-critical ML evaluation must never indefinitely block Shopify ingestion.
async function evaluateCartWithDeadline(task, storeId, cartId, timeoutMs = OPTIONAL_PREDICTION_TIMEOUT_MS) {
  let timer;
  try {
    await Promise.race([
      Promise.resolve().then(task),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('prediction deadline exceeded'), { code: 'PREDICTION_TIMEOUT' })), timeoutMs);
      }),
    ]);
  } catch (error) {
    logger.warn('shopify_cart_recovery_evaluation_deferred', {
      store_id: storeId, cart_id: cartId,
      error_type: error.code || error.name || 'evaluation_error',
    });
  } finally {
    clearTimeout(timer);
  }
}


function externalId(gid) {
  return String(gid || '').split('/').pop();
}

function money(value) {
  const amount = value?.shopMoney?.amount;
  if (amount === null || amount === undefined || amount === '') return null;
  const parsed = Number(amount);
  return Number.isFinite(parsed) ? parsed : null;
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
  let pages = 0;
  const seenCursors = new Set();
  do {
    if (++pages > MAX_SYNC_PAGES) {
      throw Object.assign(new Error(`shopify_${rootName}_pagination_limit_exceeded`), { code: 'SHOPIFY_PAGINATION_LIMIT_EXCEEDED' });
    }
    const data = await fetchPage(store, query, { first: PAGE_SIZE, after: cursor });
    const connection = data[rootName];
    if (!connection) throw new Error(`shopify_${rootName}_response_missing`);
    const nextCursor = nextConnectionCursor(connection, cursor, rootName);
    if (nextCursor && seenCursors.has(nextCursor)) {
      throw new Error(`shopify_${rootName}_pagination_stalled`);
    }
    if (nextCursor) seenCursors.add(nextCursor);
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

// Expand a nested connection before writing any parent. A cursor is only
// meaningful for that parent, and each additional read must still refer to the
// same source version. An interrupted or changed snapshot fails closed.
async function completeLineItems(store, records, type, graphql = shopifyGraphql) {
  if (!['Order', 'AbandonedCheckout'].includes(type)) throw new Error('Unsupported Shopify parent type');
  const fields = type === 'Order'
    ? 'id name quantity product { id } variant { id } originalUnitPriceSet { shopMoney { amount currencyCode } }'
    : 'id title quantity product { id } variant { id } originalUnitPriceSet { shopMoney { amount currencyCode } }';
  const query = `query RevlumaNestedLines($id: ID!, $first: Int!, $after: String!) {
    node(id: $id) { id ... on ${type} { updatedAt lineItems(first: $first, after: $after) {
      nodes { ${fields} } pageInfo { hasNextPage endCursor }
    } } }
  }`;
  for (const record of records) {
    const incomplete = () => Object.assign(new Error('Shopify line item connection is incomplete'), { code: 'SHOPIFY_LINE_ITEMS_INCOMPLETE' });
    let connection = record?.lineItems;
    if (!connection || !Array.isArray(connection.nodes) || typeof connection.pageInfo?.hasNextPage !== 'boolean') throw incomplete();
    const items = [...connection.nodes];
    const ids = new Set();
    const addIds = nodes => {
      for (const item of nodes) {
        if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)) throw incomplete();
        ids.add(item.id);
      }
    };
    addIds(items);
    const cursors = new Set();
    let pages = 1;
    while (connection.pageInfo.hasNextPage) {
      const cursor = connection.pageInfo.endCursor;
      if (typeof record.id !== 'string' || !record.id || typeof record.updatedAt !== 'string' ||
          !Number.isFinite(Date.parse(record.updatedAt)) || typeof cursor !== 'string' || !cursor || cursors.has(cursor)) throw incomplete();
      if (++pages > MAX_SYNC_PAGES) throw incomplete();
      cursors.add(cursor);
      const data = await graphql(store, query, { id: record.id, first: 250, after: cursor });
      const node = data?.node;
      if (!node || node.id !== record.id || node.updatedAt !== record.updatedAt) throw incomplete();
      connection = node.lineItems;
      if (!connection || !Array.isArray(connection.nodes) || typeof connection.pageInfo?.hasNextPage !== 'boolean') throw incomplete();
      addIds(connection.nodes);
      items.push(...connection.nodes);
    }
    record.lineItems = { nodes: items, pageInfo: connection.pageInfo };
  }
}

function orderPayload(order) {
  // Money semantics (Shopify Admin GraphQL):
  //   totalPriceSet ........ total before returns/refunds
  //   currentTotalPriceSet . total after returns/refunds (authoritative net)
  //   totalRefundedSet ..... amount refunded so far
  // `orders.total` stores the net value, so a refunded order (e.g. #1004:
  // $1,025 gross, $1,025 refunded) is persisted at $0 and contributes nothing
  // to recorded revenue. The refunded amount is carried separately so gross can
  // be reconstructed (net + refunded) without guessing.
  const totals = shopifyGraphqlOrderTotals(order);
  return {
    id: externalId(order.id),
    checkout_token: order.checkoutToken || null,
    cart_token: order.cartToken || null,
    created_at: order.createdAt,
    cancelled_at: order.cancelledAt,
    financial_status: order.displayFinancialStatus,
    total_price: totals.net,
    total_refunded: totals.refunded,
    // currentTotalPriceSet is already refund-adjusted, so the webhook normaliser
    // must not subtract the same refunds again.
    refunds: [],
    subtotal_price: money(order.subtotalPriceSet),
    total_discounts: money(order.totalDiscountsSet),
    // No silent USD: a missing currency fails closed during ingestion.
    currency: totals.currency,
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
          id checkoutToken cartToken createdAt updatedAt cancelledAt displayFinancialStatus discountCodes
          currentTotalPriceSet { shopMoney { amount currencyCode } }
          totalPriceSet { shopMoney { amount currencyCode } }
          totalRefundedSet { shopMoney { amount currencyCode } }
          subtotalPriceSet { shopMoney { amount currencyCode } }
          totalDiscountsSet { shopMoney { amount currencyCode } }
          customer { id email firstName lastName phone }
          lineItems(first: 250) {
            nodes {
              id name quantity product { id } variant { id }
              originalUnitPriceSet { shopMoney { amount currencyCode } }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `;
  const orders = await fetchConnection(store, query, 'orders');
  // Check all records before any writes, so a truncated child cannot produce a
  // successful sync or silently replace previously complete order items.
  await completeLineItems(store, orders, 'Order');
  let completed = 0;
  const failures = [];
  for (const order of orders) {
    const payload = orderPayload(order);
    try {
      if (payload.cancelled_at || ['CANCELLED', 'FAILED', 'VOIDED'].includes(payload.financial_status)) {
        await cancelOrder(store, payload);
      } else {
        await upsertOrder(store, 'shopify', payload);
      }
      completed += 1;
    } catch (error) {
      // Never persist an unverified monetary record as a valid sale. Keep
      // processing other orders, then fail the sync so freshness is not
      // reported as complete while records are missing.
      failures.push({ external_order_id: payload.id, code: error.code || error.name || 'ORDER_INGESTION_FAILED' });
      logger.warn('shopify_order_ingestion_failed', {
        store_id: store.id, external_order_id: payload.id,
        error_code: error.code || error.name || 'order_ingestion_failed',
      });
    }
  }
  if (failures.length) {
    const error = new Error('Shopify order ingestion was incomplete');
    error.code = 'SHOPIFY_ORDER_INGESTION_INCOMPLETE';
    error.failed_orders = failures.length;
    throw error;
  }
  return completed;
}

function abandonedPayload(checkout) {
  return {
    id: externalId(checkout.id),
    checkout_id: checkout.id || null,
    created_at: checkout.createdAt,
    updated_at: checkout.updatedAt,
    completed_at: checkout.completedAt,
    abandoned_checkout_url: checkout.abandonedCheckoutUrl,
    total_price: money(checkout.totalPriceSet),
    currency: checkout.totalPriceSet?.shopMoney?.currencyCode ?? null,
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
            pageInfo { hasNextPage endCursor }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `;
  const checkouts = await fetchConnection(store, query, 'abandonedCheckouts');
  await completeLineItems(store, checkouts, 'AbandonedCheckout');
  for (const checkout of checkouts) {
    logger.info('shopify_checkout_sync_processing', { store_id: store.id, checkout_id: externalId(checkout.id), stage: 'started' });
    const payload = abandonedPayload(checkout);
    const cart = await upsertAbandonedCart(store, payload);
    if (!cart) continue;
    await prisma.$transaction(async (tx) => {
      if (payload.line_items.length) {
        const validatedItems = payload.line_items.map((item) => {
          const price = Number(item.price);
          const quantity = Number(item.quantity);
          if (!Number.isFinite(price) || price < 0 || !Number.isInteger(quantity) || quantity < 1) {
            logger.warn('shopify_checkout_item_financials_unverified', {
              store_id: store.id, checkout_id: externalId(checkout.id),
            });
            return null;
          }
          return {
            abandoned_cart_id: cart.id,
            external_product_id: item.product_id || 'unknown',
            external_variant_id: item.variant_id || null,
            product_name: item.title,
            price,
            quantity,
          };
        }).filter(Boolean);
        if (validatedItems.length) {
          await tx.abandoned_cart_items.deleteMany({ where: { abandoned_cart_id: cart.id } });
          await tx.abandoned_cart_items.createMany({ data: validatedItems });
        }
      }
    });
    logger.info('shopify_checkout_sync_processing', { store_id: store.id, checkout_id: externalId(checkout.id), stage: 'persisted' });
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
        await evaluateCartWithDeadline(() => runPredictionChain({
          envelope: {
            customer_id: cart.customer_id,
            session_id: snapshot.session_id,
            anonymous_id: snapshot.anonymous_id,
            features,
          },
          store,
          snapshot,
          cartOverride: cart,
        }), store.id, cart.id);
      }
    }
  }
  logger.info('shopify_checkout_sync_batch_completed', { store_id: store.id, count: checkouts.length });
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
  // A new lock owner supersedes any interrupted previous run. Preserve the
  // previous success timestamp; never claim the interrupted run completed.
  const previousState = await prisma.stores.findUnique({
    where: { id: store.id }, select: { status: true, updated_at: true, last_synced_at: true },
  }).catch((error) => {
    logger.warn('shopify_previous_sync_state_unavailable', { store_id: store.id, error_type: error.code || error.name });
    return null;
  });
  if (previousState?.status === 'syncing') {
    logger.warn('shopify_interrupted_sync_detected', {
      store_id: store.id,
      previous_updated_at: previousState.updated_at,
      previous_success_at: previousState.last_synced_at,
    });
  }
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

    setupStage = 'product_sync';
    logger.info('shopify_setup_stage', { store_id: store.id, stage: setupStage, outcome: 'started' });
    try {
      const products = await syncProducts(store);
      logger.info('shopify_setup_stage', { store_id: store.id, stage: setupStage, outcome: 'completed', count: products });
    } catch (error) {
      // Catalogue access is optional until the merchant re-consents to the
      // read_products scope. Only an explicit Shopify products-field denial
      // can be downgraded; malformed data and database failures stay fatal.
      const deniedProducts = error.code === 'SHOPIFY_GRAPHQL_ERROR' &&
        Array.isArray(error.shopifyErrors) &&
        error.shopifyErrors.some(item =>
          Array.isArray(item.codes) && item.codes.includes('ACCESS_DENIED') &&
          /products field/i.test(String(item.message || '')));
      if (!deniedProducts) throw error;
      logger.warn('shopify_product_sync_permission_limited', {
        store_id: store.id, stage: setupStage, reason: 'SHOPIFY_PRODUCTS_ACCESS_DENIED',
      });
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
  evaluateCartWithDeadline,
  grantedOrderScopes,
  verifyOrderReadScope,
  fetchConnection,
  nextConnectionCursor,
  completeLineItems,
  abandonedPayload,
  orderPayload,
  syncAbandonedCheckouts,
  syncCustomers,
  syncOrders,
  syncProducts,
  syncShopifyStore,
};
