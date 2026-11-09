'use strict';

const { requireMembership } = require('../utils/organizationContext');
const prisma = require('../configs/database').prisma;
const { REQUIRED_SUBSCRIPTIONS } = require('../services/shopifyWebhookService');
const { buildIntegrationDiagnostics } = require('../services/integrationDiagnostics');
const { diagnosticFor } = require('../services/integrationLifecycle');
const { INTEGRATION_STATE_CONTRACT_VERSION, retrieveIntegrationStates, validateIntegrationState } = require('../services/revIntegrationState');
const {
  PROGRESS_CONTRACT_VERSION,
  buildSyncProgress,
  validateSyncProgress,
} = require('../services/integrationProgress');
const { requestSyncRetry, loadStoreForRetry } = require('../services/integrationRetry');
// Task 218 — canonical business health (rev-business-health-v1) and the
// operational activity feed (rev-operational-activity-v1).
const { buildBusinessHealth, validateBusinessHealth } = require('../services/businessHealth');
const { fetchBusinessHealthBundle } = require('../services/businessHealthRepository');
const { buildOperationalActivity, validateOperationalActivity, LIMIT_DEFAULT, LIMIT_MAX } = require('../services/operationalActivity');
const { fetchOperationalActivityBundle } = require('../services/operationalActivityRepository');
const { CONTRACT_VERSION: JOURNEY_CONTRACT_VERSION, projectJourneyState, validateJourney } = require('../services/merchantJourney');

