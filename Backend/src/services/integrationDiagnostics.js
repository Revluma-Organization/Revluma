'use strict';

const { REQUIRED_SUBSCRIPTIONS } = require('./shopifyWebhookTopics');
const { diagnosticFor, iso } = require('./integrationLifecycle');

const REQUIRED_INITIAL_RESOURCES = Object.freeze(['products', 'orders', 'abandoned_checkouts']);
const OPTIONAL_RESOURCES = Object.freeze(['customers', 'variants', 'inventory', 'locations', 'fulfillments', 'refunds']);
const TOPIC_TO_PATH = Object.fromEntries(REQUIRED_SUBSCRIPTIONS);

function registrationStatus(row) {
  if (!row) return 'missing';
  if (row.status === 'running') return 'registration_pending';
  if (row.status === 'failed') return 'registration_failed';
  if (!['active', 'succeeded'].includes(row.status)) return 'unknown';
  if (!row.last_verified_at) return 'verification_unavailable';
  if (!String(row.external_id || '').startsWith('gid://shopify/WebhookSubscription/')) return 'unknown';
  return 'registered_verified';
}

function latestDelivery(deliveries, topic) {
  const path = TOPIC_TO_PATH[topic];
  return deliveries.filter(row => row.provider === 'shopify' && String(row.topic).toLowerCase() === path)
    .sort((a, b) => Date.parse(b.received_at || 0) - Date.parse(a.received_at || 0));
}

function buildWebhookDiagnostics(registrations = [], deliveries = []) {
  const realRegistrations = registrations.filter(row => String(row.external_id || '').startsWith('gid://shopify/WebhookSubscription/'));
  let verified = 0;
  let remediation = 0;
  const topics = REQUIRED_SUBSCRIPTIONS.map(([topic, path]) => {
    const candidates = realRegistrations.filter(row => row.topic === topic)
      .sort((a, b) => Date.parse(b.last_verified_at || b.completed_at || 0) - Date.parse(a.last_verified_at || a.completed_at || 0));
    const row = candidates[0] || registrations.find(item => item.topic === topic && String(item.external_id).startsWith('setup-'));
    const status = registrationStatus(row);
    if (status === 'registered_verified' && row?.remediation_required !== true) verified += 1;
    const topicDeliveries = latestDelivery(deliveries, topic);
    const processed = topicDeliveries.filter(item => item.status === 'processed');
    const failed = topicDeliveries.filter(item => item.status === 'failed');
    const pending = topicDeliveries.filter(item => item.status === 'received');
    const needsRemediation = status !== 'registered_verified' || row?.remediation_required === true;
    if (needsRemediation) remediation += 1;
    return {
      topic,
      provider_subscription_id_present: Boolean(row && String(row.external_id).startsWith('gid://shopify/WebhookSubscription/')),
      required: true,
      registration_status: status,
      registered_at: iso(row?.created_at),
      last_registration_attempt_at: iso(row?.last_registration_attempt_at || row?.started_at),
      last_verified_at: iso(row?.last_verified_at),
      last_error_code: row?.last_error_code || null,
      remediation_required: needsRemediation,
      delivery: {
        status: failed.length ? 'processing_failed' : pending.length ? 'backlogged' : processed.length ? 'processed' : 'no_delivery_observed',
        last_received_at: iso(topicDeliveries[0]?.received_at),
        last_processed_at: iso(processed[0]?.processed_at),
        last_failed_at: iso(failed[0]?.failed_at || failed[0]?.received_at),
        failed_deliveries: failed.length,
        duplicate_deliveries: topicDeliveries.reduce((sum, item) => sum + (Number(item.duplicate_count) || 0), 0),
        retry_attempts: topicDeliveries.reduce((sum, item) => sum + Math.max(0, (Number(item.attempt_count) || 1) - 1), 0),
        backlog: pending.length,
        last_processing_latency_ms: processed[0]?.processing_latency_ms ?? null,
      },
      capability: path,
    };
  });
  return {
    registration: { verified, required: topics.length, remediation_required: remediation, complete: verified === topics.length },
    delivery: {
      status: topics.some(item => item.delivery.status === 'processing_failed') ? 'attention_required' : topics.some(item => item.delivery.status === 'backlogged') ? 'backlogged' : topics.some(item => item.delivery.last_processed_at) ? 'observed' : 'no_evidence',
      note: 'Registration and delivery are independent. No health percentage is inferred.',
    },
    topics,
  };
}

