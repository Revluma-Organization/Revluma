const { prisma } = require('../configs/database');
const { rfmSync } = require('./mlService');
const { shopifyGraphql } = require('./shopifyGraphql');
const { cancelOrder, upsertOrder, upsertAbandonedCart } = require('./commerceWebhookService');
const { reconcileShopifyWebhooks } = require('./shopifyWebhookService');
const logger = require('../utils/logger');
const { FEATURE_FIELDS, runPredictionChain } = require('./featureWorkerService');

const PAGE_SIZE = 100;

function externalId(gid) {
  return String(gid || '').split('/').pop();
}

function money(value) {
  return Number(value?.shopMoney?.amount || 0);
}

async function fetchConnection(store, query, rootName) {
  const nodes = [];
  let cursor = null;
  do {
    const data = await shopifyGraphql(store, query, { first: PAGE_SIZE, after: cursor });
    const connection = data[rootName];
    if (!connection) throw new Error(`shopify_${rootName}_response_missing`);
    nodes.push(...connection.nodes);
    cursor = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
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
    total_price: money(order.totalPriceSet),
    subtotal_price: money(order.subtotalPriceSet),
    total_discounts: money(order.totalDiscountsSet),
    currency: order.totalPriceSet?.shopMoney?.currencyCode || 'USD',
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

async function syncOrders(store) {
  const query = `
    query Orders($first: Int!, $after: String) {
      orders(first: $first, after: $after, sortKey: CREATED_AT, reverse: true) {
        nodes {
          id createdAt cancelledAt displayFinancialStatus discountCodes
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
      await tx.abandoned_cart_items.deleteMany({ where: { abandoned_cart_id: cart.id } });
      if (payload.line_items.length) {
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

async function syncShopifyStore(store) {
  await prisma.stores.update({ where: { id: store.id }, data: { status: 'syncing' } });
  try {
    await reconcileShopifyWebhooks(store);
    const customers = await syncCustomers(store);
    const orders = await syncOrders(store);
    const abandoned = await syncAbandonedCheckouts(store);
    await prisma.stores.update({
      where: { id: store.id },
      data: { status: 'active', last_synced_at: new Date(), updated_at: new Date() },
    });
    const rfm = await rfmSync({ storeId: store.id, correlationId: `shopify-sync-${store.id}-${Date.now()}` });
    if (!rfm.success) logger.warn('shopify_rfm_sync_deferred', { store_id: store.id, code: rfm.error?.code });
    logger.info('shopify_sync_completed', { store_id: store.id, customers, orders, abandoned });
    return { success: true, customers, orders, abandoned, rfm: rfm.success };
  } catch (error) {
    await prisma.stores.update({ where: { id: store.id }, data: { status: 'error' } }).catch(() => {});
    logger.error('shopify_sync_failed', { store_id: store.id, error_type: error.code || error.name || 'sync_error' });
    throw error;
  }
}

module.exports = {
  abandonedPayload,
  orderPayload,
  syncAbandonedCheckouts,
  syncCustomers,
  syncOrders,
  syncShopifyStore,
};