async function optionalRows(model, args) {
  if (!model?.findMany) return [];
  return model.findMany(args);
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
    const stores = await prisma.stores.findMany({
      where: { organization_id: membership.organization_id },
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
    let responseStores;
    try {
      const [registrations, deliveries, syncRows, events] = await Promise.all([
        optionalRows(prisma.webhook_registrations, { where: { store_id: { in: ids } } }),
        optionalRows(prisma.webhook_deliveries, { where: { store_id: { in: ids } }, orderBy: { received_at: 'desc' }, take: 2000 }),
        optionalRows(prisma.store_sync_domain_states, { where: { store_id: { in: ids } } }),
        optionalRows(prisma.integration_lifecycle_events, { where: { store_id: { in: ids } }, orderBy: { observed_at: 'desc' }, take: 100 }),
      ]);
      responseStores = stores.map(store => responseStore(
        store,
        registrations.filter(row => row.store_id === store.id),
        deliveries.filter(row => row.store_id === store.id),
        syncRows.filter(row => row.store_id === store.id),
        events.filter(row => row.store_id === store.id),
      ));
    } catch {
      responseStores = stores.map(store => {
        const safeStore = { ...store };
        delete safeStore.access_token;
        return {
          ...safeStore,
          connection_status: 'unknown', connection_state: 'unknown', setup_status: 'unknown', sync_status: 'unknown',
          diagnostic: diagnosticFor('BACKEND_FAILURE'),
          diagnostics: { evidence_status: 'unavailable', note: 'Integration evidence could not be loaded; no connection, webhook, or sync health is inferred.' },
        };
      });
    }
    await attachCanonicalStates(responseStores, membership.organization_id);
    return res.status(200).json({ success: true, data: { schema_version: 'store-integration-list-v2', stores: responseStores } });
  } catch (error) { next(error); }
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

// Attach the canonical rev-integration-state-v1 contract to each store, by
// id. The shallow connection_status/sync_status fields remain for backward
// compatibility, but the frontend must consume `integration_state` (the
// backend-authoritative model) and never re-derive status locally.
//
// This is ADDITIVE on the store-list endpoint: the list's contract is to
// return the stores, so a failure evaluating the canonical state degrades to
// `integration_state: null` (the UI renders that as `unknown` — fail-closed,
// never connected) instead of failing the whole list. The dedicated
// /integration-states endpoints stay strict (fail-closed 500) because they
// exist to be the authoritative state source.
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


// Task 225 — deterministic, refresh-safe onboarding/workspace projection.
// A store filter is optional, but is always scoped by the active membership.
exports.getMerchantJourney = async (req, res, next) => {
  try {
    const membership = await requireMembership(prisma, req.user.id, req.user.tenantId);
    const organizationId = membership.organization_id;
    const storeId = req.query.store_id;
    if (storeId !== undefined && (typeof storeId !== 'string' || !/^[0-9a-f-]{36}$/i.test(storeId))) {
      return res.status(400).json({ success: false, error: 'Invalid store_id.' });
    }
    const states = await retrieveIntegrationStates({ organizationId });
    const candidates = states.filter(state => state.store?.id);
    const selectedState = storeId ? candidates.find(state => state.store.id === storeId) :
      [...candidates].sort((a, b) => Date.parse(b.store.last_synced_at || b.store.installed_at || 0) - Date.parse(a.store.last_synced_at || a.store.installed_at || 0))[0];
    if (storeId && !selectedState) return res.status(404).json({ success: false, error: 'Store not found.' });
    const selected = selectedState ? projectJourneyState(selectedState) : {
      state: 'authenticated_setup_required', reason: 'no_shopify_store', store: null,
      title: 'Connect your Shopify store', explanation: 'Authorize read-only Shopify access to start gathering your store evidence.',
      next_route: '/dashboard/integrations', can_enter_workspace: false, required_resources: [], limited_capabilities: [],
      authorization: { verified: false, verification: 'not_installed' }, synchronization: { state: 'unknown', last_succeeded_at: null },
    };
    const payload = {
      contract_version: JOURNEY_CONTRACT_VERSION, organization_id: organizationId,
      selected_store_id: selected.store?.id || null, selected,
      stores: candidates.map(state => {
        const projected = projectJourneyState(state);
        return { id: state.store.id, shop_domain: state.store.shop_domain, state: projected.state,
          can_enter_workspace: projected.can_enter_workspace, last_synced_at: state.store.last_synced_at };
      }),
      evaluated_at: new Date().toISOString(), source: 'rev-integration-state-v1',
    };
    const check = validateJourney(payload);
    if (!check.valid) return res.status(500).json({ success: false, error: 'Merchant journey contract validation failed.' });
    res.set('Cache-Control', 'no-store');
    return res.status(200).json({ success: true, data: payload });
  } catch (error) { next(error); }
};

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

// Task 215 — authoritative sync-progress contract (rev-sync-progress-v1).
// Tenant-scoped, fail-closed: a malformed contract is a 500, never emitted.
exports.getSyncProgress = async (req, res, next) => {
  try {
    const membership = await requireMembership(prisma, req.user.id, req.user.tenantId);
    const organizationId = membership.organization_id;
    const store = await loadStoreForRetry(prisma, organizationId, req.params.storeId);
    if (!store) {
      return res.status(404).json({ success: false, error: 'Shopify store not found.' });
    }
    const domainRows = await prisma.store_sync_domain_states
      .findMany({ where: { store_id: store.id } })
      .catch(() => []);
    const progress = buildSyncProgress({ store, domainRows });
    const problems = validateSyncProgress(progress);
    if (problems.length > 0) {
      console.warn('sync_progress_contract_invalid', { store_id: store.id, problems });
      return res.status(500).json({ success: false, error: 'Sync progress contract validation failed.' });
    }
    res.set('Cache-Control', 'no-store');
    return res.status(200).json({ success: true, data: progress });
  } catch (error) { next(error); }
};

// Task 215 — idempotent, tenant-scoped manual sync-retry. The service enforces
// ownership, deterministic eligibility, and DB-level dedup/idempotency. The
// actual sync is started fire-and-forget AFTER the service returns (202).
exports.requestSyncRetry = async (req, res, next) => {
  try {
    const membership = await requireMembership(prisma, req.user.id, req.user.tenantId);
    const organizationId = membership.organization_id;
    const scope = req.body?.scope === undefined ? 'all' : req.body.scope;
    const requestKey = req.body?.request_key ?? req.headers['idempotency-key'] ?? null;
    const result = await requestSyncRetry({
      db: prisma, organizationId, storeId: req.params.storeId, scope, requestKey,
    });
    if (!result.ok) {
      return res.status(result.httpStatus).json({ success: false, error: result.error, data: result.data || null });
    }
    if (result.data.started) {
      // Start the sync AFTER the transaction committed. Never await it (the
      // client polls sync-progress); never let a sync failure 500 the accepted
      // request. The engine's own distributed lock guards a live run.
      const { syncShopifyStore } = require('../services/shopifySync');
      const store = await loadStoreForRetry(prisma, organizationId, req.params.storeId).catch(() => null);
      if (store) {
        syncShopifyStore(store, { reconcileWebhooks: false }).catch((error) => {
          console.warn('sync_retry_execution_failed', { store_id: store.id, error_type: error?.code || error?.name });
        });
      }
    }
    return res.status(202).json({ success: true, data: result.data });
  } catch (error) { next(error); }
};

// Task 218 — canonical business health (rev-business-health-v1). Tenant- and
// store-scoped, read-only, fail-closed: a malformed contract is a 500, never
// emitted. Business severity is independent of data quality; a failing sync is
// reflected in the affected indicators' data_quality, not by erasing history.
exports.getBusinessHealth = async (req, res, next) => {
  try {
    const membership = await requireMembership(prisma, req.user.id, req.user.tenantId);
    const organizationId = membership.organization_id;
    const storeId = req.params.storeId;
    const bundle = await fetchBusinessHealthBundle(prisma, organizationId, storeId);
    if (!bundle) {
      return res.status(404).json({ success: false, error: 'Store not found.' });
    }
    const health = buildBusinessHealth(bundle);
    const problems = validateBusinessHealth(health);
    if (problems.length > 0) {
      console.warn('business_health_contract_invalid', { store_id: bundle.store.id, problems });
      return res.status(500).json({ success: false, error: 'Business health contract validation failed.' });
    }
    res.set('Cache-Control', 'no-store');
    return res.status(200).json({ success: true, data: health });
  } catch (error) { next(error); }
};

// Task 218 — operational activity feed (rev-operational-activity-v1).
// Tenant- and store-scoped, read-only, persisted + deduped + occurrence-ordered,
// keyset-paginated, fail-closed.
exports.getOperationalActivity = async (req, res, next) => {
  try {
    const membership = await requireMembership(prisma, req.user.id, req.user.tenantId);
    const organizationId = membership.organization_id;
    const storeId = req.params.storeId;
    const bundle = await fetchOperationalActivityBundle(prisma, organizationId, storeId);
    if (!bundle) {
      return res.status(404).json({ success: false, error: 'Store not found.' });
    }
    const parsedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(LIMIT_MAX, parsedLimit)) : LIMIT_DEFAULT;
    const cursor = typeof req.query.cursor === 'string' && req.query.cursor ? req.query.cursor : null;
    const activity = buildOperationalActivity(bundle, new Date(), { limit, cursor });
    const problems = validateOperationalActivity(activity);
    if (problems.length > 0) {
      console.warn('operational_activity_contract_invalid', { store_id: bundle.store.id, problems });
      return res.status(500).json({ success: false, error: 'Operational activity contract validation failed.' });
    }
    res.set('Cache-Control', 'no-store');
    return res.status(200).json({ success: true, data: activity });
  } catch (error) { next(error); }
};

exports._private = { responseStore, REQUIRED_SUBSCRIPTIONS };
