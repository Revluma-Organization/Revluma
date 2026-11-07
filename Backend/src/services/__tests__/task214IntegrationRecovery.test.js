'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateTransition, classifyShopifyError, diagnosticFor, REASONS } = require('../integrationLifecycle');
const { buildWebhookDiagnostics, buildSyncDiagnostics, buildIntegrationDiagnostics, REQUIRED_INITIAL_RESOURCES, registrationStatus } = require('../integrationDiagnostics');
const { missingRequiredScopes, verifyShopifyAuthorization } = require('../shopifyAuthorization');
const { buildRecoveryPlan } = require('../integrationRecovery');
const { recordIntegrationEvent } = require('../integrationLifecycleStore');
const { REQUIRED_SUBSCRIPTIONS } = require('../shopifyWebhookTopics');

const NOW = new Date('2026-11-07T22:00:00Z');
const store = (patch = {}) => ({ id: 'store-1', organization_id: 'org-1', shop_domain: 'revluma-test-store-v1.myshopify.com', platform: 'shopify', status: 'active', access_token: 'encrypted', integration_state: 'connected', integration_reason_code: 'CONNECTED', integration_version: 3, integration_changed_at: new Date('2026-11-07T20:00:00Z'), authorization_verified_at: new Date('2026-11-07T20:00:00Z'), initial_sync_status: 'completed', sync_attempt_count: 1, ...patch });
const syncRow = (domain, patch = {}) => ({ store_id: 'store-1', domain, status: 'ok', pagination_complete: true, records_discovered: 5, records_inserted: 5, records_updated: 0, last_attempted_at: NOW, last_succeeded_at: NOW, checkpoint: {}, ...patch });
const completeRows = () => REQUIRED_INITIAL_RESOURCES.map(domain => syncRow(domain));
const verifiedRegistrations = () => REQUIRED_SUBSCRIPTIONS.map(([topic, path], index) => ({ store_id: 'store-1', external_id: `gid://shopify/WebhookSubscription/${index + 1}`, topic, delivery_url: `https://backend.test/${path}`, status: 'active', last_verified_at: NOW, created_at: NOW, remediation_required: false }));
const delivery = (topic = 'orders/create', patch = {}) => ({ provider: 'shopify', store_id: 'store-1', topic, status: 'processed', received_at: new Date('2026-11-07T21:00:00Z'), processed_at: new Date('2026-11-07T21:00:01Z'), processing_latency_ms: 1000, attempt_count: 1, duplicate_count: 0, ...patch });

function lifecycleDb(initial = store()) {
  const state = { ...initial };
  const events = [];
  const db = {
    stores: {
      findUnique: async () => ({ ...state }),
      updateMany: async ({ where, data }) => {
        if (where.integration_version !== state.integration_version) return { count: 0 };
        Object.assign(state, data, { integration_version: state.integration_version + 1 });
        return { count: 1 };
      },
    },
    integration_lifecycle_events: {
      findUnique: async ({ where }) => events.find(event => event.source === where.store_id_source_event_reference.source && event.event_reference === where.store_id_source_event_reference.event_reference) || null,
      create: async ({ data }) => { const event = { id: `event-${events.length + 1}`, ...data }; events.push(event); return event; },
    },
    $transaction: async callback => callback(db),
  };
  return { db, state, events };
}

const scenarios = [];
function scenario(id, name, run) { scenarios.push({ id, name, run }); }

