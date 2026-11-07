'use strict';

// Task 201 — canonical integration evidence (Node gateway mirror).
//
// The same model as python/src/intelligence/integration_evidence.py: an
// explicit connection state, authorization independent of connection,
// per-resource capability and sync evidence, webhook registration-vs-delivery
// vs-processing, and a deterministic overall health. A stored connection
// record is never reported as a healthy integration; a granted scope is never
// reported as effective access; an enqueued job is never reported as a
// completed synchronization; a registered webhook is never reported as working
// event processing.
//
// This service is read-only and organization-scoped. It never selects access
// token values, webhook secrets or raw error prose (only the bounded
// error_code column).

const { prisma: defaultDb } = require('../configs/database');
const {
  EVIDENCE_SCHEMA_VERSION, createEvidence, validateEvidenceCollection,
} = require('./revEvidenceContract');

const MAX_STORES = 8;

// Canonical resource id for the integration evidence surface
// (GET /evidence?resource_id=integration).
const INTEGRATION_RESOURCE_ID = 'integration';

// Mirrors the Python capability map (Task 201). `domain` is the
// store_sync_domain_states ledger domain that proves the resource; a null
// domain means the resource has no dedicated sync ledger in this build.
// `critical` marks MVP-essential capabilities.
const INTEGRATION_RESOURCES = Object.freeze([
  { id: 'shop.identity', domain: 'store_domains', scopes: [], approval: 'none', critical: true, category: 'store_configuration', note: 'Store profile, plan, currency and timezone metadata.' },
  { id: 'products', domain: 'products', scopes: ['read_products'], approval: 'none', critical: true, category: 'catalogue', note: 'Product catalogue synced with complete pagination.' },
  { id: 'product.variants', domain: 'variants', scopes: ['read_products'], approval: 'none', critical: true, category: 'catalogue', note: 'Variant pricing and availability.' },
  { id: 'orders', domain: 'orders', scopes: ['read_orders'], approval: 'read_all_orders', critical: true, category: 'orders', note: 'Order history; full history requires read_all_orders app approval and otherwise defaults to a 60-day window.' },
  { id: 'order.line_items', domain: 'orders', scopes: ['read_orders'], approval: 'none', critical: true, category: 'orders', note: 'Order line items synchronized with their order.' },
  { id: 'order.refunds', domain: 'refunds', scopes: ['read_orders'], approval: 'none', critical: true, category: 'orders', note: 'Itemised refund ledger; revenue figures reconcile against it.' },
  { id: 'inventory.items', domain: 'inventory', scopes: ['read_inventory'], approval: 'none', critical: true, category: 'inventory', note: 'Inventory items linked to variants.' },
  { id: 'inventory.levels', domain: 'inventory', scopes: ['read_inventory'], approval: 'none', critical: true, category: 'inventory', note: 'Inventory quantities per location.' },
  { id: 'webhooks', domain: 'webhooks', scopes: [], approval: 'none', critical: true, category: 'primitives', note: 'Webhook registrations keep the snapshot current between full syncs.' },
  { id: 'inventory.locations', domain: 'locations', scopes: ['read_locations'], approval: 'none', critical: false, category: 'inventory', note: 'Fulfillment and inventory locations.' },
  { id: 'order.transactions', domain: 'transactions', scopes: ['read_orders'], approval: 'none', critical: false, category: 'orders', note: 'Payment transaction ledger (captured money attribution).' },
  { id: 'order.fulfillments', domain: 'fulfillments', scopes: ['read_orders'], approval: 'none', critical: false, category: 'orders', note: 'Fulfillment status and tracking.' },
  { id: 'order.returns', domain: null, scopes: ['read_returns'], approval: 'none', critical: false, category: 'orders', note: 'Returns synchronized with order enrichment; no dedicated ledger.' },
  { id: 'customers', domain: 'customers', scopes: ['read_customers'], approval: 'protected_customer_data', critical: false, category: 'customers', note: 'Customer profiles; protected customer data requires separate Shopify app approval beyond the OAuth scope.' },
  { id: 'abandoned-checkouts', domain: 'abandoned_checkouts', scopes: ['read_checkouts'], approval: 'none', critical: false, category: 'checkouts', note: 'Abandoned checkout activity.' },
  { id: 'discount-nodes', domain: null, scopes: ['read_discounts'], approval: 'none', critical: false, category: 'discounts', note: 'Discount nodes and codes (read-only).' },
  { id: 'collections', domain: null, scopes: ['read_products'], approval: 'none', critical: false, category: 'catalogue', note: 'Collections; synchronized with product enrichment.' },
  { id: 'content.pages', domain: null, scopes: ['read_content'], approval: 'none', critical: false, category: 'content', note: 'Store pages.' },
  { id: 'content.blogs', domain: null, scopes: ['read_content'], approval: 'none', critical: false, category: 'content', note: 'Blogs and articles.' },
  { id: 'themes', domain: null, scopes: ['read_themes'], approval: 'none', critical: false, category: 'content', note: 'Theme list and roles.' },
  { id: 'shop.shipping_configuration', domain: null, scopes: ['read_shipping'], approval: 'none', critical: false, category: 'store_configuration', note: 'Delivery profiles and shipping rate data.' },
  { id: 'shop.taxes', domain: null, scopes: ['read_products'], approval: 'none', critical: false, category: 'store_configuration', note: 'Tax configuration visibility.' },
]);
const RESOURCE_BY_ID = Object.fromEntries(INTEGRATION_RESOURCES.map(entry => [entry.id, entry]));
const SYNC_DOMAINS = [...new Set(INTEGRATION_RESOURCES.map(entry => entry.domain).filter(Boolean))];

