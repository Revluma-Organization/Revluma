'use strict';

/**
 * Data health engine (rev-data-health-v1).
 *
 * The shared source of truth for "what does Revluma actually know about this
 * store's data right now". Integrations, the sync engine, the permission
 * manager and Rev all read this one evaluation, so they cannot disagree.
 *
 * Every resource (sync domain) lands in exactly one state:
 *
 *   complete      synced, pagination complete, fresh
 *   incomplete    partially retrieved, or a sync is filling it in now
 *   stale         previously synced, but the latest data is older than the
 *                 freshness window or the most recent refresh failed
 *   unavailable   never successfully retrieved (not yet, or retrieval failed)
 *   unauthorized  needs a Shopify permission the store has not granted, or the
 *                 connection itself is no longer authorized
 *   unsupported   Shopify does not offer it to this app / plan
 *
 * Materiality (from permissionRegistry) decides consequences. Only `core`
 * resources (orders, checkouts, products, inventory) can make the store's
 * overall health degraded; an unauthorized or unsupported `extended` resource
 * (e.g. URL redirects) is a disclosed limitation, never a "sync failure".
 *
 * This module is PURE except for loadDataHealth(). It never invents
 * timestamps, counts or causes: everything is derived from ledger rows, the
 * store row, granted scopes and recorded recovery work.
 */

const permissions = require('./permissionRegistry');
const {
  RESOURCE_STATUS, COVERAGE, FAILURE_CLASS, toCanonicalStatus,
} = require('./syncStateContract');

const CONTRACT_VERSION = 'rev-data-health-v1';
const STATE = Object.freeze({
  COMPLETE: 'complete',
  INCOMPLETE: 'incomplete',
  STALE: 'stale',
  UNAVAILABLE: 'unavailable',
  UNAUTHORIZED: 'unauthorized',
  UNSUPPORTED: 'unsupported',
});
const STATE_VALUES = Object.freeze(Object.values(STATE));
// Worst first. Unsupported is not "bad" — nothing can be done — so it never
// drives the overall state.
const SEVERITY = Object.freeze({
  unauthorized: 5, unavailable: 4, incomplete: 3, stale: 2, complete: 1, unsupported: 0,
});
const OVERALL = Object.freeze({
  HEALTHY: 'healthy',
  HEALTHY_WITH_LIMITATIONS: 'healthy_with_limitations',
  SYNCING: 'syncing',
  RECOVERING: 'recovering',
  DEGRADED: 'degraded',
  ACTION_REQUIRED: 'action_required',
  DISCONNECTED: 'disconnected',
});

const DEFAULT_STALE_MS = 6 * 60 * 60 * 1000;
const ACTIVE_SYNC_WINDOW_MS = 20 * 60 * 1000;
const RUNNING_STATUSES = new Set(['queued', 'starting', 'running', 'retrying']);
const DISCONNECTED_STATES = new Set(['uninstalled', 'authorization_revoked', 'authorization_expired', 'disconnected', 'invalid']);

function staleWindowMs() {
  const configured = Number.parseInt(process.env.DATA_HEALTH_STALE_MS || '', 10);
  return Number.isFinite(configured) && configured >= 15 * 60 * 1000 ? configured : DEFAULT_STALE_MS;
}