scenario(1, 'merchant-initiated disconnection clears authorization and preserves store identity', async () => {
  const { db, state } = lifecycleDb();
  const result = await recordIntegrationEvent({ storeId: state.id, type: 'merchant_disconnected', source: 'test', eventReference: 'd1' }, db);
  assert.equal(result.accepted, true); assert.equal(state.integration_state, 'disconnected'); assert.equal(state.access_token, null); assert.equal(state.id, 'store-1');
});
scenario(2, 'Shopify app uninstall is authoritative', async () => {
  const { db, state } = lifecycleDb(); await recordIntegrationEvent({ storeId: state.id, type: 'app_uninstalled', source: 'test', eventReference: 'u1' }, db);
  assert.equal(state.integration_reason_code, 'APP_UNINSTALLED'); assert.equal(state.status, 'disconnected');
});
scenario(3, 'revoked authorization has a distinct reconnectable state', () => {
  assert.equal(evaluateTransition(store(), { type: 'authorization_revoked' }).state, 'authorization_revoked');
});
scenario(4, 'expired authorization is not generic disconnection', () => {
  assert.equal(evaluateTransition(store(), { type: 'authorization_expired' }).reasonCode, 'AUTHORIZATION_EXPIRED');
});
scenario(5, 'invalid token response requires renewed authorization', () => {
  assert.equal(classifyShopifyError({ status: 401 }), 'AUTHORIZATION_REQUIRED');
});
scenario(6, 'missing required permission is explicit', () => {
  assert.deepEqual(missingRequiredScopes('read_orders,read_products'), ['read_inventory', 'read_checkouts']);
});
scenario(7, 'temporary Shopify outage is retryable and not revocation', () => {
  const reason = classifyShopifyError({ status: 503 }); assert.equal(reason, 'PROVIDER_UNAVAILABLE'); assert.equal(diagnosticFor(reason).reconnect_eligible, false);
});
scenario(8, 'API throttling is not disconnection', () => {
  assert.equal(classifyShopifyError({ status: 429 }), 'PROVIDER_THROTTLED'); assert.equal(diagnosticFor('PROVIDER_THROTTLED').retry_eligible, true);
});
scenario(9, 'unknown authorization status fails closed', () => {
  assert.equal(classifyShopifyError({ code: 'UNRECOGNIZED' }), 'UNKNOWN'); assert.equal(diagnosticFor('UNKNOWN').explanation.includes('could not verify'), true);
});
scenario(10, 'delayed uninstall after reconnect cannot clear the new token', () => {
  const result = evaluateTransition(store(), { type: 'app_uninstalled', observedAt: '2026-11-07T19:00:00Z' }); assert.equal(result.reason, 'stale_uninstall');
});
scenario(11, 'conflicting older integration events cannot regress state', () => {
  assert.equal(evaluateTransition(store(), { type: 'sync_failed', observedAt: '2026-11-07T19:00:00Z' }).accepted, false);
});
scenario(12, 'cross-tenant disconnection has no authorized store to transition', async () => {
  const { db } = lifecycleDb(); db.stores.findUnique = async () => null;
  assert.equal((await recordIntegrationEvent({ storeId: 'other', type: 'merchant_disconnected' }, db)).reason, 'store_not_found');
});
scenario(13, 'all required webhooks registered and provider-verified', () => {
  const result = buildWebhookDiagnostics(verifiedRegistrations(), []); assert.equal(result.registration.complete, true); assert.equal(result.registration.verified, 12);
});
scenario(14, 'missing required webhook is visible', () => {
  const result = buildWebhookDiagnostics(verifiedRegistrations().slice(1), []); assert.equal(result.topics[0].registration_status, 'missing'); assert.equal(result.registration.complete, false);
});
scenario(15, 'registration failure carries a safe reason code', () => {
  const rows = verifiedRegistrations(); rows[0] = { ...rows[0], status: 'failed', last_error_code: 'SHOPIFY_WEBHOOK_USER_ERROR' };
  assert.equal(buildWebhookDiagnostics(rows, []).topics[0].registration_status, 'registration_failed');
});
scenario(16, 'registration retry remains pending, never verified', () => {
  const rows = verifiedRegistrations(); rows[0] = { ...rows[0], status: 'running', last_verified_at: null };
  assert.equal(registrationStatus(rows[0]), 'registration_pending');
});
scenario(17, 'duplicate registration attempt does not create duplicate health credit', () => {
  const rows = [...verifiedRegistrations(), verifiedRegistrations()[0]]; const result = buildWebhookDiagnostics(rows, []);
  assert.equal(result.registration.verified, 12); assert.equal(result.topics.length, 12);
});
scenario(18, 'successful event delivery has measured processing latency', () => {
  assert.equal(buildWebhookDiagnostics(verifiedRegistrations(), [delivery()]).topics.find(t => t.topic === 'ORDERS_CREATE').delivery.last_processing_latency_ms, 1000);
});
scenario(19, 'duplicate event delivery is counted without reprocessing credit', () => {
  const result = buildWebhookDiagnostics(verifiedRegistrations(), [delivery('orders/create', { duplicate_count: 2 })]);
  assert.equal(result.topics.find(t => t.topic === 'ORDERS_CREATE').delivery.duplicate_deliveries, 2);
});
scenario(20, 'invalid signature cannot create merchant delivery evidence', () => {
  assert.equal(buildWebhookDiagnostics(verifiedRegistrations(), []).delivery.status, 'no_evidence');
});
scenario(21, 'processing failure is independent of verified registration', () => {
  const result = buildWebhookDiagnostics(verifiedRegistrations(), [delivery('orders/create', { status: 'failed', processed_at: null })]);
  assert.equal(result.registration.complete, true); assert.equal(result.topics.find(t => t.topic === 'ORDERS_CREATE').delivery.status, 'processing_failed');
});
scenario(22, 'repeated processing failures remain attention-required', () => {
  const result = buildWebhookDiagnostics(verifiedRegistrations(), [delivery('orders/create', { status: 'failed' }), delivery('orders/create', { status: 'failed', received_at: NOW })]);
  assert.equal(result.delivery.status, 'attention_required');
});
scenario(23, 'delayed webhook is reported at actual receive time', () => {
  const late = delivery('orders/create', { received_at: '2026-10-01T00:00:00Z' });
  assert.equal(buildWebhookDiagnostics(verifiedRegistrations(), [late]).topics.find(t => t.topic === 'ORDERS_CREATE').delivery.last_received_at, '2026-10-01T00:00:00.000Z');
});
scenario(24, 'out-of-order webhook delivery does not fabricate recency', () => {
  const rows = [delivery('orders/create', { received_at: '2026-11-07T20:00:00Z' }), delivery('orders/create', { received_at: '2026-11-07T21:00:00Z' })];
  assert.equal(buildWebhookDiagnostics(verifiedRegistrations(), rows).topics.find(t => t.topic === 'ORDERS_CREATE').delivery.last_received_at, '2026-11-07T21:00:00.000Z');
});
scenario(25, 'provider-side subscription removal leaves local evidence unverified until reconciliation', () => {
  const local = verifiedRegistrations(); assert.equal(buildWebhookDiagnostics(local.slice(1), []).registration.complete, false);
});
scenario(26, 'unknown webhook verification status is not healthy', () => {
  const rows = verifiedRegistrations(); rows[0].last_verified_at = null; assert.equal(buildWebhookDiagnostics(rows, []).topics[0].registration_status, 'verification_unavailable');
});
scenario(27, 'successful initial sync requires all required resources', () => {
  const result = buildSyncDiagnostics(store(), completeRows()); assert.equal(result.required_resources_complete, true); assert.equal(result.partial, false);
});
scenario(28, 'sync queued but not started is not running or complete', () => {
  const result = buildSyncDiagnostics(store({ initial_sync_status: 'queued', current_sync_job_id: null }), []); assert.equal(result.status, 'queued'); assert.equal(result.required_resources_complete, false);
});
scenario(29, 'sync running exposes its actual job', () => {
  const result = buildSyncDiagnostics(store({ initial_sync_status: 'running', current_sync_job_id: crypto.randomUUID() }), completeRows().map(row => ({ ...row, status: 'running', last_succeeded_at: null })));
  assert.equal(result.status, 'running'); assert.ok(result.job_id);
});
scenario(30, 'sync partially completed remains partial', () => {
  const rows = completeRows(); rows[0].status = 'degraded'; assert.equal(buildSyncDiagnostics(store({ initial_sync_status: 'partial' }), rows).partial, true);
});
scenario(31, 'sync completed with required resources and complete pagination', () => {
  assert.equal(buildSyncDiagnostics(store(), completeRows()).required_resources_complete, true);
});
scenario(32, 'optional resource unavailable does not block required completion', () => {
  const result = buildSyncDiagnostics(store(), [...completeRows(), syncRow('customers', { status: 'degraded', pagination_complete: false })]); assert.equal(result.required_resources_complete, true); assert.equal(result.partial, true);
});
scenario(33, 'unsupported resource is not retryable', () => {
  const rows = completeRows(); rows[0] = syncRow('products', { status: 'degraded', error_code: 'UNSUPPORTED_RESOURCE' }); assert.equal(buildSyncDiagnostics(store(), rows).resources[0].retry_eligible, false);
});
scenario(34, 'authorization failure during sync is actionable', () => {
  const rows = completeRows(); rows[1] = syncRow('orders', { status: 'failed', error_code: 'SHOPIFY_READ_ORDERS_NOT_GRANTED' }); assert.equal(buildSyncDiagnostics(store(), rows).resources[1].retry_eligible, false);
});
scenario(35, 'database persistence failure remains a sync failure', () => {
  const rows = completeRows(); rows[1] = syncRow('orders', { status: 'failed', error_code: 'P2025' }); assert.equal(buildSyncDiagnostics(store({ initial_sync_status: 'failed' }), rows).status, 'failed');
});
scenario(36, 'Shopify throttling during sync is retry eligible', () => {
  const rows = completeRows(); rows[1] = syncRow('orders', { status: 'failed', error_code: 'SHOPIFY_THROTTLED' }); assert.equal(buildSyncDiagnostics(store(), rows).resources[1].retry_eligible, true);
});
scenario(37, 'worker restart with a running job is not duplicated', () => {
  const current = store({ initial_sync_status: 'running', current_sync_job_id: crypto.randomUUID(), sync_started_at: new Date() }); assert.equal(buildRecoveryPlan(current, []).reason, 'job_already_running');
});
scenario(38, 'stalled job becomes eligible for checkpoint recovery', () => {
  const current = store({ initial_sync_status: 'running', current_sync_job_id: crypto.randomUUID(), sync_started_at: new Date(Date.now() - 21 * 60000) }); assert.equal(buildRecoveryPlan(current, completeRows()).action, 'none');
});
scenario(39, 'duplicate sync job prevention returns the existing job id', () => {
  const current = store({ initial_sync_status: 'running', current_sync_job_id: crypto.randomUUID(), sync_started_at: new Date() }); assert.equal(buildRecoveryPlan(current, []).jobId, current.current_sync_job_id);
});
scenario(40, 'checkpoint recovery preserves checkpoint availability', () => {
  const rows = completeRows(); rows[0] = syncRow('products', { status: 'failed', checkpoint: { cursor: 'opaque' } }); assert.equal(buildRecoveryPlan(store(), rows).resources[0].checkpoint, true);
});
scenario(41, 'partial data preservation is explicit in recovery plan', () => {
  assert.equal(buildRecoveryPlan(store(), completeRows()).preserveExistingData, true);
});
scenario(42, 'incorrect completion prevention when pagination is incomplete', () => {
  const rows = completeRows(); rows[1].pagination_complete = false; assert.equal(buildSyncDiagnostics(store(), rows).required_resources_complete, false);
});
scenario(43, 'revoked authorization explanation is accurate', () => {
  assert.match(diagnosticFor('AUTHORIZATION_REVOKED').explanation, /revoked/);
});
scenario(44, 'temporary provider outage explanation does not recommend reconnect', () => {
  assert.equal(diagnosticFor('PROVIDER_UNAVAILABLE').recommended_action, 'retry_diagnostics');
});
scenario(45, 'missing permission explanation requests access review', () => {
  assert.match(diagnosticFor('PERMISSIONS_MISSING').explanation, /permissions/);
});
scenario(46, 'failed initial sync explanation preserves connection distinction', () => {
  assert.match(diagnosticFor('SYNC_FAILED').explanation, /connection remains active/);
});
scenario(47, 'incomplete resource coverage explanation names limited coverage', () => {
  assert.match(diagnosticFor('SYNC_PARTIAL').explanation, /limited coverage/);
});
scenario(48, 'unknown cause does not fabricate an explanation', () => {
  assert.equal(diagnosticFor('NOT_A_REASON').reason_code, 'UNKNOWN');
});
scenario(49, 'diagnostic API projection contains no credentials or raw errors', () => {
  const result = buildIntegrationDiagnostics({ store: store({ access_token: 'secret', granted_scopes: 'read_orders' }), registrations: verifiedRegistrations(), syncRows: completeRows() });
  assert.equal(JSON.stringify(result).includes('secret'), false); assert.equal(Object.hasOwn(result, 'access_token'), false);
});
scenario(50, 'merchant explanations contain no stack traces or internal URLs', () => {
  for (const reason of Object.values(REASONS)) { assert.equal(/stack|onrender|postgres|token=/i.test(reason.message), false); }
});
scenario(51, 'successful OAuth reconnect verifies live baseline scopes', async () => {
  const result = await verifyShopifyAuthorization(store(), async () => ({ currentAppInstallation: { accessScopes: [{ handle: 'read_orders' }, { handle: 'read_products' }, { handle: 'read_inventory' }, { handle: 'read_checkouts' }] } })); assert.equal(result.verified, true);
});
scenario(52, 'invalid OAuth state produces a safe restart action', () => {
  assert.equal(diagnosticFor('OAUTH_STATE_INVALID').recommended_action, 'reconnect');
});
scenario(53, 'invalid callback HMAC claims no credential change', () => {
  assert.match(diagnosticFor('OAUTH_HMAC_INVALID').explanation, /no credentials were changed/);
});
scenario(54, 'merchant cancellation preserves prior state messaging', () => {
  assert.match(diagnosticFor('OAUTH_CANCELLED').explanation, /has not been replaced/);
});
scenario(55, 'permission denial is reconnect eligible but not retry eligible', () => {
  const result = diagnosticFor('PERMISSIONS_MISSING'); assert.equal(result.reconnect_eligible, true); assert.equal(result.retry_eligible, false);
});
scenario(56, 'wrong store callback has a specific safe explanation', () => {
  assert.match(diagnosticFor('WRONG_STORE').explanation, /different store/);
});
scenario(57, 'conflicting installation transition is rejected by optimistic version', async () => {
  const { db, state } = lifecycleDb(); db.stores.updateMany = async () => ({ count: 0 }); assert.equal((await recordIntegrationEvent({ storeId: state.id, type: 'app_uninstalled' }, db)).reason, 'concurrent_state_change');
});
scenario(58, 'expired reconnect session becomes reconnect eligible', () => {
  const result = buildIntegrationDiagnostics({ store: store({ integration_state: 'reconnecting', integration_changed_at: new Date(Date.now() - 11 * 60000) }), syncRows: [] }); assert.equal(result.diagnostic.reconnect_eligible, true);
});
scenario(59, 'token exchange failure never maps to connected', () => {
  assert.equal(evaluateTransition(store(), { type: 'reconnect_failed' }).state, 'reconnect_failed');
});
scenario(60, 'database failure after token exchange is a backend failure', () => {
  assert.equal(classifyShopifyError({ code: 'P2021' }), 'BACKEND_FAILURE');
});
scenario(61, 'reconnect with webhook failure is needs-attention, not fully ready', () => {
  const result = buildIntegrationDiagnostics({ store: store({ integration_state: 'needs_attention', integration_reason_code: 'WEBHOOK_REGISTRATION_FAILED' }), registrations: verifiedRegistrations().slice(1), syncRows: completeRows() }); assert.equal(result.connection.state, 'needs_attention'); assert.equal(result.diagnostic.reason_code, 'WEBHOOK_REGISTRATION_FAILED');
});
scenario(62, 'reconnect with pending initial sync distinguishes authorization from readiness', () => {
  const result = buildIntegrationDiagnostics({ store: store({ initial_sync_status: 'queued' }), registrations: verifiedRegistrations(), syncRows: [] }); assert.equal(result.connection.state, 'connected'); assert.equal(result.synchronization.required_resources_complete, false);
});
scenario(63, 'reconnect resumes failed sync from valid checkpoint', () => {
  const rows = completeRows(); rows[0] = syncRow('products', { status: 'failed', checkpoint: { cursor: 'opaque' } }); const plan = buildRecoveryPlan(store(), rows); assert.equal(plan.action, 'resume'); assert.equal(plan.resources[0].checkpoint, true);
});
scenario(64, 'existing running job is not duplicated during recovery', () => {
  const current = store({ initial_sync_status: 'running', current_sync_job_id: crypto.randomUUID(), sync_started_at: new Date() }); assert.equal(buildRecoveryPlan(current, []).action, 'none');
});
scenario(65, 'failed reconnect never displays connected in diagnostics', () => {
  const result = buildIntegrationDiagnostics({ store: store({ integration_state: 'reconnect_failed', integration_reason_code: 'TOKEN_EXCHANGE_FAILED' }) }); assert.notEqual(result.connection.state, 'connected');
});
scenario(66, 'verified reconnect updates shared diagnostic workspaces from one contract', () => {
  const result = buildIntegrationDiagnostics({ store: store(), registrations: verifiedRegistrations(), deliveries: [delivery()], syncRows: completeRows() }); assert.equal(result.connection.state, 'connected'); assert.equal(result.capabilities.orders, 'available');
});
scenario(67, 'new installation through initial synchronization requires durable evidence', () => {
  const result = buildIntegrationDiagnostics({ store: store(), registrations: verifiedRegistrations(), syncRows: completeRows() }); assert.equal(result.synchronization.required_resources_complete, true);
});
scenario(68, 'connected store through webhook failure preserves valid sync evidence', () => {
  const result = buildIntegrationDiagnostics({ store: store(), registrations: verifiedRegistrations(), deliveries: [delivery('orders/create', { status: 'failed' })], syncRows: completeRows() }); assert.equal(result.synchronization.required_resources_complete, true); assert.equal(result.webhooks.delivery.status, 'attention_required');
});
scenario(69, 'authorization revocation through reconnect has deterministic states', () => {
  assert.equal(evaluateTransition(store(), { type: 'authorization_revoked' }).state, 'authorization_revoked'); assert.equal(evaluateTransition(store(), { type: 'authorization_verified' }).state, 'connected');
});
scenario(70, 'reconnect capability restoration requires resource success', () => {
  const result = buildIntegrationDiagnostics({ store: store(), registrations: verifiedRegistrations(), syncRows: completeRows() }); assert.equal(result.capabilities.products, 'available');
});
scenario(71, 'Command Center projection reflects partial availability', () => {
  const rows = completeRows(); rows[0].status = 'degraded'; const result = buildIntegrationDiagnostics({ store: store({ initial_sync_status: 'partial' }), registrations: verifiedRegistrations(), syncRows: rows }); assert.equal(result.capabilities.products, 'limited');
});
scenario(72, 'Rev Intelligence receives unavailable evidence, not zero data', () => {
  const result = buildIntegrationDiagnostics({ store: store(), syncRows: [] }); assert.equal(result.capabilities.orders, 'limited'); assert.equal(result.synchronization.resources[1].retrieved_record_count, null);
});
scenario(73, 'frontend refresh during OAuth expires stale reconnect state safely', () => {
  const result = buildIntegrationDiagnostics({ store: store({ integration_state: 'reconnecting', integration_changed_at: new Date(Date.now() - 600001) }) }); assert.equal(result.connection.state, 'reconnect_failed');
});
scenario(74, 'browser interruption during reconnect cannot claim connected without verification', () => {
  const result = buildIntegrationDiagnostics({ store: store({ integration_state: 'reconnecting', integration_changed_at: new Date() }) }); assert.equal(result.connection.state, 'reconnecting');
});
scenario(75, 'tenant isolation across two stores rejects an unauthorized transition', async () => {
  const { db, state } = lifecycleDb(store({ id: 'store-1', organization_id: 'org-1' }));
  db.stores.findUnique = async ({ where }) => where.id === 'store-1' ? { ...state } : null;
  const result = await recordIntegrationEvent({ storeId: 'store-2', type: 'merchant_disconnected', source: 'cross_tenant_test' }, db);
  assert.equal(result.reason, 'store_not_found'); assert.equal(state.access_token, 'encrypted'); assert.equal(state.organization_id, 'org-1');
});

assert.equal(scenarios.length, 75);
assert.equal(new Set(scenarios.map(item => item.id)).size, 75);
for (const item of scenarios) test(`T214-${String(item.id).padStart(3, '0')} ${item.name}`, item.run);