function buildSyncDiagnostics(store, rows = []) {
  const byDomain = new Map(rows.map(row => [row.domain, row]));
  const project = (domain, required) => {
    const row = byDomain.get(domain);
    return {
      resource: domain,
      required,
      status: row?.status || 'not_started',
      job_id: store.current_sync_job_id || null,
      started_at: iso(row?.last_attempted_at),
      completed_at: iso(row?.last_succeeded_at),
      last_successful_sync: iso(row?.last_succeeded_at),
      retrieved_record_count: row?.records_discovered ?? null,
      persisted_record_count: row ? (Number(row.records_inserted || 0) + Number(row.records_updated || 0)) : null,
      failed_record_count: ['failed', 'degraded'].includes(row?.status) && (row?.records_discovered || 0) > (row?.records_inserted || 0)
        ? Number(row.records_discovered) - Number(row.records_inserted || 0) : 0,
      pages_completed: row?.pages_completed ?? null,
      pagination_complete: row?.pagination_complete === true,
      checkpoint_available: Boolean(row?.checkpoint && Object.keys(row.checkpoint).length),
      coverage_period: row?.checkpoint?.coverage_period || null,
      error_code: row?.error_code || null,
      retry_eligible: !/NOT_GRANTED|ACCESS_DENIED|UNSUPPORTED/.test(String(row?.error_code || '')),
    };
  };
  const resources = [
    ...REQUIRED_INITIAL_RESOURCES.map(domain => project(domain, true)),
    ...OPTIONAL_RESOURCES.map(domain => project(domain, false)),
  ];
  const required = resources.filter(item => item.required);
  const allRequiredComplete = required.every(item => item.status === 'ok' && item.pagination_complete);
  const anyRequiredFailed = required.some(item => ['failed', 'degraded'].includes(item.status));
  return {
    status: store.initial_sync_status || 'not_started',
    job_id: store.current_sync_job_id || null,
    attempt_count: store.sync_attempt_count || 0,
    started_at: iso(store.sync_started_at),
    completed_at: iso(store.sync_completed_at),
    last_successful_sync: iso(store.last_synced_at),
    error_code: store.sync_error_code || null,
    recovery_status: store.recovery_status || 'not_required',
    required_resources_complete: allRequiredComplete,
    partial: anyRequiredFailed || resources.some(item => item.status === 'degraded'),
    completion_rule: 'Every required resource must have status=ok and complete pagination. Optional or explicitly unsupported resources never block completion.',
    resources,
  };
}

function legacyConnection(store) {
  if (!store) return { state: 'not_connected', reason: 'AUTHORIZATION_REQUIRED' };
  if (['inactive', 'deleted', 'disconnected', 'revoked'].includes(store.status) || !store.access_token) {
    return { state: 'disconnected', reason: store.status === 'revoked' ? 'AUTHORIZATION_REVOKED' : 'AUTHORIZATION_REQUIRED' };
  }
  if (store.integration_state === 'reconnecting' && store.integration_changed_at && Date.now() - new Date(store.integration_changed_at).getTime() > 10 * 60 * 1000) {
    return { state: 'reconnect_failed', reason: 'OAUTH_STATE_INVALID' };
  }
  return { state: store.integration_state && store.integration_state !== 'unknown' ? store.integration_state : 'connected', reason: store.integration_reason_code || 'CONNECTED' };
}

function buildIntegrationDiagnostics({ store, registrations = [], deliveries = [], syncRows = [], recentEvents = [] }) {
  const connection = legacyConnection(store);
  const webhooks = buildWebhookDiagnostics(registrations, deliveries);
  const synchronization = buildSyncDiagnostics(store, syncRows);
  let reason = connection.reason;
  if (connection.state === 'connected' && !webhooks.registration.complete) reason = 'WEBHOOK_REGISTRATION_FAILED';
  if (connection.state === 'connected' && ['failed', 'partial'].includes(synchronization.status)) reason = synchronization.status === 'partial' ? 'SYNC_PARTIAL' : 'SYNC_FAILED';
  const diagnostic = diagnosticFor(reason, { lastOccurrence: store.integration_changed_at });
  return {
    schema_version: 'shopify-integration-diagnostics-v1',
    store_id: store.id,
    shop_domain: store.shop_domain,
    connection: {
      state: connection.state,
      authorization: store.authorization_verified_at ? 'verified_at_recorded_time' : 'verification_unavailable',
      authorization_verified_at: iso(store.authorization_verified_at),
      version: store.integration_version || 0,
      changed_at: iso(store.integration_changed_at),
      note: 'A saved installation is not proof of current provider health. Live verification timestamps and independent webhook/sync evidence are reported separately.',
    },
    diagnostic,
    webhooks,
    synchronization,
    capabilities: {
      orders: synchronization.resources.find(item => item.resource === 'orders')?.status === 'ok' ? 'available' : 'limited',
      products: synchronization.resources.find(item => item.resource === 'products')?.status === 'ok' ? 'available' : 'limited',
      real_time_updates: webhooks.registration.complete ? 'configured' : 'limited',
    },
    recent_transitions: recentEvents.slice(0, 10).map(event => ({
      event_type: event.event_type, from_state: event.from_state, to_state: event.to_state,
      reason_code: event.reason_code, source: event.source, observed_at: iso(event.observed_at),
    })),
  };
}

module.exports = {
  REQUIRED_INITIAL_RESOURCES, buildWebhookDiagnostics, buildSyncDiagnostics,
  buildIntegrationDiagnostics, registrationStatus,
};
