const crypto = require('crypto');
const logger = require('../utils/logger');
const {
  findStore,
  claimDelivery,
  markDelivery,
  processCommerceWebhook,
  verifyShopifySignature,
  verifyWooCommerceSignature,
} = require('../services/commerceWebhookService');

function deliveryId(req, rawBody) {
  return req.headers['x-shopify-webhook-id'] || req.headers['x-wc-webhook-id'] || crypto.createHash('sha256').update(rawBody).digest('hex');
}

function providerHeaders(provider, req) {
  if (provider === 'shopify') {
    return {
      domain: req.headers['x-shopify-shop-domain'],
      topic: req.params.topic,
      signature: req.headers['x-shopify-hmac-sha256'],
    };
  }
  return {
    domain: req.headers['x-wc-webhook-source']?.replace(/^https?:\/\//, '').replace(/\/$/, ''),
    topic: req.params.topic,
    signature: req.headers['x-wc-webhook-signature'],
  };
}

exports.receive = async (req, res, next) => {
  const provider = req.params.provider;
  const rawBody = Buffer.isBuffer(req.body) ? req.body : null;
  if (!rawBody || !['shopify', 'woocommerce'].includes(provider)) {
    return res.status(400).json({ success: false, error: 'Raw webhook body is required.' });
  }

  const headers = providerHeaders(provider, req);
  const valid = provider === 'shopify'
    ? verifyShopifySignature(rawBody, headers.signature)
    : verifyWooCommerceSignature(rawBody, headers.signature);
  if (!valid) return res.status(401).json({ success: false, error: 'Invalid webhook signature.' });

  const store = await findStore(provider, headers.domain);
  if (!store) return res.status(404).json({ success: false, error: 'Webhook store not found.' });

  const delivery = await claimDelivery(provider, deliveryId(req, rawBody), store.id, headers.topic);
  if (!delivery) return res.status(200).json({ success: true, duplicate: true });

  try {
    const payload = JSON.parse(rawBody.toString('utf8'));
    // Temporary Task 013 diagnostic. Field names/types only; never log payload values.
    // Restricted to the dedicated test shop and explicitly enabled deployments.
    if (
      process.env.TASK013_CHECKOUT_FIELD_CAPTURE === 'true' &&
      provider === 'shopify' &&
      headers.domain === 'revluma-test-store-v1.myshopify.com' &&
      ['checkouts/create', 'checkouts/update'].includes(headers.topic)
    ) {
      const fieldType = (value) => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
      const fields = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? Object.keys(payload).sort().map((key) => [key, fieldType(payload[key])])
        : [];
      const items = Array.isArray(payload?.line_items) ? payload.line_items : null;
      const itemFields = items
        ? [...new Set(items.flatMap((item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.keys(item) : []))].sort()
        : [];
      logger.info('task013_checkout_field_presence', {
        topic: headers.topic,
        store_id: store.id,
        fields,
        line_items_type: fieldType(payload?.line_items),
        line_items_count: items?.length ?? null,
        line_item_field_names: itemFields,
      });
    }
    // Task 014: temporary, opt-in order webhook shape audit. Never emit field values.
    // Restrict to the dedicated Shopify test store; do not log raw bodies or identifiers.
    if (
      process.env.TASK014_ORDER_FIELD_CAPTURE === 'true' &&
      provider === 'shopify' &&
      headers.domain === 'revluma-test-store-v1.myshopify.com' &&
      ['orders/create', 'orders/updated', 'orders/cancelled', 'orders/delete'].includes(headers.topic)
    ) {
      const fieldType = (value) => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
      const shape = (value) => value && typeof value === 'object' && !Array.isArray(value)
        ? Object.keys(value).sort().map((key) => [key, fieldType(value[key])])
        : [];
      const arrayShape = (value) => Array.isArray(value)
        ? [...new Set(value.flatMap((entry) => entry && typeof entry === 'object' && !Array.isArray(entry) ? Object.keys(entry) : []))].sort()
        : [];
      logger.info('task014_order_field_presence', {
        topic: headers.topic,
        store_id: store.id,
        fields: shape(payload),
        line_items_type: fieldType(payload?.line_items),
        line_items_count: Array.isArray(payload?.line_items) ? payload.line_items.length : null,
        line_item_field_names: arrayShape(payload?.line_items),
        customer_type: fieldType(payload?.customer),
        customer_fields: shape(payload?.customer),
        refunds_type: fieldType(payload?.refunds),
        refund_field_names: arrayShape(payload?.refunds),
        discount_codes_type: fieldType(payload?.discount_codes),
        discount_code_field_names: arrayShape(payload?.discount_codes),
      });
    }
    const result = await processCommerceWebhook({ provider, store, topic: headers.topic, payload });
    await markDelivery(delivery.id, 'processed');
    logger.info('commerce_webhook_processed', { provider, store_id: store.id, topic: headers.topic, action: result.action });
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    try {
      await markDelivery(delivery.id, 'failed', error.code || error.name || 'processing_error');
    } catch (stateError) {
      logger.error('commerce_webhook_delivery_state_update_failed', {
        provider,
        store_id: store.id,
        topic: headers.topic,
        error_type: stateError.code || stateError.name || 'delivery_state_update_error',
      });
    }
    logger.error('commerce_webhook_failed', { provider, store_id: store.id, topic: headers.topic, error_type: error.code || 'processing_error' });
    return next(error);
  }
};
