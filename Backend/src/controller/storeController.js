'use strict';

const { requireMembership } = require('../utils/organizationContext');
const prisma = require('../configs/database').prisma;
const { REQUIRED_SUBSCRIPTIONS } = require('../services/shopifyWebhookService');
const {
  INTEGRATION_STATE_CONTRACT_VERSION,
  retrieveIntegrationStates,
  validateIntegrationState,
} = require('../services/revIntegrationState');
const { buildIntegrationDiagnostics } = require('../services/integrationDiagnostics');

// The store-list contract is "return the stores": auxiliary evidence (webhook
// registrations/deliveries, sync-domain ledger, lifecycle events) is additive.
// If any of it is unavailable (absent model in a partial mock, or a transient
// ledger error) the list degrades to empty rows for that source rather than
// failing the whole request. The canonical block degrades to
// `integration_state: null` (see attachCanonicalStates); the dedicated
// /integration-states endpoints remain strict and fail closed. (213/214 merge
// defect fix — Task 214's direct sync-ledger query must not 500 the list.)
async function optionalRows(model, args) {
  if (!model?.findMany) return [];
  try {
    return await model.findMany(args);
  } catch {
    return [];
  }
}

function responseStore(store, registrations, deliveries, syncRows, events) {
  const diagnostics = buildIntegrationDiagnostics({ store, registrations, deliveries, syncRows, recentEvents: events });
  const connected = !['not_connected', 'disconnected', 'authorization_required', 'authorization_expired', 'authorization_revoked', 'invalid', 'missing_permissions', 'reconnecting', 'reconnect_failed'].includes(diagnostics.connection.state);
  const reconnecting = diagnostics.connection.state === 'reconnecting';
  const registered = diagnostics.webhooks.registration.verified;
  const required = diagnostics.webhooks.registration.required;
  const syncStatus = diagnostics.synchronization.status === 'running' || diagnostics.synchronization.status === 'queued'
    ? 'in_progress'
    : ['completed', 'partial'].includes(diagnostics.synchronization.status)
      ? diagnostics.synchronization.status === 'partial' ? 'failed' : 'complete'
      : diagnostics.synchronization.status === 'failed' ? 'failed'
        : store.last_synced_at ? 'complete' : 'pending';
  const webhooksRunning = diagnostics.webhooks.topics.some(item => item.registration_status === 'registration_pending');
  const webhooksFailed = diagnostics.webhooks.topics.some(item => item.registration_status === 'registration_failed');
  const safeStore = { ...store };
  delete safeStore.access_token;
  return {
    ...safeStore,
    connection_status: connected ? 'connected' : 'disconnected',
    connection_state: diagnostics.connection.state,
    reconnect_eligible: diagnostics.diagnostic.reconnect_eligible,
    diagnostic: diagnostics.diagnostic,
    diagnostics,
    sync_status: syncStatus,
    monitoring_mode: !connected ? 'disconnected' : diagnostics.webhooks.registration.complete && syncStatus === 'complete' ? 'webhook_and_sync' : syncStatus === 'complete' ? 'sync_only_limited' : 'awaiting_verified_sync',
    webhooks_registered: store.platform === 'shopify' ? registered : null,
    webhooks_required: store.platform === 'shopify' ? required : null,
    webhook_details: store.platform === 'shopify' ? diagnostics.webhooks.topics.map(item => ({
      topic: item.topic,
      status: item.registration_status === 'registered_verified' ? 'registered' : item.registration_status === 'registration_pending' ? 'running' : item.registration_status === 'registration_failed' ? 'failed' : item.registration_status === 'missing' ? 'not_attempted' : 'unknown',
      registration_status: item.registration_status,
      delivery: item.delivery,
      error: item.last_error_code,
      last_verified_at: item.last_verified_at,
      attempt_count: registrations.find(row => row.topic === item.topic)?.attempt_count || 0,
      started_at: item.last_registration_attempt_at,
      completed_at: item.last_verified_at,
    })) : null,
    setup_status: !connected && !reconnecting ? 'disconnected'
      : webhooksRunning || syncStatus === 'in_progress' || reconnecting ? 'in_progress'
        : webhooksFailed || syncStatus === 'failed' || diagnostics.connection.state === 'needs_attention' ? 'failed'
          : !diagnostics.webhooks.registration.complete ? 'webhooks_pending' : syncStatus,
  };
}