const DOMAIN_FRESH_SECONDS = Object.freeze({
  orders: 3600, transactions: 3600, refunds: 3600, inventory: 1800,
  customers: 4 * 3600, products: 2 * 3600, variants: 2 * 3600,
  content: 24 * 3600, discounts: 3600, abandoned_checkouts: 1800,
  fulfillments: 4 * 3600, locations: 24 * 3600, store_domains: 24 * 3600,
  webhooks: 24 * 3600,
});
const DEFAULT_FRESH_SECONDS = 2 * 3600;
const ACTIVE_STORE_STATUSES = ['active', 'connected', 'syncing'];
const DISCONNECTED_STORE_STATUSES = ['disconnected', 'revoked', 'inactive', 'deleted', 'not_connected'];

const AUTH_ERROR_RE = /ACCESS_DENIED|PERMISSION|SCOPE|403|FORBIDDEN/i;
const TOKEN_ERROR_RE = /TOKEN_(EXPIRED|INVALID)|EXPIRED|401|UNAUTHORIZED|OAUTH/i;
const RATE_LIMIT_RE = /RATE_?LIMIT|429|THROTTLED/i;
const NETWORK_ERROR_RE = /TIMEOUT|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|NETWORK|502|503|504/i;
const PAGINATION_ERROR_RE = /PAGINATION|CURSOR|PAGE/i;
const DATABASE_ERROR_RE = /SQL|DATABASE|PGRST|UNIQUE|DEADLOCK|SERIALIZATION/i;
const SCHEDULER_ERROR_RE = /SCHEDUL|QUEUE|WORKER|LOCK/i;

function classifyFailure(errorCode, ledgerStatus) {
  const code = String(errorCode || '').trim();
  if (!code) return ledgerStatus === 'failed' || ledgerStatus === 'degraded' ? 'unknown' : 'none';
  if (AUTH_ERROR_RE.test(code)) return 'authorization';
  if (TOKEN_ERROR_RE.test(code)) return 'authentication';
  if (RATE_LIMIT_RE.test(code)) return 'rate_limit';
  if (PAGINATION_ERROR_RE.test(code)) return 'pagination';
  if (DATABASE_ERROR_RE.test(code)) return 'database';
  if (SCHEDULER_ERROR_RE.test(code)) return 'scheduler';
  if (NETWORK_ERROR_RE.test(code)) return 'network';
  return ledgerStatus === 'failed' || ledgerStatus === 'degraded' ? 'shopify_api' : 'unknown';
}

