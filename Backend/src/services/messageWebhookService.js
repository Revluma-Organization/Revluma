const crypto = require('crypto');
const { prisma } = require('../configs/database');

function safeCompare(actual, expected) {
  const left = Buffer.from(actual || '');
  const right = Buffer.from(expected || '');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function verifySignature(rawBody, signature, secret) {
  if (!rawBody || !signature || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  return safeCompare(expected, signature);
}

function sendGridPublicKey(value) {
  if (!value) return null;
  if (value.includes('BEGIN PUBLIC KEY')) return value;
  try {
    return crypto.createPublicKey({ key: Buffer.from(value, 'base64'), format: 'der', type: 'spki' });
  } catch {
    return null;
  }
}

function verifySendGridSignature(rawBody, signature, timestamp, verificationKey) {
  if (!rawBody || !signature || !timestamp) return false;
  const publicKey = sendGridPublicKey(verificationKey);
  if (!publicKey) return false;
  try {
    const signedPayload = Buffer.concat([Buffer.from(String(timestamp), 'utf8'), rawBody]);
    return crypto.verify('sha256', signedPayload, publicKey, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}

function canonicalEvent(provider, payload) {
  const event = payload.event || payload.type || payload.event_type;
  const mapping = {
    delivered: 'delivered', delivery: 'delivered',
    processed: 'processed',
    opened: 'opened', open: 'opened',
    clicked: 'clicked', click: 'clicked',
    converted: 'converted', conversion: 'converted',
    unsubscribed: 'unsubscribed', unsubscribe: 'unsubscribed',
    group_unsubscribe: 'unsubscribed', spamreport: 'unsubscribed',
    bounce: 'failed', blocked: 'failed', dropped: 'failed', deferred: 'failed',
  };
  return mapping[String(event || '').toLowerCase()] || null;
}

function eventTime(payload) {
  const value = payload.occurred_at || payload.timestamp;
  if (typeof value === 'number') return new Date(value * 1000);
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

async function locateSend(payload) {
  const sendId = payload.sequence_send_id || payload.unique_args?.sequence_send_id;
  if (sendId) {
    return prisma.sequence_sends.findUnique({ where: { id: String(sendId) } });
  }
  const externalMessageId = String(
    payload.external_message_id || payload.message_id || payload.sg_message_id || payload.data?.message_id || ''
  ).split('.')[0];
  if (!externalMessageId) throw new Error('external_message_id_required');
  return prisma.sequence_sends.findFirst({
    where: {
      OR: [
        { external_message_id: externalMessageId },
        { external_message_id: { startsWith: externalMessageId } },
      ],
    },
  });
}

async function recordMessageEvent({ provider, payload }) {
  const send = await locateSend(payload);
  if (!send) return { ignored: true, reason: 'message_not_found' };
  const eventType = canonicalEvent(provider, payload);
  if (!eventType) return { ignored: true, reason: 'unsupported_event' };
  const occurredAt = eventTime(payload);
  const externalEventId = String(
    payload.external_event_id || payload.sg_event_id || payload.event_id ||
    `${provider}:${send.id}:${eventType}:${occurredAt.toISOString()}`
  );
  try {
    await prisma.sequence_events.create({
      data: {
        sequence_send_id: send.id,
        event_type: eventType,
        external_event_id: externalEventId,
        occurred_at: occurredAt,
        metadata: { provider },
      },
    });
  } catch (error) {
    if (error.code === 'P2002') return { duplicate: true, event_type: eventType };
    throw error;
  }

  const update = {};
  if (eventType === 'delivered') {
    update.delivered_at = occurredAt;
    update.status = 'delivered';
  } else if (['opened', 'clicked', 'converted'].includes(eventType)) {
    update.status = 'delivered';
  } else if (eventType === 'failed') {
    update.status = 'failed';
  }
  await prisma.sequence_sends.update({ where: { id: send.id }, data: update });
  if (eventType === 'unsubscribed' && send.customer_id) {
    await prisma.customers.update({
      where: { id: send.customer_id },
      data: { consent_email: false, consent_updated_at: occurredAt },
    });
  }
  return { recorded: true, event_type: eventType };
}

async function recordMessageEvents({ provider, payloads }) {
  const results = [];
  for (const payload of payloads) results.push(await recordMessageEvent({ provider, payload }));
  return results;
}

module.exports = {
  canonicalEvent,
  recordMessageEvent,
  recordMessageEvents,
  verifySendGridSignature,
  verifySignature,
};
