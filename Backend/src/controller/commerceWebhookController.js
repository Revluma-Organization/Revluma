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
    const result = await processCommerceWebhook({ provider, store, topic: headers.topic, payload });
    await markDelivery(delivery.id, 'processed');
    logger.info('commerce_webhook_processed', { provider, store_id: store.id, topic: headers.topic, action: result.action });
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    await markDelivery(delivery.id, 'failed', error.code || error.name || 'processing_error').catch(() => {});
    logger.error('commerce_webhook_failed', { provider, store_id: store.id, topic: headers.topic, error_type: error.code || 'processing_error' });
    return next(error);
  }
};