function iso(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function grantedScopes(store) {
  return String(store.granted_scopes || '').split(',').map(value => value.trim()).filter(Boolean);
}

function scopeSatisfied(granted, required) {
  return granted.includes(required)
    || (required.startsWith('read_') && granted.includes(`write_${required.slice(5)}`));
}

function freshnessFor(domain, succeededAt, status, now) {
  const policy = DOMAIN_FRESH_SECONDS[domain] || DEFAULT_FRESH_SECONDS;
  const asOf = iso(succeededAt);
  if (status === 'running') return { state: 'synchronizing', as_of: asOf, age_seconds: null, policy: `${policy}s`, note: 'Synchronization is in progress; no completed result is asserted.' };
  if (!asOf) return { state: 'never_synchronized', as_of: null, age_seconds: null, policy: `${policy}s`, note: 'No successful synchronization timestamp is available.' };
  const ageSeconds = Math.max(0, Math.floor((now.getTime() - Date.parse(asOf)) / 1000));
  const state = ageSeconds <= policy ? 'fresh' : ageSeconds <= policy * 2 ? 'aging' : 'stale';
  return { state, as_of: asOf, age_seconds: ageSeconds, policy: `${policy}s`, note: `Domain freshness policy: fresh <= ${policy}s, aging <= ${policy * 2}s.` };
}

function normalizeDomainStates(rows, now) {
  const states = {};
  for (const row of rows || []) {
    if (!row?.domain) continue;
    const status = String(row.status || 'never_run');
    const succeeded = row.last_succeeded_at instanceof Date ? row.last_succeeded_at : (row.last_succeeded_at ? new Date(row.last_succeeded_at) : null);
    const attempted = row.last_attempted_at ? new Date(row.last_attempted_at) : (row.last_checked_at ? new Date(row.last_checked_at) : null);
    states[row.domain] = {
      status,
      last_succeeded_at: succeeded,
      last_attempted_at: attempted,
      retry_count: Number(row.retry_count) || 0,
      records_discovered: row.records_discovered != null ? Number(row.records_discovered) : null,
      records_inserted: row.records_inserted != null ? Number(row.records_inserted) : null,
      records_updated: row.records_updated != null ? Number(row.records_updated) : null,
      pages_completed: row.pages_completed != null ? Number(row.pages_completed) : null,
      pagination_complete: row.pagination_complete === true,
      error_code: row.error_code ? String(row.error_code).slice(0, 120) : null,
      failure_class: classifyFailure(row.error_code, status),
      attempted: attempted || null,
    };
  }
  // Every known sync domain is reported even without a ledger row.
  for (const domain of SYNC_DOMAINS) {
    if (!states[domain]) states[domain] = {
      status: 'never_run', last_succeeded_at: null, last_attempted_at: null,
      retry_count: 0, records_discovered: null, records_inserted: null,
      records_updated: null, pages_completed: null, pagination_complete: false,
      error_code: null, failure_class: 'none', attempted: null,
    };
  }
  for (const [domain, state] of Object.entries(states)) {
    const freshness = freshnessFor(domain, state.last_succeeded_at, state.status, now);
    state.freshness = freshness;
    if (state.status === 'running') {
      Object.assign(state, { state: 'running', stale: false, note: 'Synchronization is in progress; no completed result is asserted.' });
    } else if (state.status === 'failed') {
      Object.assign(state, { state: 'failed', stale: false, note: `Latest synchronization attempt did not complete (${state.error_code || 'error'}); the previous successful result, if any, still bounds usable data.` });
    } else if (state.status === 'degraded') {
      Object.assign(state, { state: 'partial', stale: false, note: 'Synchronization completed with gaps or incomplete pagination; data is usable but not certified complete.' });
    } else if (state.status === 'never_run' || !state.last_succeeded_at) {
      Object.assign(state, { state: 'never_synchronized', stale: false, note: 'No completed synchronization has been recorded for this domain.' });
    } else {
      const stale = freshness.state === 'stale';
      Object.assign(state, { state: 'succeeded', stale, note: stale ? `Synchronization completed but is now older than the ${freshness.policy} policy; treat data as stale, not current.` : 'Synchronization completed.' });
    }
  }
  return states;
}

function connectionState(store, domains) {
  if (!store) return { state: 'not_installed', notes: ['No Shopify installation record exists for this organization.'] };
  const status = String(store.status || 'unknown');
  if (status === 'disconnected' || status === 'revoked') return { state: status, notes: [`The integration is recorded as ${status}.`] };
  if (DISCONNECTED_STORE_STATUSES.includes(status)) return { state: 'disconnected', notes: [`The store record is in state '${status}'.`] };
  if (!ACTIVE_STORE_STATUSES.includes(status)) return { state: 'unknown', notes: [`Unrecognized store status '${status}'; connection state is unknown.`] };
  if (!store.has_token) return { state: 'authentication_invalid', notes: ['The store record carries no access token; no API call can be authenticated.'] };
  if (status === 'syncing' && !store.last_synced_at) return { state: 'installation_pending', notes: ['Installation completed but the first synchronization has not run.'] };
  const authFailures = Object.entries(domains)
    .filter(([, state]) => ['failed', 'partial'].includes(state.state) && state.failure_class === 'authentication')
    .sort((a, b) => (a[1].attempted || 0) - (b[1].attempted || 0));
  if (authFailures.length) {
    const worst = authFailures[authFailures.length - 1];
    return { state: 'verification_failed', notes: [`The most recent synchronization evidence indicates the credentials were rejected by Shopify (domain: ${worst[0]}); the connection is not verified as currently valid.`] };
  }
  return { state: 'authenticated', notes: ['Connection record is active with stored credentials; validity is established by the most recent successful synchronization below.'] };
}

function resourceCapability(resource, granted, domainState, now) {
  const scopesRecorded = granted.length > 0;
  // A recorded-but-incomplete scope list is an authorization gap. A store
  // record with NO scope list at all is a data gap, not proof of a missing
  // grant — capability then rests on observed synchronization behaviour.
  const missing = scopesRecorded ? resource.scopes.filter(scope => !scopeSatisfied(granted, scope)) : [];
  const restrictions = [];
  if (resource.approval === 'read_all_orders') restrictions.push('Full order history requires read_all_orders application approval; until granted the available window is bounded (60 days).');
  else if (resource.approval === 'protected_customer_data') restrictions.push('Protected customer data requires separate Shopify app approval beyond the OAuth scope; merchant consent may also limit fields.');
  else if (resource.approval && resource.approval !== 'none') restrictions.push(`Platform approval or plan gate applies: ${resource.approval}.`);
  if (resource.note) restrictions.push(resource.note);

  const ledger = domainState || {};
  const freshness = ledger.freshness || { state: 'never_synchronized', as_of: null, age_seconds: null, policy: `${DOMAIN_FRESH_SECONDS[resource.domain] || DEFAULT_FRESH_SECONDS}s`, note: 'No successful synchronization timestamp is available.' };

  let authorization;
  if (missing.length) {
    authorization = { state: 'missing_scope', missing_scopes: missing, effective: false, note: `Required Shopify authorization is not granted: ${missing.join(', ')}.` };
  } else if (!scopesRecorded) {
    // The store record carries no scope list at all: that is a data gap,
    // not proof of a missing grant. Access is proven only by sync.
    if (ledger.state === 'succeeded') {
      authorization = { state: 'effective_verified', missing_scopes: [], effective: true, note: 'No granted scopes are recorded on the store record, but a successful synchronization proves current access.' };
    } else {
      authorization = { state: 'unverified_unrecorded', missing_scopes: [], effective: false, note: 'No granted scopes are recorded on the store record, and no successful synchronization has proven current access; the record alone is not asserted.' };
    }
  } else if (resource.approval === 'protected_customer_data') {
    authorization = { state: 'granted_approval_pending', missing_scopes: [], effective: ledger.state === 'succeeded', note: 'OAuth scope is granted, but protected customer data also requires app approval; effective access is established only by a successful retrieval.' };
  } else if (resource.approval && resource.approval !== 'none') {
    authorization = { state: 'granted_with_platform_gate', missing_scopes: [], effective: ledger.state === 'succeeded', note: 'Scope is granted; platform approval or plan gates may still limit the resource.' };
  } else if (ledger.state === 'succeeded') {
    authorization = { state: 'effective_verified', missing_scopes: [], effective: true, note: 'A successful authorized retrieval proves current access.' };
  } else {
    authorization = { state: 'granted_unverified', missing_scopes: [], effective: false, note: 'The scope is recorded as granted, but no successful retrieval has verified current access; granted is not proof of access.' };
  }

  let sync;
  if (resource.domain == null) {
    sync = { state: 'unsupported', note: 'No dedicated synchronization ledger domain exists for this resource in the current build.' };
  } else {
    sync = {
      state: ledger.state || null,
      last_succeeded_at: iso(ledger.last_succeeded_at),
      last_attempted_at: iso(ledger.last_attempted_at),
      retry_count: ledger.retry_count || 0,
      records_discovered: ledger.records_discovered ?? null,
      records_inserted: ledger.records_inserted ?? null,
      records_updated: ledger.records_updated ?? null,
      pagination_complete: ledger.pagination_complete === true,
      pages_completed: ledger.pages_completed ?? null,
      failure_class: ledger.failure_class || null,
      error_code: ledger.error_code || null,
      stale: ledger.stale === true,
      freshness,
      note: ledger.note || '',
    };
  }

  let runningOnRecentSuccess = false;
  if (ledger.state === 'running' && ledger.last_succeeded_at) {
    const prior = freshnessFor(resource.domain, ledger.last_succeeded_at, 'ok', now);
    runningOnRecentSuccess = ['fresh', 'aging'].includes(prior.state) && ledger.pagination_complete === true;
  }
  const operational = missing.length === 0 && (
    (ledger.state === 'succeeded' && ledger.pagination_complete === true
      && ['fresh', 'aging'].includes(freshness.state) && !ledger.stale)
    || runningOnRecentSuccess
  );

  return { resource_id: resource.id, category: resource.category, critical: resource.critical, supported: true, authorization, sync, operational, restrictions };
}

function webhookEvidence(registrations, deliveries, now) {
  const topicStatuses = {};
  for (const row of registrations || []) {
    const topic = String(row.topic || 'unknown');
    topicStatuses[topic] = topicStatuses[topic] || [];
    topicStatuses[topic].push(String(row.status || 'unknown'));
  }
  const registrationFailed = Object.entries(topicStatuses).filter(([, s]) => s.some(v => ['failed', 'error'].includes(v))).map(([t]) => t);
  const registrationActive = Object.entries(topicStatuses).filter(([, s]) => s.some(v => ['active', 'pending', 'created'].includes(v))).map(([t]) => t);

  const recent = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const asDate = value => (value instanceof Date ? value : value ? new Date(value) : null);
  const processed = (deliveries || []).filter(d => d.status === 'processed');
  const failed = (deliveries || []).filter(d => d.status === 'failed');
  const received = (deliveries || []).filter(d => { const r = asDate(d.received_at); return r && r >= recent; });
  const processedRecent = processed.filter(d => { const p = asDate(d.processed_at); return p && p >= recent; });
  const lastReceived = received.map(d => asDate(d.received_at)).sort((a, b) => a - b)[received.length - 1] || null;
  const lastProcessed = processedRecent.map(d => asDate(d.processed_at)).sort((a, b) => a - b)[processedRecent.length - 1] || null;
  const lastFailure = failed.map(d => asDate(d.received_at)).filter(Boolean).sort((a, b) => a - b)[failed.length - 1] || null;
  const lags = [];
  for (const d of processedRecent) {
    const rec = asDate(d.received_at); const proc = asDate(d.processed_at);
    if (rec && proc) lags.push(Math.floor((proc - rec) / 1000));
  }
  lags.sort((a, b) => a - b);
  const p95Lag = lags.length ? lags[Math.min(lags.length - 1, Math.floor(0.95 * (lags.length - 1)))] : null;

  let state; let note;
  if (!registrations || !registrations.length) {
    state = 'not_registered';
    note = 'No webhook registrations are recorded; the store relies on full scheduled synchronization only, so data between syncs can be missed.';
  } else if (failed.length && !processedRecent.length) {
    state = 'failed';
    note = 'Webhook deliveries are failing and no recent event was processed successfully.';
  } else if (processedRecent.length && !failed.length) {
    state = 'healthy';
    note = 'Recent webhook events were delivered and processed successfully.';
  } else if (processedRecent.length) {
    state = 'degraded';
    note = 'Recent events were processed, but some deliveries failed; check the failing topics and their affected resources.';
  } else if (received.length && !processedRecent.length) {
    state = 'degraded';
    note = 'Webhook events are arriving but none was processed successfully in the last seven days; delivery is working, processing is not.';
  } else {
    state = 'unknown';
    note = 'Webhooks are registered but no event was observed in the last seven days; this can mean either a quiet store or that events are not arriving. A registered webhook does not prove events are flowing.';
  }
  return {
    state, note,
    registered_topics: Object.keys(topicStatuses).sort(),
    active_topics: registrationActive.sort(),
    failed_topics: registrationFailed.sort(),
    registrations: (registrations || []).length,
    failures_last_7d: failed.length,
    delivered_last_7d: received.length,
    processed_last_7d: processedRecent.length,
    last_received_at: iso(lastReceived),
    last_processed_at: iso(lastProcessed),
    last_failure_at: iso(lastFailure),
    processing_lag_p95_seconds: p95Lag,
    duplicate_handling: 'Deduplicated at claim time on (provider, delivery id); repeated deliveries of one event are not processed twice.',
    limitations: ['Webhook secrets and raw delivery headers are never included.', 'Failed deliveries are counted, not quoted, to avoid leaking payload data.'],
  };
}

function orderCoverage(rows) {
  if (!rows || !rows.length) return { status: 'unavailable', note: 'No certified order-coverage record exists for this store.' };
  if (rows.every(row => row.coverage_start != null)) return { status: 'complete', note: 'Order coverage is certified by the intelligence ledger.' };
  return { status: 'partial', note: 'Order coverage is recorded but incomplete.' };
}

function evaluateHealth(store, connection, capabilities, domains, webhooks, coverage, now) {
  const critical = capabilities.filter(cap => cap.critical);
  const optional = capabilities.filter(cap => !cap.critical);
  const criticalFailures = [];
  for (const cap of critical) {
    if (cap.operational) continue;
    const syncState = (cap.sync || {}).state;
    const authState = cap.authorization.state;
    let reason; let errorClass;
    if (authState === 'missing_scope') { reason = 'missing_scope'; errorClass = 'authorization'; }
    else if (syncState === 'failed' || (syncState === 'partial' && ['authentication', 'authorization'].includes((cap.sync || {}).failure_class))) {
      reason = `sync_${(cap.sync || {}).failure_class || 'failed'}`; errorClass = (cap.sync || {}).failure_class || 'sync_failure';
    } else if ((cap.sync || {}).stale) { reason = 'stale'; errorClass = 'stale'; }
    else if (syncState === 'running') { reason = 'synchronizing'; errorClass = 'synchronizing'; }
    else if (syncState === 'never_synchronized' || syncState == null) { reason = 'never_synchronized'; errorClass = 'never_synchronized'; }
    else if (syncState === 'unsupported') { reason = 'sync_unsupported'; errorClass = 'unsupported'; }
    else { reason = `sync_${syncState || 'not_operational'}`; errorClass = 'sync_failure'; }
    criticalFailures.push({
      resource_id: cap.resource_id, reason, class: errorClass,
      detail: authState === 'missing_scope' ? cap.authorization.note : (cap.sync || {}).note || '',
    });
  }

  const warnings = [];
  const staleResources = [...new Set(capabilities.filter(cap => (cap.sync || {}).stale).map(cap => cap.resource_id))].sort();
  const optionalUnavailable = [];
  const optionalRealFailures = [];
  for (const cap of optional) {
    if (cap.operational) continue;
    const sync = cap.sync || {};
    const syncState = sync.state;
    if (sync.stale) continue;
    if (['authorization', 'authentication'].includes(sync.failure_class) && ['failed', 'partial'].includes(syncState)) {
      warnings.push(`${cap.resource_id}: latest synchronization was rejected (${sync.failure_class}).`);
    } else if (['failed', 'partial'].includes(syncState)) {
      warnings.push(`${cap.resource_id}: latest synchronization ${syncState} (${sync.error_code || 'error'}).`);
      optionalRealFailures.push(cap.resource_id);
    } else if (cap.authorization.state === 'missing_scope') {
      optionalUnavailable.push({ resource_id: cap.resource_id, reason: 'missing_scope', missing_scopes: cap.authorization.missing_scopes, detail: cap.authorization.note });
    } else if (syncState === 'unsupported') {
      optionalUnavailable.push({ resource_id: cap.resource_id, reason: 'sync_unsupported', missing_scopes: [], detail: sync.note || 'No dedicated sync ledger domain for this resource.' });
    } else if (syncState === 'never_synchronized') {
      optionalUnavailable.push({ resource_id: cap.resource_id, reason: 'never_synchronized', missing_scopes: [], detail: 'No completed synchronization recorded for this optional resource yet.' });
    }
  }
  if (['failed', 'degraded'].includes(webhooks.state)) warnings.push(`Webhook health is ${webhooks.state}: ${webhooks.note}`);
  if (webhooks.state === 'not_registered') warnings.push(webhooks.note);
  if (coverage.status !== 'complete') warnings.push('Certified order-history coverage is not complete for every store; historical evidence may be bounded.');
  if (capabilities.some(cap => cap.authorization.note.includes('No granted scopes are recorded'))) {
    warnings.push('No granted Shopify scopes are recorded on this store\'s record; capability states rest on observed synchronization behaviour.');
  }

  const criticalMissing = [...new Set(critical.flatMap(cap => cap.authorization.missing_scopes))].sort();
  const optionalMissing = [...new Set(optional.flatMap(cap => cap.authorization.missing_scopes))].sort();
  const criticalAuthFailed = critical
    .filter(cap => ['authorization', 'authentication'].includes((cap.sync || {}).failure_class)
      && ['failed', 'partial'].includes((cap.sync || {}).state))
    .map(cap => cap.resource_id);
  const unsupported = optionalUnavailable.filter(entry => entry.reason === 'sync_unsupported').map(entry => entry.resource_id).sort();

  const anySucceeded = Object.values(domains).some(state => state.last_succeeded_at);
  let overall;
  if (['not_installed', 'disconnected', 'revoked'].includes(connection.state)) overall = 'disconnected';
  else if (['verification_failed', 'authentication_invalid'].includes(connection.state)) overall = 'attention_required';
  else if (connection.state === 'installation_pending' && !anySucceeded) overall = 'verification_pending';
  else if (connection.state === 'unknown') overall = 'unknown';
  else if (criticalFailures.length) overall = criticalFailures.every(f => ['authorization', 'authentication'].includes(f.class)) ? 'unauthorized' : 'partially_operational';
  else if (webhooks.state === 'failed') overall = 'partially_operational';
  else if (optionalRealFailures.length || staleResources.length
    || ['degraded', 'unknown', 'not_registered'].includes(webhooks.state)
    || coverage.status !== 'complete') overall = 'degraded';
  else if (connection.state === 'authenticated') overall = 'healthy';
  else overall = 'unknown';

  const unprovenCritical = criticalFailures.filter(f => ['never_synchronized', 'synchronizing'].includes(f.class)).length;
  const realCritical = criticalFailures.filter(f => !['stale', 'never_synchronized', 'synchronizing'].includes(f.class)).length;
  let score = 100;
  score -= 25 * realCritical;
  score -= 5 * unprovenCritical;
  score -= 10 * staleResources.length;
  score -= 5 * optionalRealFailures.length;
  if (['failed', 'degraded'].includes(webhooks.state)) score -= 15;
  else if (webhooks.state === 'unknown') score -= 10;
  if (coverage.status !== 'complete') score -= 5;
  if (['healthy', 'verification_pending'].includes(overall)) score = Math.max(score, 70);
  if (realCritical) score = Math.min(score, 59);
  score = Math.max(0, Math.min(100, score));

  return {
    overall_status: overall,
    score,
    score_formula: '100 - 25 per real critical failure - 5 per never-synchronized critical capability - 10 per stale resource - 5 per failed optional capability - 15 for webhook failures (10 when silent) - 5 for incomplete coverage; floored at 70 when healthy/verification pending; capped at 59 while any real critical failure exists. The overall_status, not the score, is authoritative.',
    components: {
      authentication: authComponent(connection, domains),
      authorization: (criticalMissing.length || criticalAuthFailed.length) ? 'failed' : (optionalMissing.length ? 'degraded' : 'healthy'),
      synchronization: critical.some(cap => !cap.operational) ? 'failed' : (optionalRealFailures.length ? 'degraded' : 'healthy'),
      webhooks: { healthy: 'healthy', failed: 'failed', degraded: 'degraded', unknown: 'unknown', not_registered: 'degraded' }[webhooks.state] || 'unknown',
      freshness: staleResources.length ? 'degraded' : 'healthy',
      coverage: coverage.status,
    },
    critical_failures: criticalFailures,
    warnings,
    unsupported,
    missing_permissions: [...new Set([...criticalMissing, ...optionalMissing])].sort(),
    optional_unavailable: optionalUnavailable,
    stale_resources: staleResources,
    syncing_domains: Object.entries(domains).filter(([, s]) => s.state === 'running').map(([d]) => d).sort(),
    connection_notes: connection.notes,
    last_verified_at: now.toISOString(),
  };
}

function authComponent(connection, domains) {
  if (['not_installed', 'disconnected', 'revoked'].includes(connection.state)) return 'disconnected';
  if (connection.state === 'verification_failed') return 'failed';
  const authFailed = Object.values(domains).some(s => ['failed', 'partial'].includes(s.state) && s.failure_class === 'authentication');
  if (authFailed) return 'degraded';
  if (['authenticated', 'installation_pending'].includes(connection.state)) return 'healthy';
  return 'unknown';
}

function currentPeriod(store, now) {
  const rawStart = store.last_synced_at ? Date.parse(iso(store.last_synced_at)) : now.getTime() - 1000;
  // Keep the window strictly half-open: end must be after start.
  const start = new Date(Math.max(now.getTime() - 86_400_000, Math.min(rawStart, now.getTime() - 1000)));
  return { start: start.toISOString(), end: now.toISOString(), timezone: 'UTC', semantics: '[start, end)', label: 'Current integration state' };
}

function stateEvidence({ organizationId, storeIds, store, metric, label, value, period, source, definition, limitations, freshness }) {
  return createEvidence({
    organization_id: organizationId, store_id: null, store_ids: storeIds,
    evidence_type: 'integration_state', domain: 'integration',
    classification: 'verified_fact', status: 'available',
    metric, label, value, unit: 'reference', currency: null,
    definition, period,
    source: { system: 'shopify', resource: source, references: [] },
    retrieved_at: period.end, computed_at: period.end,
    coverage: { status: 'complete', period_status: 'current_snapshot', complete: true, source, note: 'Current-state evidence derived from persisted tenant-scoped records.' },
    freshness,
    provenance: { retrieval: 'direct', transformation: definition, calculation_version: 'integration-evidence-v1', lineage: [`source:${source}`, `store:${store.id}`], reproducible: true },
    measurement: null,
    confidence: { level: 'high', score: 0.95, basis: 'Deterministic derivation from the persisted connection, sync-ledger, webhook and coverage evidence of the authenticated organization.' },
    store_scope: 'organization',
    limitations: (limitations || []).slice(0, 30).map(item => String(item).slice(0, 800)),
  });
}

async function authorizedStores(db, organizationId, storeId) {
  if (!organizationId || typeof organizationId !== 'string') {
    const error = new Error('Authenticated organization context is required.');
    error.code = 'INTEGRATION_AUTHORIZATION_REQUIRED'; error.statusCode = 403; throw error;
  }
  const where = {
    organization_id: organizationId, platform: 'shopify',
    status: { notIn: ['deleted'] },
    ...(storeId ? { id: storeId } : {}),
  };
  const rows = await db.stores.findMany({
    where, orderBy: { id: 'asc' }, take: MAX_STORES,
    select: { id: true, organization_id: true, platform: true, status: true, shop_domain: true, granted_scopes: true, last_synced_at: true, installed_at: true },
  });
  // has_token via a raw boolean probe: the token value itself is never
  // selected, returned or logged by this service. Prisma's tag-function
  // $queryRaw cannot express a variable-length IN list, so the probe uses
  // the parameterised string form ($queryRawUnsafe: values are bound as
  // $n parameters, never interpolated).
  let withToken = [];
  if (rows.length && typeof db.$queryRawUnsafe === 'function') {
    const params = [];
    // Compare as text (s.id::text) because the bound parameters are text;
    // a uuid = text comparison has no operator and needs an explicit cast.
    let clause = 'SELECT s.id::text AS store_id, (s.access_token IS NOT NULL) AS has_token FROM stores s WHERE s.id::text IN (';
    for (const row of rows) {
      if (params.length) clause += ', ';
      clause += `$${params.length + 1}`;
      params.push(String(row.id));
    }
    clause += ')';
    withToken = await db.$queryRawUnsafe(clause, ...params);
  }
  const tokenById = new Map((withToken || []).map(row => [String(row.store_id), row.has_token === true]));
  return rows.map(row => ({ ...row, has_token: tokenById.get(row.id) === true }));
}

async function runRetrieveIntegrationEvidence({ organizationId, storeId = null, signal, db = defaultDb(), now = new Date() }) {
  const stores = await authorizedStores(db, organizationId, storeId);
  if (!stores.length) {
    return {
      schema_version: EVIDENCE_SCHEMA_VERSION, metric_family: 'integration',
      organization_id: organizationId, store_ids: [],
      retrieved_at: now.toISOString(), overall_status: 'disconnected',
      items: [], stores: [],
      warnings: ['No Shopify store is installed for this organization.'],
      limitations: ['No integration is configured; no capability is available.'],
    };
  }
  const storeIds = stores.map(store => store.id);
  const [ledgerRows, registrations, deliveries, coverageRows] = await Promise.all([
    db.store_sync_domain_states.findMany({
      where: { store_id: { in: storeIds } },
      select: { store_id: true, domain: true, status: true, last_attempted_at: true, last_succeeded_at: true, last_checked_at: true, retry_count: true, records_discovered: true, records_inserted: true, records_updated: true, pages_completed: true, pagination_complete: true, error_code: true },
    }),
    db.webhook_registrations.findMany({
      where: { store_id: { in: storeIds } },
      select: { store_id: true, topic: true, status: true, last_error: true, attempt_count: true },
    }),
    db.webhook_deliveries.findMany({
      where: { store_id: { in: storeIds }, received_at: { gte: new Date(now.getTime() - 7 * 24 * 3600 * 1000) } },
      select: { store_id: true, topic: true, status: true, received_at: true, processed_at: true },
    }),
    db.intelligence_order_coverage.findMany({
      where: { store_id: { in: storeIds } },
      select: { store_id: true, coverage_start: true, coverage_end: true },
    }),
  ]);
  if (signal?.aborted) throw Object.assign(new Error('Integration evidence retrieval aborted.'), { code: 'EVIDENCE_RETRIEVAL_ABORTED', statusCode: 499 });

  const items = [];
  const storesOut = [];
  for (const store of stores) {
    const domains = normalizeDomainStates(ledgerRows.filter(row => row.store_id === store.id), now);
    const granted = grantedScopes(store);
    const capabilities = INTEGRATION_RESOURCES
      .map(resource => resourceCapability(resource, granted, resource.domain ? domains[resource.domain] : null, now));
    const webhooks = webhookEvidence(registrations.filter(row => row.store_id === store.id), deliveries.filter(row => row.store_id === store.id), now);
    const coverage = orderCoverage(coverageRows.filter(row => row.store_id === store.id));
    const connection = connectionState(store, domains);
    const health = evaluateHealth(store, connection, capabilities, domains, webhooks, coverage, now);
    const period = currentPeriod(store, now);
    const noFreshness = { state: 'unknown', as_of: null, age_seconds: null, policy: 'current', note: 'Current-state evidence.' };

    items.push(stateEvidence({
      organizationId, storeIds, store, period,
      metric: 'integration.connection_state',
      label: `Connection state: ${store.shop_domain || store.id}`,
      value: connection.state, source: 'stores',
      definition: 'Explicit connection state derived from the installation record and the latest observed credential behaviour in the sync ledger; a stored record alone only proves an installation exists.',
      limitations: connection.notes,
      freshness: noFreshness,
    }));
    items.push(stateEvidence({
      organizationId, storeIds, store, period,
      metric: 'integration.authorization',
      label: `Granted Shopify scopes: ${store.shop_domain || store.id}`,
      value: granted.length ? granted.join(', ') : null, source: 'stores',
      definition: 'Scopes recorded as granted at OAuth time. A recorded scope is not proof of current effective access; effective access is established per resource by a successful authorized retrieval.',
      limitations: health.missing_permissions.length
        ? [`Missing scopes: ${health.missing_permissions.join(', ')}`]
        : (granted.length
            ? ['No missing scopes recorded.']
            : ['No granted Shopify scopes are recorded on this store\'s record; capability states rest on observed synchronization behaviour.']),
      freshness: noFreshness,
    }));
    for (const cap of capabilities) {
      if (!cap.critical && cap.operational) continue;
      const syncState = (cap.sync || {}).state || 'unsupported';
      const capState = cap.operational ? 'operational'
        : ['missing_scope', 'granted_approval_pending'].includes(cap.authorization.state) ? cap.authorization.state
          : (cap.sync || {}).stale ? 'stale' : syncState;
      items.push(stateEvidence({
        organizationId, storeIds, store, period,
        metric: `integration.resource.${cap.resource_id}`,
        label: `${cap.resource_id} capability: ${capState}`,
        value: capState, source: (cap.sync || {}).note ? 'store_sync_domain_states' : 'stores',
        definition: `Capability state for ${cap.resource_id} combining recorded authorization, latest synchronization outcome and freshness. Operational requires a successful fully-paginated retrieval within the domain freshness policy.`,
        limitations: [cap.authorization.note, ...cap.restrictions.slice(0, 2), (cap.sync || {}).note || ''].filter(Boolean),
        freshness: (cap.sync || {}).freshness || noFreshness,
      }));
    }
    items.push(stateEvidence({
      organizationId, storeIds, store, period,
      metric: 'integration.webhook_health',
      label: `Webhook health: ${store.shop_domain || store.id}`,
      value: webhooks.state, source: 'webhook_deliveries',
      definition: 'Webhook registration and delivery/processing evidence over the last seven days. Registration is reported separately from successful event processing; neither implies the other.',
      limitations: [...webhooks.limitations, webhooks.note],
      freshness: noFreshness,
    }));
    items.push(stateEvidence({
      organizationId, storeIds, store, period,
      metric: 'integration.health_overall',
      label: `Integration health: ${store.shop_domain || store.id}`,
      value: health.overall_status, source: 'stores',
      definition: 'Deterministic overall integration health from connection, authorization, per-resource synchronization, webhook and coverage evidence. Critical capability failures always dominate; optional failures are warnings.',
      limitations: health.critical_failures.length
        ? [`Critical: ${health.critical_failures.map(f => `${f.resource_id} (${f.reason})`).join('; ')}`]
        : (health.warnings.slice(0, 2).length ? health.warnings.slice(0, 2) : ['No critical integration problems were found.']),
      freshness: noFreshness,
    }));

    storesOut.push({
      store_id: store.id, shop_domain: store.shop_domain, platform: store.platform,
      connection: {
        state: connection.state, notes: connection.notes, record_status: store.status,
        has_credentials: store.has_token === true,
        installed_at: iso(store.installed_at), last_synced_at: iso(store.last_synced_at),
      },
      granted_scopes: granted,
      capabilities,
      synchronization: Object.fromEntries(Object.entries(domains).map(([domain, state]) => [domain, {
        state: state.state,
        last_succeeded_at: iso(state.last_succeeded_at),
        last_attempted_at: iso(state.last_attempted_at),
        retry_count: state.retry_count,
        records_discovered: state.records_discovered,
        records_inserted: state.records_inserted,
        records_updated: state.records_updated,
        pages_completed: state.pages_completed,
        pagination_complete: state.pagination_complete,
        failure_class: ['failed', 'partial'].includes(state.state) ? state.failure_class : null,
        error_code: ['failed', 'partial'].includes(state.state) ? state.error_code : null,
        freshness: state.freshness,
        note: state.note,
      }])),
      webhooks,
      order_coverage: coverage,
      health,
    });
  }

  const single = storesOut.length === 1 ? storesOut[0].health : null;
  const rank = { unknown: -1, disconnected: 0, unauthorized: 1, attention_required: 2, partially_operational: 3, verification_pending: 4, degraded: 5, healthy: 6 };
  const overall = single ? single.overall_status
    : storesOut.map(store => store.health.overall_status).sort((a, b) => (rank[a] ?? -1) - (rank[b] ?? -1))[0];

  const collection = validateEvidenceCollection(items, { organizationId, storeIds });
  if (!collection.valid) {
    const error = new Error(`Integration evidence contract violated: ${collection.errors.join('; ')}`);
    error.code = 'EVIDENCE_CONTRACT_INVALID'; error.statusCode = 500; throw error;
  }

  return {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    metric_family: 'integration',
    organization_id: organizationId,
    store_ids: storeIds,
    retrieved_at: now.toISOString(),
    overall_status: overall,
    components: single ? single.components : null,
    critical_failures: storesOut.flatMap(store => store.health.critical_failures),
    warnings: [...new Set(storesOut.flatMap(store => store.health.warnings))],
    limitations: single ? (single.connection_notes.length ? single.connection_notes : [])
      : ['A connected record, a granted scope or an enqueued job is never reported as a working capability; every state above is derived from persisted evidence.'],
    stores: storesOut,
    items,
  };
}

async function runRetrieveIntegrationEvidenceById({ organizationId, storeId = null, evidenceId, signal, db = defaultDb(), now = new Date() }) {
  if (!evidenceId || !/^ev-[a-f0-9]{24}$/.test(String(evidenceId))) {
    const error = new Error('Evidence reference is invalid.');
    error.code = 'INVALID_EVIDENCE_REFERENCE'; error.statusCode = 400; throw error;
  }
  const result = await runRetrieveIntegrationEvidence({ organizationId, storeId, signal, db, now });
  const item = (result.items || []).find(candidate => candidate.id === evidenceId);
  if (!item) {
    const error = new Error('Evidence reference is unavailable.');
    error.code = 'EVIDENCE_NOT_FOUND'; error.statusCode = 404; throw error;
  }
  return item;
}

async function retrieveIntegrationEvidence(options, deps = {}) {
  return runRetrieveIntegrationEvidence({ ...(options || {}), ...deps });
}

async function retrieveIntegrationEvidenceById(options, deps = {}) {
  return runRetrieveIntegrationEvidenceById({ ...(options || {}), ...deps });
}

module.exports = {
  retrieveIntegrationEvidence, retrieveIntegrationEvidenceById,
  INTEGRATION_RESOURCE_ID, INTEGRATION_RESOURCES, RESOURCE_BY_ID, SYNC_DOMAINS,
  DOMAIN_FRESH_SECONDS, classifyFailure,
};