function toMs(value) {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function iso(value) {
  const ms = toMs(value);
  return ms == null ? null : new Date(ms).toISOString();
}

let collectedCache = null;
function notCollected(domain) {
  if (!collectedCache) {
    const { byDomain } = require('./domainCatalog');
    const { authorizedResourceIds } = require('./authorizedResourceCatalog');
    const authorized = new Set(authorizedResourceIds());
    collectedCache = (name) => byDomain(name)?.implementation === 'not_implemented' && !authorized.has(name);
  }
  return collectedCache(domain);
}

function storeConnection(store) {
  if (!store) return { connected: false, reason: 'store_missing' };
  if (store.status === 'deleted' || store.status === 'uninstalled') return { connected: false, reason: 'store_uninstalled' };
  if (!store.access_token && store.access_token !== undefined) return { connected: false, reason: 'no_access_token' };
  if (DISCONNECTED_STATES.has(store.integration_state)) return { connected: false, reason: store.integration_state };
  return { connected: true, reason: null };
}

function storeIsSyncing(store, now) {
  const status = String(store?.initial_sync_status || '');
  const started = toMs(store?.sync_started_at);
  return RUNNING_STATUSES.has(status) && started != null && now - started < ACTIVE_SYNC_WINDOW_MS;
}

/**
 * Evaluate one resource. Returns { resource, state, reason, last_success,
 * capability, materiality, recovering, missing_scopes }.
 */
function evaluateResource({ domain, row, grantedScopes, connection, syncing, now, staleMs, recoveryOpen }) {
  const capability = permissions.capabilityForDomain(domain);
  const base = {
    resource: domain,
    capability: capability?.id || null,
    capability_label: capability?.label || domain,
    materiality: capability?.materiality || 'extended',
    last_success: iso(row?.last_succeeded_at),
    last_attempt: iso(row?.last_attempted_at),
    record_count: Number.isFinite(row?.records_discovered) ? row.records_discovered : null,
    missing_scopes: [],
    recovering: false,
  };
  const result = (state, reason, extra = {}) => ({ ...base, state, reason, ...extra });

  // Domains Revluma has no retriever for yet are reported as not collected —
  // never as "retrying", which would claim recovery work that does not exist.
  if (notCollected(domain)) {
    const { byDomain } = require('./domainCatalog');
    return result(STATE.UNSUPPORTED, 'not_collected_by_revluma', { capability_label: byDomain(domain)?.label || domain });
  }

  if (!connection.connected) return result(STATE.UNAUTHORIZED, `connection_${connection.reason}`);

  // Permission truth comes from granted scopes, evaluated now, not from what
  // the ledger recorded at the last attempt. When the store has no recorded
  // scope list (legacy rows), permission state is unknown — never "nothing
  // granted" — and the ledger is the only evidence.
  const access = grantedScopes == null ? { state: 'unknown' } : permissions.domainAccess(domain, grantedScopes);
  if (access.state === 'missing_scope') {
    return result(STATE.UNAUTHORIZED, 'permission_not_granted', { missing_scopes: access.missing_scopes || [] });
  }
  if (access.state === 'plan_restricted') return result(STATE.UNSUPPORTED, 'not_available_on_plan');
  if (access.state === 'unsupported') return result(STATE.UNSUPPORTED, 'not_offered_by_shopify');

  const status = toCanonicalStatus(row?.status, { scope: 'resource' });
  const coverage = row?.coverage_state || null;
  const failureClass = row?.failure_class || null;
  const lastSuccess = toMs(row?.last_succeeded_at);
  const ageMs = lastSuccess == null ? null : now - lastSuccess;
  const recovering = recoveryOpen || status === RESOURCE_STATUS.RETRYING || (row?.retry_eligible === true && status === RESOURCE_STATUS.FAILED);

  if (coverage === COVERAGE.UNSUPPORTED || failureClass === FAILURE_CLASS.UNSUPPORTED) {
    return result(STATE.UNSUPPORTED, 'not_offered_by_shopify');
  }
  if (coverage === COVERAGE.UNAUTHORIZED || failureClass === FAILURE_CLASS.AUTH) {
    // Scopes look sufficient, yet Shopify refused: access was revoked or the
    // token is invalid. Treat as unauthorized until a verified sync succeeds.
    return result(STATE.UNAUTHORIZED, 'shopify_denied_access');
  }

  if (!row || status === RESOURCE_STATUS.NEVER_RUN) {
    return syncing ? result(STATE.INCOMPLETE, 'initial_sync_in_progress', { recovering: false })
      : result(STATE.UNAVAILABLE, 'not_yet_synced', { recovering: true });
  }

  if (status === RESOURCE_STATUS.RESOURCE_COMPLETED && (coverage === COVERAGE.COMPLETE || coverage === COVERAGE.VERIFIED_ZERO || coverage == null)) {
    if (ageMs != null && ageMs > staleMs) return result(STATE.STALE, 'refresh_overdue', { recovering: true, age_seconds: Math.round(ageMs / 1000) });
    return result(STATE.COMPLETE, coverage === COVERAGE.VERIFIED_ZERO ? 'verified_no_records' : 'synced', { age_seconds: ageMs == null ? null : Math.round(ageMs / 1000) });
  }

  if ([RESOURCE_STATUS.RUNNING, RESOURCE_STATUS.STARTING, RESOURCE_STATUS.QUEUED].includes(status) || (syncing && status !== RESOURCE_STATUS.FAILED)) {
    if (lastSuccess != null && ageMs <= staleMs) return result(STATE.COMPLETE, 'synced_refresh_in_progress', { age_seconds: Math.round(ageMs / 1000) });
    return result(STATE.INCOMPLETE, 'sync_in_progress', { recovering: true });
  }

  if (status === RESOURCE_STATUS.RESOURCE_PARTIAL || coverage === COVERAGE.PARTIAL || coverage === COVERAGE.INSUFFICIENT_HISTORY) {
    return result(STATE.INCOMPLETE, coverage === COVERAGE.INSUFFICIENT_HISTORY ? 'insufficient_history' : 'partially_retrieved', { recovering });
  }

  // Failed / retrying / persistence failure.
  if (lastSuccess != null) {
    return result(STATE.STALE, 'latest_refresh_failed', { recovering, age_seconds: Math.round(ageMs / 1000) });
  }
  return result(STATE.UNAVAILABLE, failureClass === FAILURE_CLASS.RATE_LIMITED ? 'shopify_rate_limited' : 'retrieval_failed', { recovering });
}

function limitationFor(resource) {
  const label = resource.capability_label;
  switch (resource.state) {
    case STATE.UNAUTHORIZED:
      return resource.reason === 'permission_not_granted'
        ? `${label}: Shopify permission not granted (${resource.missing_scopes.join(', ')})`
        : `${label}: Shopify access is not currently authorized`;
    case STATE.UNSUPPORTED:
      return resource.reason === 'not_collected_by_revluma'
        ? `${label}: not collected by Revluma yet`
        : `${label}: not available from Shopify for this store`;
    case STATE.UNAVAILABLE:
      if (resource.reason === 'not_yet_synced') return `${label}: not yet retrieved (retrieval scheduled automatically)`;
      return `${label}: not yet retrieved${resource.recovering ? ' (automatic retry scheduled)' : ''}`;
    case STATE.STALE:
      return `${label}: data last refreshed ${resource.last_success || 'at an unknown time'}${resource.recovering ? ' (refresh retrying)' : ''}`;
    case STATE.INCOMPLETE:
      return `${label}: ${resource.reason === 'insufficient_history' ? 'limited history available' : 'retrieval still in progress'}`;
    default:
      return null;
  }
}

// One sentence per capability + state, with the union of missing scopes, so a
// capability spanning several domains is disclosed once.
function groupedLimitations(resources) {
  const groups = new Map();
  for (const resource of resources) {
    const key = `${resource.capability || resource.resource}|${resource.state}|${resource.reason}`;
    const existing = groups.get(key);
    if (existing) {
      existing.missing_scopes = [...new Set([...existing.missing_scopes, ...resource.missing_scopes])];
      existing.recovering = existing.recovering || resource.recovering;
      if (resource.last_success && (!existing.last_success || resource.last_success < existing.last_success)) existing.last_success = resource.last_success;
    } else {
      groups.set(key, { ...resource, missing_scopes: [...resource.missing_scopes] });
    }
  }
  return [...groups.values()].map(limitationFor).filter(Boolean);
}

/**
 * Evaluate a store. Inputs are plain rows; no I/O.
 *
 *   store            stores row (granted_scopes, status, integration_state,
 *                    initial_sync_status, sync_started_at, last_synced_at,
 *                    sync_next_attempt_at, sync_last_failure_class,
 *                    sync_consecutive_failures)
 *   domainRows       store_sync_domain_states rows for the store
 *   domains          the synced domain list (syncDomainState.DOMAINS)
 *   pendingRequests  open authorization_requests (public form)
 *   deadLetters      open operation_dead_letters rows for the store
 */
function evaluateStoreHealth({ store, domainRows = [], domains, pendingRequests = [], deadLetters = [], now = Date.now(), staleMs = staleWindowMs() }) {
  if (!Array.isArray(domains) || domains.length === 0) throw new TypeError('evaluateStoreHealth requires the synced domain list');
  const nowMs = toMs(now) ?? Date.now();
  const connection = storeConnection(store);
  const syncing = connection.connected && storeIsSyncing(store, nowMs);
  const grantedScopes = store?.granted_scopes == null || store.granted_scopes === '' ? null : permissions.parseScopes(store.granted_scopes);
  const rowsByDomain = new Map(domainRows.map(row => [row.domain, row]));
  const openDomainRecovery = new Set(deadLetters
    .filter(item => item.kind === 'sync_domain' && typeof item.subject_key === 'string')
    .map(item => item.subject_key.split(':').slice(1).join(':')));

  const resources = domains
    .filter(domain => !permissions.isInfrastructureDomain(domain))
    .map(domain => evaluateResource({
      domain, row: rowsByDomain.get(domain), grantedScopes, connection, syncing,
      now: nowMs, staleMs, recoveryOpen: openDomainRecovery.has(domain),
    }));

  const counts = Object.fromEntries(STATE_VALUES.map(state => [state, 0]));
  for (const resource of resources) counts[resource.state] += 1;

  const core = resources.filter(resource => resource.materiality === 'core');
  const worstCore = core.reduce((worst, resource) => (SEVERITY[resource.state] > SEVERITY[worst] ? resource.state : worst), STATE.COMPLETE);
  const nonComplete = resources.filter(resource => resource.state !== STATE.COMPLETE);
  const storeBackoffUntil = iso(store?.sync_next_attempt_at);
  const storeFailureClass = store?.sync_last_failure_class || null;
  const storeAuthBlocked = storeFailureClass === 'auth';

  let overall;
  if (!connection.connected) overall = OVERALL.DISCONNECTED;
  else if (storeAuthBlocked || worstCore === STATE.UNAUTHORIZED) overall = OVERALL.ACTION_REQUIRED;
  else if (syncing && SEVERITY[worstCore] >= SEVERITY.incomplete) overall = OVERALL.SYNCING;
  else if (SEVERITY[worstCore] >= SEVERITY.stale) {
    overall = core.some(resource => resource.state !== STATE.COMPLETE && resource.recovering) || storeBackoffUntil
      ? OVERALL.RECOVERING : OVERALL.DEGRADED;
  } else if (nonComplete.some(resource => resource.state !== STATE.UNSUPPORTED || resource.materiality !== 'extended')) {
    overall = OVERALL.HEALTHY_WITH_LIMITATIONS;
  } else {
    overall = nonComplete.length ? OVERALL.HEALTHY_WITH_LIMITATIONS : OVERALL.HEALTHY;
  }

  // Merchant action is requested ONLY when the merchant can and must act:
  // reconnecting a revoked store, or approving a missing permission for a
  // core capability. Optional permissions are offered contextually, never
  // demanded globally.
  let merchantAction = null;
  if (!connection.connected || storeAuthBlocked) {
    merchantAction = { kind: 'reconnect', reason: connection.reason || 'authorization_failed', capabilities: [] };
  } else {
    const coreMissing = [...new Set(core.filter(resource => resource.state === STATE.UNAUTHORIZED && resource.reason === 'permission_not_granted').map(resource => resource.capability))];
    if (coreMissing.length) merchantAction = { kind: 'grant_permission', reason: 'core_permission_missing', capabilities: coreMissing };
  }

  const optionalPermissions = [...new Set(resources
    .filter(resource => resource.state === STATE.UNAUTHORIZED && resource.reason === 'permission_not_granted' && resource.materiality !== 'core')
    .map(resource => resource.capability))];

  const recovery = {
    store_backoff_until: storeBackoffUntil,
    store_consecutive_failures: Number.isFinite(store?.sync_consecutive_failures) ? store.sync_consecutive_failures : 0,
    store_last_failure_class: storeFailureClass,
    open_dead_letters: deadLetters.map(item => ({ kind: item.kind, subject: item.subject_key, failure_class: item.failure_class || null, attempts: item.attempts ?? null, since: iso(item.first_failed_at || item.created_at), next_retry_at: iso(item.next_retry_at) })),
    resources_recovering: resources.filter(resource => resource.recovering && resource.state !== STATE.COMPLETE).map(resource => resource.resource),
  };

  const lastSuccessMs = resources.map(resource => toMs(resource.last_success)).filter(ms => ms != null);
  return {
    schema_version: CONTRACT_VERSION,
    store_id: store?.id || null,
    evaluated_at: new Date(nowMs).toISOString(),
    overall,
    connected: connection.connected,
    syncing,
    stale_after_seconds: Math.round(staleMs / 1000),
    last_store_sync: iso(store?.last_synced_at),
    newest_resource_success: lastSuccessMs.length ? new Date(Math.max(...lastSuccessMs)).toISOString() : null,
    counts,
    core_state: worstCore,
    merchant_action: merchantAction,
    optional_permissions: optionalPermissions,
    pending_authorization_requests: pendingRequests.filter(request => !store?.id || request.store_id === store.id),
    recovery,
    resources,
    limitations: groupedLimitations(nonComplete),
    registry_version: permissions.REGISTRY_VERSION,
  };
}

/** The resources Rev needs for an objective, filtered from an evaluation. */
function resourcesForCapabilities(health, capabilityIds) {
  const wanted = new Set(capabilityIds || []);
  return (health?.resources || []).filter(resource => wanted.has(resource.capability));
}

/**
 * Compact, PII-free strings for the Python agent context (16 KiB budget).
 * Three line kinds, pipe-separated, parsed by
 * python/src/intelligence/data_health_context.py:
 *
 *   health | <store_id> | <overall> | <core_state> | <last_store_sync>
 *   complete | <store_id> | <resource,resource,...>
 *   resource | <store_id> | <resource> | <capability> | <state> | <reason[:scopes]> | <last_success>
 *
 * Complete resources are folded into one line per store to save space.
 */
const MATERIALITY_RANK = Object.freeze({ core: 0, standard: 1, extended: 2 });

function compactForAgent(healthList, { maxBytes = 3072 } = {}) {
  const headers = [];
  const completes = [];
  const resources = [];
  for (const health of healthList || []) {
    headers.push(['health', health.store_id, health.overall, health.core_state, health.last_store_sync || 'never'].join(' | '));
    const complete = health.resources.filter(resource => resource.state === STATE.COMPLETE).map(resource => resource.resource);
    if (complete.length) completes.push(['complete', health.store_id, complete.join(',')].join(' | ').slice(0, 700));
    for (const resource of health.resources) {
      if (resource.state === STATE.COMPLETE) continue;
      const reason = resource.missing_scopes.length ? `${resource.reason}:${resource.missing_scopes.join('+')}` : resource.reason;
      resources.push({
        rank: MATERIALITY_RANK[resource.materiality] ?? 2,
        line: ['resource', health.store_id, resource.resource, resource.capability || 'unknown', resource.state, reason, resource.last_success || 'never'].join(' | ').slice(0, 240),
      });
    }
  }
  // Priority under the byte budget: store headers, then core/standard gaps,
  // then the complete-resource summary, then extended gaps.
  resources.sort((a, b) => a.rank - b.rank);
  const ordered = [
    ...headers,
    ...resources.filter(item => item.rank < 2).map(item => item.line),
    ...completes,
    ...resources.filter(item => item.rank >= 2).map(item => item.line),
  ];
  const lines = [];
  let bytes = 2;
  for (const line of ordered) {
    const size = Buffer.byteLength(line) + 3;
    if (bytes + size > maxBytes) {
      lines.push('truncated | data health list truncated to fit the request budget');
      break;
    }
    lines.push(line);
    bytes += size;
  }
  return lines;
}

async function loadDataHealth({ db, storeIds, organizationId, now = Date.now() }) {
  const { DOMAINS } = require('./syncDomainState');
  const { pendingForStores } = require('./authorizationRequests');
  if (!Array.isArray(storeIds) || storeIds.length === 0) return [];
  const stores = await db.stores.findMany({
    where: { id: { in: storeIds }, ...(organizationId ? { organization_id: organizationId } : {}) },
    select: {
      id: true, organization_id: true, status: true, access_token: true, granted_scopes: true,
      integration_state: true, initial_sync_status: true, sync_started_at: true, last_synced_at: true,
      sync_next_attempt_at: true, sync_last_failure_class: true, sync_consecutive_failures: true,
    },
  });
  const ids = stores.map(store => store.id);
  const [domainRows, deadLetters, pendingRequests] = await Promise.all([
    db.store_sync_domain_states.findMany({ where: { store_id: { in: ids } } }),
    db.operation_dead_letters?.findMany
      ? db.operation_dead_letters.findMany({ where: { store_id: { in: ids }, status: 'open' }, take: 200 })
      : Promise.resolve([]),
    pendingForStores({ db, storeIds: ids }),
  ]);
  return stores.map(store => evaluateStoreHealth({
    store,
    domainRows: domainRows.filter(row => row.store_id === store.id),
    deadLetters: deadLetters.filter(row => row.store_id === store.id),
    pendingRequests: pendingRequests.filter(row => row.store_id === store.id),
    domains: DOMAINS,
    now,
  }));
}

module.exports = {
  CONTRACT_VERSION,
  STATE,
  STATE_VALUES,
  OVERALL,
  DEFAULT_STALE_MS,
  evaluateResource,
  evaluateStoreHealth,
  resourcesForCapabilities,
  compactForAgent,
  loadDataHealth,
  limitationFor,
};
