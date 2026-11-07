'use strict';

const { evaluateTransition, safeReason } = require('./integrationLifecycle');

function defaultDb() { return require('../configs/database').prisma; }

async function recordIntegrationEvent({ storeId, type, reasonCode, observedAt = new Date(), source = 'backend', eventReference, capability = 'shopify' }, db = defaultDb()) {
  return db.$transaction(async (tx) => {
    const store = await tx.stores.findUnique({ where: { id: storeId } });
    if (!store) return { accepted: false, reason: 'store_not_found' };
    if (eventReference) {
      const duplicate = await tx.integration_lifecycle_events.findUnique({
        where: { store_id_source_event_reference: { store_id: storeId, source, event_reference: eventReference } },
        select: { id: true },
      });
      if (duplicate) return { accepted: false, reason: 'duplicate_event', eventId: duplicate.id };
    }
    const transition = evaluateTransition(store, { type, reasonCode, observedAt });
    if (!transition.accepted) return transition;
    const now = new Date();
    const updated = await tx.stores.updateMany({
      where: { id: storeId, integration_version: store.integration_version },
      data: {
        integration_state: transition.state,
        integration_reason_code: transition.reasonCode,
        integration_changed_at: transition.observedAt,
        integration_version: { increment: 1 },
        updated_at: now,
        ...(transition.clearAuthorization ? { status: 'disconnected', access_token: null, granted_scopes: null } : {}),
        ...(type === 'authorization_verified' ? { status: 'active', authorization_verified_at: transition.observedAt } : {}),
        ...(type === 'reconnect_started' ? { status: store.status === 'disconnected' ? 'disconnected' : store.status } : {}),
      },
    });
    if (updated.count !== 1) return { accepted: false, reason: 'concurrent_state_change' };
    const event = await tx.integration_lifecycle_events.create({
      data: {
        store_id: storeId,
        event_type: type,
        from_state: store.integration_state,
        to_state: transition.state,
        reason_code: safeReason(transition.reasonCode),
        source,
        event_reference: eventReference || null,
        observed_at: transition.observedAt,
        capability,
        metadata: {},
      },
    });
    return { accepted: true, state: transition.state, reasonCode: transition.reasonCode, eventId: event.id };
  });
}

module.exports = { recordIntegrationEvent };
