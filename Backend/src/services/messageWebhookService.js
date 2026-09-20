const crypto = require('crypto');
const { prisma } = require('../configs/database');

function verifySignature(rawBody, signature, secret) {
  if (!rawBody || !signature || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

function canonicalEvent(provider, payload) {
  const event = payload.event || payload.type || payload.event_type;
  const mapping = {
    delivered: 'delivered', delivery: 'delivered',
    opened: 'opened', open: 'opened',
    clicked: 'clicked', click: 'clicked',
    converted: 'converted', conversion: 'converted',
    unsubscribed: 'unsubscribed', unsubscribe: 'unsubscribed',
  };
  return mapping[String(event || '').toLowerCase()] || null;
}

async function recordMessageEvent({ provider, payload }) {
  const externalMessageId = String(payload.external_message_id || payload.message_id || payload.data?.message_id || '');
  if (!externalMessageId) throw new Error('external_message_id is required.');

  const send = await prisma.sequence_sends.findFirst({
    where: { external_message_id: externalMessageId },
    select: { id: true },
  });
  if (!send) return { ignored: true, reason: 'message_not_found' };

  const eventType = canonicalEvent(provider, payload);
  if (!eventType) return { ignored: true, reason: 'unsupported_event' };
  const externalEventId = String(payload.external_event_id || payload.event_id || `${provider}:${externalMessageId}:${eventType}:${payload.occurred_at || ''}`);

  try {
    await prisma.sequence_events.create({
      data: {
        sequence_send_id: send.id,
        event_type: eventType,
        external_event_id: externalEventId,
        occurred_at: new Date(payload.occurred_at || Date.now()),
        metadata: { provider },
      },
    });
  } catch (error) {
    if (error.code === 'P2002') return { duplicate: true };
    throw error;
  }

  const update = {};
  if (eventType === 'delivered') update.delivered_at = new Date(payload.occurred_at || Date.now());
  if (eventType === 'delivered') update.status = 'delivered';
  if (eventType === 'clicked' || eventType === 'opened') update.status = 'delivered';
  await prisma.sequence_sends.update({ where: { id: send.id }, data: update });
  return { recorded: true, event_type: eventType };
}

module.exports = { verifySignature, recordMessageEvent };
