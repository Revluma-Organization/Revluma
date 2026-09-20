const logger = require('../utils/logger');
const { verifySignature, recordMessageEvent } = require('../services/messageWebhookService');

exports.receive = async (req, res, next) => {
  const provider = req.params.provider;
  const rawBody = Buffer.isBuffer(req.body) ? req.body : null;
  const signature = req.headers['x-webhook-signature'] || req.headers['x-provider-signature'];
  const secret = provider === 'sendgrid'
    ? process.env.SENDGRID_WEBHOOK_SECRET
    : process.env.MESSAGE_WEBHOOK_SECRET;

  if (!rawBody || !verifySignature(rawBody, signature, secret)) {
    return res.status(401).json({ success: false, error: 'Invalid webhook signature.' });
  }

  try {
    const payload = JSON.parse(rawBody.toString('utf8'));
    const result = await recordMessageEvent({ provider, payload });
    logger.info('message_webhook_processed', { provider, event_type: result.event_type, duplicate: Boolean(result.duplicate) });
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    logger.error('message_webhook_failed', { provider, error_type: error.code || 'processing_error' });
    return next(error);
  }
};
