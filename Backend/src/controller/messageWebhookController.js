const logger = require('../utils/logger');
const {
  verifySignature,
  verifySendGridSignature,
  recordMessageEvents,
} = require('../services/messageWebhookService');

exports.receive = async (req, res, next) => {
  const provider = req.params.provider;
  const rawBody = Buffer.isBuffer(req.body) ? req.body : null;
  const isSendGrid = provider === 'sendgrid';
  const signature = isSendGrid
    ? req.headers['x-twilio-email-event-webhook-signature']
    : req.headers['x-webhook-signature'] || req.headers['x-provider-signature'];
  const valid = isSendGrid
    ? verifySendGridSignature(
        rawBody,
        signature,
        req.headers['x-twilio-email-event-webhook-timestamp'],
        process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY
      )
    : verifySignature(rawBody, signature, process.env.MESSAGE_WEBHOOK_SECRET);

  if (!rawBody || !valid) {
    return res.status(401).json({ success: false, error: 'Invalid webhook signature.' });
  }

  try {
    const parsed = JSON.parse(rawBody.toString('utf8'));
    const payloads = Array.isArray(parsed) ? parsed : [parsed];
    if (isSendGrid && !Array.isArray(parsed)) {
      return res.status(400).json({ success: false, error: 'SendGrid webhook payload must be an array.' });
    }
    const results = await recordMessageEvents({ provider, payloads });
    logger.info('message_webhook_processed', { provider, count: results.length });
    return res.status(200).json({ success: true, data: results });
  } catch (error) {
    logger.error('message_webhook_failed', { provider, error_type: error.code || 'processing_error' });
    return next(error);
  }
};