exports.getStores = async (req, res, next) => {
  try {
    const membership = await requireMembership(prisma, req.user.id, req.user.tenantId);
    const organizationId = membership.organization_id;
    const stores = await prisma.stores.findMany({
      where: { organization_id: organizationId },
      select: {
        id: true, platform: true, shop_domain: true, status: true, access_token: true,
        installed_at: true, last_synced_at: true, updated_at: true,
        integration_state: true, integration_reason_code: true, integration_version: true,
        integration_changed_at: true, authorization_verified_at: true,
        initial_sync_status: true, current_sync_job_id: true, sync_started_at: true,
        sync_completed_at: true, sync_error_code: true, sync_attempt_count: true, recovery_status: true,
      },
    });
    const ids = stores.filter(store => store.platform === 'shopify').map(store => store.id);
    const [registrations, deliveries, syncRows, events] = await Promise.all([
      optionalRows(prisma.webhook_registrations, { where: { store_id: { in: ids } } }),
      optionalRows(prisma.webhook_deliveries, { where: { store_id: { in: ids } }, orderBy: { received_at: 'desc' }, take: 2000 }),
      optionalRows(prisma.store_sync_domain_states, { where: { store_id: { in: ids } } }),
      optionalRows(prisma.integration_lifecycle_events, { where: { store_id: { in: ids } }, orderBy: { observed_at: 'desc' }, take: 100 }),
    ]);
    const responseStores = stores.map(store => responseStore(
      store,
      registrations.filter(row => row.store_id === store.id),
      deliveries.filter(row => row.store_id === store.id),
      syncRows.filter(row => row.store_id === store.id),
      events.filter(row => row.store_id === store.id),
    ));
    // Task 213 — attach the backend-authoritative canonical contract to every
    // store. This is ADDITIVE and fail-safe: the list's contract is to return
    // the stores, so a canonical-evaluation failure degrades to
    // `integration_state: null` (UI renders `unknown` — never connected)
    // instead of failing the whole list. The dedicated /integration-states
    // endpoints stay strict (fail-closed 500) as the authoritative source.
    await attachCanonicalStates(responseStores, organizationId);
    return res.status(200).json({
      success: true,
      data: {
        schema_version: 'store-integration-list-v2',
        stores: responseStores,
      },
    });
  } catch (error) { next(error); }
};

async function attachCanonicalStates(responseStores, organizationId, now) {
  let byId = new Map();
  try {
    const states = await retrieveIntegrationStates({ organizationId, now });
    byId = new Map(states.map(state => [state.store.id, state]));
  } catch (error) {
    // Never leak secrets or raw error text through this log line.
    console.warn('store_list_canonical_state_attach_skipped', {
      service: 'revluma-api',
      reason: 'canonical_state_evaluation_failed',
      error_type: (error && error.constructor && error.constructor.name) || 'Error',
    });
  }
  for (const store of responseStores) {
    store.integration_state = byId.get(store.id) || null;
  }
}

exports.getIntegrationStates = async (req, res, next) => {
  try {
    const membership = await requireMembership(prisma, req.user.id, req.user.tenantId);
    const organizationId = membership.organization_id;
    const states = await retrieveIntegrationStates({ organizationId });
    for (const state of states) {
      const check = validateIntegrationState(state);
      if (!check.valid) {
        // Fail closed: never emit a malformed contract to the client.
        return res.status(500).json({ success: false, error: 'Integration state contract validation failed.' });
      }
    }
    return res.status(200).json({
      success: true,
      data: { contract_version: INTEGRATION_STATE_CONTRACT_VERSION, states },
    });
  } catch (error) {
    next(error);
  }
};

exports.getIntegrationState = async (req, res, next) => {
  try {
    const membership = await requireMembership(prisma, req.user.id, req.user.tenantId);
    const organizationId = membership.organization_id;
    const storeId = req.params.storeId;
    const state = await retrieveIntegrationStates({ organizationId, storeId });
    // A store id that does not belong to this organization resolves to
    // nothing: 404 with no existence leak (cross-tenant rejection).
    if (!state) {
      return res.status(404).json({ success: false, error: 'Store not found.' });
    }
    const check = validateIntegrationState(state);
    if (!check.valid) {
      return res.status(500).json({ success: false, error: 'Integration state contract validation failed.' });
    }
    return res.status(200).json({ success: true, data: state });
  } catch (error) {
    next(error);
  }
};

exports.getShopifyDiagnostics = async (req, res, next) => {
  try {
    const membership = await requireMembership(prisma, req.user.id, req.user.tenantId);
    const storeId = req.query.store_id;
    if (typeof storeId !== 'string' || !/^[0-9a-f-]{36}$/i.test(storeId)) {
      return res.status(400).json({ success: false, error: 'A valid store_id is required.' });
    }
    const store = await prisma.stores.findFirst({ where: { id: storeId, organization_id: membership.organization_id, platform: 'shopify' } });
    if (!store) return res.status(404).json({ success: false, error: 'Shopify store not found.' });
    const [registrations, deliveries, syncRows, events] = await Promise.all([
      prisma.webhook_registrations.findMany({ where: { store_id: store.id } }),
      prisma.webhook_deliveries.findMany({ where: { store_id: store.id }, orderBy: { received_at: 'desc' }, take: 2000 }),
      prisma.store_sync_domain_states.findMany({ where: { store_id: store.id } }),
      prisma.integration_lifecycle_events.findMany({ where: { store_id: store.id }, orderBy: { observed_at: 'desc' }, take: 10 }),
    ]);
    res.set('Cache-Control', 'no-store');
    return res.status(200).json({ success: true, data: buildIntegrationDiagnostics({ store, registrations, deliveries, syncRows, recentEvents: events }) });
  } catch (error) { next(error); }
};

exports._private = { responseStore, attachCanonicalStates, REQUIRED_SUBSCRIPTIONS };
