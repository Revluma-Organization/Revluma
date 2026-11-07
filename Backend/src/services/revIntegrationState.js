'use strict';

// Task 213 — canonical integration state model (Node gateway keystone).
//
// `rev-integration-state-v1`: ONE versioned, typed contract representing the
// real condition of a merchant's Shopify integration, shared by backend and
// frontend. The Python module
// python/src/intelligence/integration_state.py is the authoritative
// implementation of the same state machine; this service mirrors it
// byte-for-semantics (REV-DEC-0013 "two implementations, one contract") and
// a Python-generated golden fixture
// (__tests__/revIntegrationState.golden.json) pins the two together.
//
// Rules (identical to the Python keystone — do not diverge):
//
// * The overall status is a CLOSED set of 12 states; distinct conditions are
//   never collapsed into a connected/disconnected boolean.
// * The evaluator is PURE: normalized records in, contract out. No I/O, no
//   provider calls. The caller resolves tenant scope before calling and
//   normalizes the store row so the evaluator only ever sees `hasToken` —
//   never the token.
// * Authorization truth comes from the strongest RECORDED evidence (a recent
//   successful synchronization verifies credentials; a recorded grant without
//   success evidence is granted_unverified; a failed ledger attempt with an
//   authentication-class error is failed). This module never claims a
//   real-time provider verification that did not occur.
// * Connection health and synchronization health are distinct dimensions.
//
// Precedence (deterministic, first match wins):
//   1  no store record                             -> disconnected
//   2  recorded revocation / app uninstall         -> authorization_revoked
//   3  recorded disconnected / inactive / deleted  -> disconnected
//   4  platform unsupported by this build          -> unsupported
//   5  no access token recorded                    -> authorization_required
//   6  unrecognized / contradictory record         -> unknown
//   7  latest ledger evidence: credentials rejected
//      - token expired / invalid                   -> authorization_expired
//      - permission / scope rejection              -> authorization_required
//   8  required (critical) scopes missing from a RECORDED list
//                                              -> authorization_required
//   9  synchronization currently running / queued  -> synchronizing
//   10 repeated / stalled failures                 -> needs_attention
//   11 critical sync outcomes (non-auth):
//      mix succeeded + failed/partial              -> sync_partial
//      all critical failed                         -> sync_failed
//   12 persistent webhook failure                  -> needs_attention
//   13 capability restrictions without active
//      failures                                    -> limited_access
//   14 all critical capabilities operational and
//      fresh, authorization verified               -> connected
//   15 otherwise                                   -> unknown

// The database handle is resolved at CALL time (not module load) so test
// harnesses can swap the database module's exports before the controller
// is required; in production the module export is the shared Prisma client.
function resolveDb(provided) {
  return provided != null ? provided : require('../configs/database').prisma;
}
const {
  INTEGRATION_RESOURCES,
  SYNC_DOMAINS,
  DOMAIN_FRESH_SECONDS,
  classifyFailure,
  normalizeDomainStates,
  resourceCapability,
  webhookEvidence,
  scopeSatisfied,
} = require('./revIntegrationEvidenceService');

const INTEGRATION_STATE_CONTRACT_VERSION = 'rev-integration-state-v1';

const OVERALL_STATES = Object.freeze([
  'connected', 'synchronizing', 'limited_access', 'needs_attention',
  'disconnected', 'authorization_required', 'authorization_expired',
  'authorization_revoked', 'sync_failed', 'sync_partial', 'unsupported',
  'unknown',
]);

// Rollup precedence for multi-store organizations (worst first).
const STATE_SEVERITY = Object.freeze({
  authorization_revoked: 0, authorization_expired: 1, authorization_required: 2,
  needs_attention: 3, sync_failed: 4, sync_partial: 5, disconnected: 6,
  unsupported: 7, unknown: 8, synchronizing: 9, limited_access: 10, connected: 11,
});

const SYNC_PHASES = Object.freeze([
  'queued', 'scheduled', 'running', 'waiting_retrying', 'partially_completed',
  'completed', 'failed', 'cancelled', 'stalled', 'unknown',
]);

const SYNC_HEARTBEAT_MAX_SECONDS = 30 * 60;
const REPETITIVE_RETRY_COUNT = 3;
const ERROR_SINCE_MAX_SECONDS = 24 * 3600;
const RUNNING_STALL_SECONDS = 2 * 3600;
const VERIFICATION_WINDOW_SECONDS = 30 * 24 * 3600;

const SUPPORTED_PLATFORMS = ['shopify'];
const RECORDED_REVOKED = ['revoked'];
const APP_UNINSTALLED = ['app_uninstalled', 'uninstalled'];
const RECORDED_DISCONNECTED = ['disconnected', 'inactive', 'deleted'];
const ACTIVE_STATUSES = ['active', 'connected', 'syncing'];
const INSTALL_STATUSES = ['not_connected', 'connecting'];

// The OAuth scopes this build ALWAYS requests at install time. Mirrors
// Backend/src/utils/shopify.js (buildOAuthAuthorizeUrl); a test pins the two.
// Scopes for optional capabilities NOT in this set are build limitations:
// disclosed per capability, never a demotion of the overall state.
const APP_REQUESTED_SCOPES = Object.freeze([
  'read_orders', 'read_customers', 'read_products', 'read_inventory',
  'read_locations', 'read_legal_policies', 'read_online_store_navigation',
]);

function iso(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  // Match the Python keystone's byte format on whole-second instants
  // (2026-11-07T12:00:00Z, no fractional seconds); sub-second instants
  // keep milliseconds.
  if (date.getUTCMilliseconds() === 0) return date.toISOString().slice(0, 19) + 'Z';
  return date.toISOString();
}

function asDate(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function withinSeconds(dateValue, seconds, now) {
  if (!dateValue) return false;
  return (now.getTime() - dateValue.getTime()) / 1000 <= seconds;
}

function rowValue(row, key, fallback) {
  if (row == null) return fallback;
  if (typeof row === 'object' && !(row instanceof Date)) {
    if (key in row) return row[key];
  }
  return row[key] !== undefined ? row[key] : fallback;
}

function rowKeys(row) {
  if (row == null || typeof row !== 'object') return new Set();
  return new Set(Object.keys(row));
}

// ── Store record normalization (token never enters the evaluator) ────────────

function normalizeStoreRecord(row, organizationId = '') {
  if (row == null) return null;
  const keys = rowKeys(row);
  const hasToken = keys.has('access_token')
    ? row.access_token != null
    : Boolean(rowValue(row, 'has_token', false));
  const scopesRaw = rowValue(row, 'granted_scopes', null);
  const granted = String(scopesRaw == null ? '' : scopesRaw)
    .split(',').map(value => value.trim()).filter(Boolean);
  return {
    id: String(rowValue(row, 'id', '') || ''),
    organization_id: String(rowValue(row, 'organization_id', '') || organizationId),
    platform: String(rowValue(row, 'platform', '') || ''),
    shop_domain: String(rowValue(row, 'shop_domain', '') || ''),
    status: String(rowValue(row, 'status', 'unknown') || 'unknown'),
    has_token: hasToken,
    granted_scopes: granted,
    // A non-EMPTY grant list is "recorded"; NULL/empty is a data gap, not
    // proof of missing grants (Task 201 convention).
    scope_list_recorded: granted.length > 0,
    installed_at: asDate(rowValue(row, 'installed_at', null)),
    last_synced_at: asDate(rowValue(row, 'last_synced_at', null)),
    updated_at: asDate(rowValue(row, 'updated_at', null)),
  };
}

function requiredScopes() {
  const set = new Set();
  for (const resource of INTEGRATION_RESOURCES) {
    if (!resource.critical) continue;
    for (const scope of resource.scopes) set.add(scope);
  }
  return [...set].sort();
}

function missingApp(granted, recorded) {
  if (!recorded) return [];
  return APP_REQUESTED_SCOPES
    .filter(scope => !scopeSatisfied(granted, scope))
    .sort();
}

function isoVerified(domains, now) {
  const successes = Object.values(domains)
    .map(state => state.last_succeeded_at)
    .filter(Boolean)
    .map(date => date.getTime());
  if (!successes.length) return null;
  const latest = new Date(Math.max(...successes));
  return withinSeconds(latest, VERIFICATION_WINDOW_SECONDS, now) ? iso(latest) : null;
}

// ── Dimension evaluators (mirror of the Python keystone) ─────────────────────

function authorizationFor(store, domains, now) {
  const required = requiredScopes();
  if (store == null) {
    return {
      valid: false, verified: false, verification: 'not_installed',
      auth_failure_class: null, last_verified_at: null,
      granted_scopes: [], required_scopes: required,
      missing_scopes: required, missing_app_scopes: [],
      scope_list_recorded: false,
      note: 'No installation record exists; there is no authorization to evaluate.',
    };
  }
  // A recorded revocation / disconnect / uninstall dominates any success
  // evidence: the authorization is no longer valid, full stop.
  if (RECORDED_REVOKED.includes(store.status) || APP_UNINSTALLED.includes(store.status)) {
    return {
      valid: false, verified: false, verification: 'recorded_revoked',
      auth_failure_class: null, last_verified_at: null,
      granted_scopes: store.granted_scopes, required_scopes: required,
      missing_scopes: [], missing_app_scopes: [],
      scope_list_recorded: store.scope_list_recorded,
      note: 'The record shows the authorization was revoked or the app was uninstalled; success evidence predating it does not restore it.',
    };
  }
  if (RECORDED_DISCONNECTED.includes(store.status)) {
    return {
      valid: false, verified: false, verification: 'recorded_disconnected',
      auth_failure_class: null, last_verified_at: null,
      granted_scopes: store.granted_scopes, required_scopes: required,
      missing_scopes: [], missing_app_scopes: [],
      scope_list_recorded: store.scope_list_recorded,
      note: 'The record shows the store is disconnected; no current access is asserted.',
    };
  }
  const granted = store.granted_scopes;
  const recorded = store.scope_list_recorded;
  const missingRequired = recorded
    ? required.filter(scope => !scopeSatisfied(granted, scope))
    : [];
  const missingAllSet = recorded ? new Set() : new Set();
  if (recorded) {
    for (const resource of INTEGRATION_RESOURCES) {
      for (const scope of resource.scopes) {
        if (!scopeSatisfied(granted, scope)) missingAllSet.add(scope);
      }
    }
  }
  const missingAll = [...missingAllSet].sort();

  // Latest attempt dominates; ties resolve to the FIRST domain in domain
  // order (mirrors Python max() semantics exactly).
  const authFailureEntries = Object.entries(domains)
    .filter(([, state]) => ['failed', 'partial'].includes(state.state)
      && ['authentication', 'authorization'].includes(state.failure_class));
  if (authFailureEntries.length) {
    const maxTime = Math.max(...authFailureEntries.map(([, st]) => (st.attempted ? st.attempted.getTime() : 0)));
    const [worstDomain, worstState] = authFailureEntries.find(([, st]) => (st.attempted ? st.attempted.getTime() : 0) === maxTime);
    const cls = worstState.failure_class;
    const expired = cls === 'authentication';
    return {
      valid: false, verified: false,
      verification: 'failed_by_latest_evidence',
      auth_failure_class: cls,
      last_verified_at: isoVerified(domains, now),
      granted_scopes: granted, required_scopes: required,
      missing_scopes: recorded ? missingAll : missingRequired,
      missing_app_scopes: missingApp(granted, recorded),
      scope_list_recorded: recorded,
      note: expired
        ? `The most recent synchronization evidence indicates the token was expired or invalid (domain: ${worstDomain}); reconnect to restore the authorization.`
        : `The most recent synchronization evidence indicates the credentials were rejected by Shopify for a permission reason (domain: ${worstDomain}); the authorization is not currently valid.`,
    };
  }

  const verifiedAt = isoVerified(domains, now);
  if (verifiedAt != null) {
    return {
      valid: true, verified: true,
      verification: 'verified_by_successful_synchronization',
      auth_failure_class: null, last_verified_at: verifiedAt,
      granted_scopes: granted, required_scopes: required,
      missing_scopes: missingAll, missing_app_scopes: missingApp(granted, recorded),
      scope_list_recorded: recorded,
      note: 'Authorization validity is established by the most recent successful, authenticated synchronization.',
    };
  }
  if (INSTALL_STATUSES.includes(store.status)) {
    return {
      valid: false, verified: false,
      verification: store.has_token ? 'install_in_progress' : 'no_credentials_recorded',
      auth_failure_class: null, last_verified_at: null,
      granted_scopes: granted, required_scopes: required,
      missing_scopes: missingRequired, missing_app_scopes: missingApp(granted, recorded),
      scope_list_recorded: recorded,
      note: 'Installation is in progress; no authorization has been verified yet.',
    };
  }
  if (!store.has_token) {
    return {
      valid: false, verified: false, verification: 'no_credentials_recorded',
      auth_failure_class: null, last_verified_at: null,
      granted_scopes: granted, required_scopes: required,
      missing_scopes: missingRequired, missing_app_scopes: missingApp(granted, recorded),
      scope_list_recorded: recorded,
      note: 'No credentials are recorded; there is nothing to verify.',
    };
  }
  if (!recorded) {
    return {
      valid: false, verified: false, verification: 'unverified_unrecorded',
      auth_failure_class: null, last_verified_at: null,
      granted_scopes: granted, required_scopes: required,
      missing_scopes: missingRequired, missing_app_scopes: missingApp(granted, recorded),
      scope_list_recorded: recorded,
      note: 'No granted scopes are recorded and no successful synchronization has proven current access; the record alone is not asserted.',
    };
  }
  return {
    valid: false, verified: false, verification: 'granted_unverified',
    auth_failure_class: null, last_verified_at: null,
    granted_scopes: granted, required_scopes: required,
    missing_scopes: missingAll, missing_app_scopes: missingApp(granted, recorded),
    scope_list_recorded: recorded,
    note: 'Scopes are recorded as granted, but no successful synchronization has verified current access.',
  };
}

function synchronizationFor(domains, store, now) {
  const byState = {};
  for (const [domain, state] of Object.entries(domains)) {
    (byState[state.state] = byState[state.state] || []).push(domain);
  }
  const running = (byState.running || []).sort();
  const failed = (byState.failed || []).sort();
  const partial = (byState.partial || []).sort();
  const succeeded = (byState.succeeded || []).sort();

  const attemptedTimes = Object.values(domains)
    .map(state => state.last_attempted_at)
    .filter(Boolean).map(date => date.getTime());
  const lastAttempted = attemptedTimes.length ? new Date(Math.max(...attemptedTimes)) : null;
  const succeededTimes = Object.values(domains)
    .map(state => state.last_succeeded_at)
    .filter(Boolean).map(date => date.getTime());
  const lastSucceeded = succeededTimes.length ? new Date(Math.max(...succeededTimes)) : null;

  // Stall detection (recorded evidence only).
  const stalled = [];
  for (const domain of running) {
    const attempted = domains[domain].last_attempted_at;
    if (!attempted) continue;
    const policy = DOMAIN_FRESH_SECONDS[domain] || 2 * 3600;
    if (!withinSeconds(attempted, Math.max(RUNNING_STALL_SECONDS, 2 * policy), now)) stalled.push(domain);
  }
  const runningConfirmed = running.filter(domain => !stalled.includes(domain));

  const storeSyncing = Boolean(store && store.status === 'syncing');
  let heartbeatFresh = false;
  let storeStalledSync = false;
  if (storeSyncing && store.updated_at) {
    heartbeatFresh = withinSeconds(store.updated_at, SYNC_HEARTBEAT_MAX_SECONDS, now);
    storeStalledSync = !heartbeatFresh && runningConfirmed.length === 0;
  } else if (storeSyncing) {
    storeStalledSync = runningConfirmed.length === 0;
  }

  const retrying = Object.values(domains)
    .some(state => state.state === 'failed' && state.retry_count > 0);

  let phase;
  if (stalled.length || storeStalledSync) phase = 'stalled';
  else if (runningConfirmed.length) phase = 'running';
  else if (storeSyncing && heartbeatFresh) phase = 'queued';
  else if (failed.length && !succeeded.length) phase = retrying ? 'waiting_retrying' : 'failed';
  else if (failed.length || partial.length) phase = 'partially_completed';
  else if (succeeded.length) {
    const allKnown = SYNC_DOMAINS.every(domain => succeeded.includes(domain));
    phase = allKnown ? 'completed' : 'partially_completed';
  } else {
    phase = 'unknown';
  }

  const domainEntries = {};
  for (const domain of Object.keys(domains).sort()) {
    const state = domains[domain];
    domainEntries[domain] = {
      state: state.state,
      freshness: state.freshness ? state.freshness.state : null,
      last_succeeded_at: iso(state.last_succeeded_at),
      last_attempted_at: iso(state.last_attempted_at),
      retry_count: state.retry_count || 0,
      pagination_complete: state.pagination_complete === true,
      failure_class: state.failure_class || null,
      error_code: state.error_code || null,
    };
  }

  return {
    state: phase,
    active: Boolean(runningConfirmed.length || (storeSyncing && heartbeatFresh)),
    running_domains: runningConfirmed,
    stalled_domains: [...stalled].sort(),
    failed_domains: failed,
    partial_domains: partial,
    succeeded_domains: succeeded,
    retrying,
    stalled: Boolean(stalled.length || storeStalledSync),
    last_attempted_at: iso(lastAttempted),
    last_succeeded_at: iso(lastSucceeded),
    domains: domainEntries,
  };
}

function capabilitiesFor(store, domains, now) {
  const granted = store ? store.granted_scopes : [];
  return INTEGRATION_RESOURCES.map(resource => {
    const base = resourceCapability(resource, granted,
      resource.domain ? domains[resource.domain] : null, now);
    const auth = base.authorization;
    const sync = base.sync || {};
    const appRequested = resource.scopes.length
      ? resource.scopes.every(scope => APP_REQUESTED_SCOPES.includes(scope))
      : true;
    const limitedReasons = [];
    let merchantAction = false;
    let remediation = null;
    if (auth.state === 'missing_scope' && appRequested) {
      limitedReasons.push('missing_scope');
      merchantAction = true;
      remediation = `Reconnect the store and grant: ${auth.missing_scopes.join(', ')}`;
    } else if (auth.state === 'unverified_unrecorded') {
      limitedReasons.push('access_unverified');
    } else if (sync.state === 'failed' || sync.state === 'partial') {
      // A sync that RAN and failed is a real, current limitation. Critical
      // failures are caught by rule 11 before rule 13 runs; this surfaces
      // optional real failures to the limited_access rollup.
      limitedReasons.push(sync.state === 'failed' ? 'sync_failed' : 'sync_partial');
    } else if (sync.state === 'unsupported') {
      // No ledger domain: a build limitation — disclosed, never counted.
    } else if (sync.state === 'never_synchronized') {
      limitedReasons.push('not_yet_synchronized');
    } else if (sync.stale) {
      limitedReasons.push('stale_data');
    }
    // Platform approval gates (read_all_orders window, protected customer
    // data) are DISCLOSED, not counted as restrictions.
    return {
      id: resource.id,
      name: resource.id.replace(/\./g, ' ').replace(/-/g, ' '),
      category: resource.category,
      critical: resource.critical,
      supported: resource.domain != null || Boolean(auth.effective),
      app_requested: appRequested,
      authorization: auth.state,
      required_permissions: [...resource.scopes],
      missing_permissions: [...(auth.missing_scopes || [])],
      source_available: !['never_synchronized', 'unsupported', null].includes(sync.state),
      sync_state: sync.state || null,
      freshness: sync.freshness ? sync.freshness.state : null,
      operational: Boolean(base.operational),
      limited_reasons: limitedReasons,
      merchant_action_required: merchantAction,
      remediation,
      restrictions: base.restrictions,
    };
  });
}

function coverageFor(coverage) {
  const status = (coverage && coverage.status) || 'unknown';
  return {
    status,
    certified_start: (coverage && coverage.start) || null,
    certified_end: (coverage && coverage.end) || null,
    certified_at: (coverage && coverage.certified_at) || null,
    customer_lifetime_verified: Boolean(coverage && coverage.customer_lifetime_verified),
    note: status === 'complete'
      ? 'Certified order-history coverage is complete for this store.'
      : 'Certified order-history coverage is not complete; historical evidence may be bounded.',
  };
}

function webhookPersistentFailure(webhooks) {
  return webhooks.state === 'failed';
}

function webhookLimited(webhooks) {
  return ['degraded', 'unknown', 'not_registered'].includes(webhooks.state);
}

// ── Overall state resolution (the precedence algorithm) ──────────────────────

function criticalDomainSet() {
  const set = new Set();
  for (const resource of INTEGRATION_RESOURCES) {
    if (resource.critical && resource.domain) set.add(resource.domain);
  }
  return set;
}

function hasCriticalSyncFailure(synchronization) {
  const critical = criticalDomainSet();
  return [...new Set([...synchronization.failed_domains, ...synchronization.partial_domains])]
    .some(domain => critical.has(domain));
}

function hasCriticalSuccess(synchronization) {
  const critical = criticalDomainSet();
  return synchronization.succeeded_domains.some(domain => critical.has(domain));
}

function repetitiveFailure(synchronization) {
  return Object.values(synchronization.domains)
    .some(state => state.state === 'failed' && state.retry_count >= REPETITIVE_RETRY_COUNT);
}

function hasRestrictions(capabilities, coverageBlock, webhooks) {
  // Rule 13 (Task 213 §7 + Task 201 availability-vs-failure distinction):
  // COUNTED: real sync failures of any capability, stale data, a critical
  // capability never synchronized, a missing scope the app requests,
  // incomplete certified coverage, degraded webhooks.
  // NOT counted: unproven optionals, resources without a ledger domain,
  // scopes the app never requests.
  for (const cap of capabilities) {
    if (cap.sync_state === 'failed' || cap.sync_state === 'partial') return true;
    if (cap.freshness === 'stale') return true;
    if (cap.critical && cap.sync_state === 'never_synchronized') return true;
    if (cap.authorization === 'missing_scope' && cap.app_requested) return true;
  }
  if (coverageBlock.status !== 'complete') return true;
  if (webhookLimited(webhooks)) return true;
  return false;
}

function resolveOverall(store, authorization, synchronization, capabilities,
                        webhooks, coverageBlock) {
  // 1. no installation record
  if (store == null) return ['disconnected', 'no_installation_record'];
  const status = store.status;
  // 2. recorded revocation / app uninstall
  if (RECORDED_REVOKED.includes(status) || APP_UNINSTALLED.includes(status)) {
    return ['authorization_revoked', 'recorded_revoked'];
  }
  // 3. recorded disconnect
  if (RECORDED_DISCONNECTED.includes(status)) return ['disconnected', 'recorded_disconnected'];
  // 4. unsupported platform (not install-pending)
  if (!['', 'unknown'].includes(status) && !INSTALL_STATUSES.includes(status)
    && !SUPPORTED_PLATFORMS.includes(store.platform)) {
    return ['unsupported', 'platform_unsupported'];
  }
  // 5. no credentials recorded
  if (!store.has_token) return ['authorization_required', 'no_credentials_recorded'];
  // 6. unrecognized / contradictory record
  if (!ACTIVE_STATUSES.includes(status)) return ['unknown', 'unrecognized_record'];
  // 7. latest ledger evidence: credentials rejected
  if (authorization.verification === 'failed_by_latest_evidence') {
    if (authorization.auth_failure_class === 'authentication') {
      return ['authorization_expired', 'credential_expired'];
    }
    return ['authorization_required', 'credential_rejected'];
  }
  // 8. required scopes missing from a RECORDED list
  if (capabilities.some(cap => cap.critical && cap.authorization === 'missing_scope')) {
    return ['authorization_required', 'required_scope_missing'];
  }
  // 9. synchronization currently running / queued
  if (['running', 'queued'].includes(synchronization.state)) {
    return ['synchronizing', 'sync_running'];
  }
  // 10. repeated / stalled failures escalate before simple outcomes
  if (synchronization.stalled) return ['needs_attention', 'sync_stalled'];
  if (repetitiveFailure(synchronization)) return ['needs_attention', 'repeated_failure'];
  // 11. critical sync outcomes (non-auth)
  if (hasCriticalSyncFailure(synchronization)) {
    if (hasCriticalSuccess(synchronization)) return ['sync_partial', 'sync_partial'];
    return ['sync_failed', 'sync_failed'];
  }
  // 12. persistent webhook failure
  if (webhookPersistentFailure(webhooks)) return ['needs_attention', 'webhook_failure'];
  // 13. capability restrictions without active failures
  if (hasRestrictions(capabilities, coverageBlock, webhooks)) {
    return ['limited_access', 'limited_capabilities'];
  }
  // 14. connected: authorization verified + no restrictions
  if (authorization.verified) return ['connected', 'all_verified'];
  // 15. default
  return ['unknown', 'evidence_incomplete'];
}

// ── Merchant-action table + explanations (mirror of the Python keystone) ────

function actionFor(state, { reason, missingScopes }) {
  if (state === 'connected') {
    return { merchant_action_required: false, retry_appropriate: false, reconnect_appropriate: false,
      next_step: 'No action required — your store is connected and its data is synchronized.' };
  }
  if (state === 'synchronizing') {
    return { merchant_action_required: false, retry_appropriate: false, reconnect_appropriate: false,
      next_step: 'No action required — synchronization is in progress and the status updates when it completes.' };
  }
  if (state === 'disconnected') {
    if (reason === 'no_installation_record') {
      return { merchant_action_required: false, retry_appropriate: false, reconnect_appropriate: true,
        next_step: 'Connect your store to start synchronization.' };
    }
    return { merchant_action_required: true, retry_appropriate: false, reconnect_appropriate: true,
      next_step: 'Your store is not connected. Reconnect it from the Integrations page to restore data flow.' };
  }
  if (state === 'authorization_revoked') {
    return { merchant_action_required: true, retry_appropriate: false, reconnect_appropriate: true,
      next_step: 'Reinstall the Revluma app from your Shopify admin — the authorization was revoked or the app was uninstalled.' };
  }
  if (state === 'authorization_expired') {
    return { merchant_action_required: true, retry_appropriate: false, reconnect_appropriate: true,
      next_step: 'Reconnect your store — its authorization has expired. Reconnecting restores access.' };
  }
  if (state === 'authorization_required') {
    const note = missingScopes.length
      ? ` Reconnect so Revluma can request the missing permissions: ${missingScopes.join(', ')}.`
      : ' Complete or restart the Shopify connection to store valid credentials.';
    return { merchant_action_required: true, retry_appropriate: false, reconnect_appropriate: true,
      next_step: `Reconnect your store to restore authorization.${note}` };
  }
  if (state === 'sync_failed') {
    return { merchant_action_required: false, retry_appropriate: true, reconnect_appropriate: false,
      next_step: 'A data synchronization failed. It will be retried automatically; if it keeps failing, review the store on the Integrations page.' };
  }
  if (state === 'sync_partial') {
    return { merchant_action_required: false, retry_appropriate: true, reconnect_appropriate: false,
      next_step: 'Part of the data synchronization completed with gaps. The next synchronization run will complete the missing parts.' };
  }
  if (state === 'needs_attention') {
    return { merchant_action_required: true, retry_appropriate: true, reconnect_appropriate: false,
      next_step: 'The integration has a persistent problem that automatic retries have not resolved. Open the Integrations page to review the details and retry the setup.' };
  }
  if (state === 'limited_access') {
    if (missingScopes.length) {
      return { merchant_action_required: true, retry_appropriate: false, reconnect_appropriate: true,
        next_step: `Some capabilities are limited. Reconnect your store to grant the missing permissions: ${missingScopes.join(', ')}.` };
    }
    return { merchant_action_required: false, retry_appropriate: false, reconnect_appropriate: false,
      next_step: 'Your store is connected with some capabilities limited (see the capability list). No action is required unless you need a limited capability.' };
  }
  if (state === 'unsupported') {
    return { merchant_action_required: false, retry_appropriate: false, reconnect_appropriate: false,
      next_step: 'This platform is not supported by the current Revluma build.' };
  }
  return { merchant_action_required: true, retry_appropriate: false, reconnect_appropriate: true,
    next_step: 'The integration state could not be verified from the recorded evidence. Check the store on the Integrations page, or reconnect if the problem persists.' };
}

function explanationFor(state, { reason, missingScopes, failedDomains, runningDomains, storeDomain }) {
  const domain = storeDomain || 'your store';
  if (state === 'connected') return `${domain} is connected, its authorization is verified, and its data is synchronized.`;
  if (state === 'synchronizing') {
    const where = runningDomains.length ? ` for ${runningDomains.join(', ')}` : '';
    return `${domain} is connected; data synchronization is currently running${where}.`;
  }
  if (state === 'limited_access') {
    if (missingScopes.length) return `${domain} is connected, but some capabilities are limited because permissions are missing: ${missingScopes.join(', ')}.`;
    return `${domain} is connected, but some capabilities are limited (unsupported resources, approval-gated data, stale data, or bounded history).`;
  }
  if (state === 'needs_attention') {
    if (reason === 'webhook_failure') return `${domain} is connected, but webhook delivery is persistently failing; new events may not be captured reliably until it is fixed.`;
    if (reason === 'sync_stalled') return `${domain} is connected, but a synchronization appears stalled and has not made progress.`;
    if (failedDomains.length) return `${domain} is connected, but data synchronization has failed repeatedly (${failedDomains.join(', ')}) and automatic retries have not resolved it.`;
    return `${domain} is connected, but the integration has a persistent problem that automatic retries have not resolved.`;
  }
  if (state === 'disconnected') {
    if (reason === 'no_installation_record') return 'No Shopify store is connected for this account.';
    return `${domain} is not connected; its data is not being synchronized.`;
  }
  if (state === 'authorization_revoked') return `The authorization for ${domain} was revoked (the app was uninstalled or access was withdrawn).`;
  if (state === 'authorization_expired') return `The authorization for ${domain} has expired or its credentials were rejected by Shopify; the connection must be re-established.`;
  if (state === 'authorization_required') {
    if (missingScopes.length) return `${domain} is missing required permissions: ${missingScopes.join(', ')}. Reconnect to grant them.`;
    return `No valid credentials are recorded for ${domain}; the Shopify connection must be (re)established.`;
  }
  if (state === 'sync_failed') return `${domain} is connected, but the latest data synchronization failed for: ${failedDomains.join(', ')}. The connection itself remains valid.`;
  if (state === 'sync_partial') return `${domain} is connected; the latest data synchronization partially completed (gaps in: ${failedDomains.join(', ')}).`;
  if (state === 'unsupported') return 'This platform is not supported by the current Revluma build, so no capabilities are available.';
  return `The state of ${domain} could not be verified from the recorded evidence; no state is assumed.`;
}

// ── Public evaluator ─────────────────────────────────────────────────────────

/**
 * Evaluate ONE store's canonical integration state (pure).
 *
 * `records` (all optional):
 *   store                 store row or pre-normalized record
 *   domain_states         store_sync_domain_states rows
 *   webhook_registrations webhook_registrations rows
 *   webhook_deliveries    webhook_deliveries rows, caller-bounded to ~7d
 *   order_coverage        normalized coverage block or null
 *   organization_id       tenant context (resolved by the caller)
 *
 * Returns the `rev-integration-state-v1` contract. Never throws on missing
 * evidence — degrades to an explicit state with a machine-readable reason.
 */
function evaluateIntegrationState(records, now = new Date()) {
  const evaluationTime = now instanceof Date ? now : new Date(now);
  const organizationId = String((records && records.organization_id) || '');
  let store = records ? records.store : null;
  if (store != null && !Array.isArray(store.granted_scopes)) {
    store = normalizeStoreRecord(store, organizationId);
  }

  const rawDomains = (records && records.domain_states) || [];
  const domains = normalizeDomainStates(rawDomains, evaluationTime);
  // error_since is recorded evidence the Task 201 machine does not carry;
  // the keystone reads it from the raw rows for repeat detection.
  for (const row of rawDomains) {
    const domain = String(rowValue(row, 'domain', '') || '');
    const since = asDate(rowValue(row, 'error_since', null));
    if (domain && domains[domain] && since) domains[domain].error_since = since;
  }
  const webhooks = webhookEvidence((records && records.webhook_registrations) || [],
    (records && records.webhook_deliveries) || [], evaluationTime);
  const coverageBlock = coverageFor(records && records.order_coverage);

  const authorization = authorizationFor(store, domains, evaluationTime);
  const synchronization = synchronizationFor(domains, store, evaluationTime);
  const capabilities = capabilitiesFor(store, domains, evaluationTime);

  const [overallStatus, statusReason] = resolveOverall(store, authorization,
    synchronization, capabilities, webhooks, coverageBlock);
  // Merchant-facing remediation lists only scopes the app actually requests.
  const missing = authorization.missing_app_scopes || [];
  const failedDomains = synchronization.failed_domains;
  const runningDomains = synchronization.running_domains;
  const action = actionFor(overallStatus, { reason: statusReason, missingScopes: missing });

  let lastError = null;
  const errorEntries = Object.entries(domains).filter(([, state]) => state.state === 'failed');
  if (errorEntries.length) {
    const maxTime = Math.max(...errorEntries.map(([, st]) => (st.attempted ? st.attempted.getTime() : 0)));
    const [name, worst] = errorEntries.find(([, st]) => (st.attempted ? st.attempted.getTime() : 0) === maxTime);
    lastError = {
      category: worst.failure_class || 'unknown',
      domain: name,
      recoverable: !['authorization', 'authentication'].includes(worst.failure_class),
      code: worst.error_code || null,
    };
  }

  return {
    contract_version: INTEGRATION_STATE_CONTRACT_VERSION,
    integration_id: store ? store.id : null,
    organization_id: organizationId,
    store: {
      id: store ? store.id : null,
      shop_domain: store ? store.shop_domain : null,
      provider: store ? (store.platform === 'shopify' ? 'shopify' : store.platform) : null,
      installed_at: store ? iso(store.installed_at) : null,
      last_synced_at: store ? iso(store.last_synced_at) : null,
    },
    overall_status: overallStatus,
    status_reason: statusReason,
    status_explanation: explanationFor(overallStatus, {
      reason: statusReason, missingScopes: missing, failedDomains,
      runningDomains, storeDomain: store ? store.shop_domain : null,
    }),
    authorization,
    capabilities,
    synchronization,
    webhooks: {
      state: webhooks.state,
      note: webhooks.note,
      registered_topics: webhooks.registered_topics,
      active_topics: webhooks.active_topics,
      failed_topics: webhooks.failed_topics,
      // Re-serialize through this module's iso() so the byte format matches
      // the Python keystone (the shared primitive emits .000Z fractions).
      last_event_received_at: iso(webhooks.last_received_at),
      last_event_processed_at: iso(webhooks.last_processed_at),
    },
    coverage: coverageBlock,
    last_error: lastError,
    merchant_action_required: action.merchant_action_required,
    retry_appropriate: action.retry_appropriate,
    reconnect_appropriate: action.reconnect_appropriate,
    recommended_next_step: action.next_step,
    evaluated_at: iso(evaluationTime),
    source: 'stores+store_sync_domain_states+webhook_registrations+webhook_deliveries+intelligence_order_coverage',
  };
}

/** Multi-store rollup: worst overall state per STATE_SEVERITY. */
function worstState(states) {
  const present = (states || []).filter(state => state in STATE_SEVERITY);
  if (!present.length) return null;
  return present.sort((a, b) => STATE_SEVERITY[a] - STATE_SEVERITY[b])[0];
}

// Task 213 — compact projection of the canonical state for bounded contexts
// (the Rev merchant context has a hard size budget; the full contract is
// served by the product API). Carries exactly what a capability-aware answer
// needs: the state, its reason, the authorization verification basis, the
// synchronization phase, and the concrete limitations. Field-parity with
// Python canonical_state_summary.
function canonicalStateSummary(state) {
  const sync = state.synchronization;
  return {
    contract_version: state.contract_version,
    overall_status: state.overall_status,
    status_reason: state.status_reason,
    status_explanation: state.status_explanation,
    authorization: {
      verification: state.authorization.verification,
      valid: state.authorization.valid,
      verified: state.authorization.verified,
      last_verified_at: state.authorization.last_verified_at,
      missing_app_scopes: state.authorization.missing_app_scopes,
    },
    synchronization: {
      state: sync.state,
      running_domains: sync.running_domains,
      failed_domains: sync.failed_domains,
      partial_domains: sync.partial_domains,
      last_succeeded_at: sync.last_succeeded_at,
    },
    limited_capabilities: state.capabilities
      .filter(c => c.limited_reasons.length)
      .map(c => c.id),
    merchant_action_required: state.merchant_action_required,
    recommended_next_step: state.recommended_next_step,
  };
}

// ── Fail-closed contract validator (API boundary) ────────────────────────────

const AUTH_VERIFICATIONS = [
  'not_installed', 'recorded_revoked', 'recorded_disconnected',
  'failed_by_latest_evidence', 'verified_by_successful_synchronization',
  'granted_unverified', 'unverified_unrecorded', 'install_in_progress',
  'no_credentials_recorded',
];

function isIsoString(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value);
}

function validateIntegrationState(state) {
  const problems = [];
  if (state == null || typeof state !== 'object') {
    return { valid: false, problems: ['state is not an object'] };
  }
  if (state.contract_version !== INTEGRATION_STATE_CONTRACT_VERSION) {
    problems.push(`contract_version must be ${INTEGRATION_STATE_CONTRACT_VERSION}`);
  }
  if (!OVERALL_STATES.includes(state.overall_status)) {
    problems.push(`overall_status is not a member of the closed state set: ${state.overall_status}`);
  }
  if (typeof state.status_reason !== 'string' || !state.status_reason) {
    problems.push('status_reason is required');
  }
  if (typeof state.status_explanation !== 'string' || !state.status_explanation) {
    problems.push('status_explanation is required');
  }
  if (!state.authorization || typeof state.authorization !== 'object') {
    problems.push('authorization block is required');
  } else {
    if (!AUTH_VERIFICATIONS.includes(state.authorization.verification)) {
      problems.push(`authorization.verification is unknown: ${state.authorization.verification}`);
    }
    if (typeof state.authorization.valid !== 'boolean') problems.push('authorization.valid must be boolean');
    if (typeof state.authorization.verified !== 'boolean') problems.push('authorization.verified must be boolean');
    for (const key of ['granted_scopes', 'required_scopes', 'missing_scopes', 'missing_app_scopes']) {
      if (!Array.isArray(state.authorization[key])) problems.push(`authorization.${key} must be an array`);
    }
  }
  if (!Array.isArray(state.capabilities) || !state.capabilities.length) {
    problems.push('capabilities must be a non-empty array');
  } else {
    state.capabilities.forEach((cap, index) => {
      if (typeof cap.id !== 'string' || !cap.id) problems.push(`capabilities[${index}].id is required`);
      if (typeof cap.critical !== 'boolean') problems.push(`capabilities[${index}].critical must be boolean`);
      if (typeof cap.app_requested !== 'boolean') problems.push(`capabilities[${index}].app_requested must be boolean`);
    });
  }
  if (!state.synchronization || typeof state.synchronization !== 'object') {
    problems.push('synchronization block is required');
  } else {
    if (!SYNC_PHASES.includes(state.synchronization.state)) {
      problems.push(`synchronization.state is not a member of the closed phase set: ${state.synchronization.state}`);
    }
    for (const key of ['running_domains', 'failed_domains', 'partial_domains', 'succeeded_domains']) {
      if (!Array.isArray(state.synchronization[key])) problems.push(`synchronization.${key} must be an array`);
    }
    if (state.synchronization.last_succeeded_at != null && !isIsoString(state.synchronization.last_succeeded_at)) {
      problems.push('synchronization.last_succeeded_at must be an ISO-8601 UTC string or null');
    }
  }
  if (state.last_error != null) {
    if (typeof state.last_error.category !== 'string') problems.push('last_error.category must be a string');
    if (typeof state.last_error.recoverable !== 'boolean') problems.push('last_error.recoverable must be boolean');
  }
  if (typeof state.merchant_action_required !== 'boolean') {
    problems.push('merchant_action_required must be boolean');
  }
  if (typeof state.recommended_next_step !== 'string' || !state.recommended_next_step) {
    problems.push('recommended_next_step is required');
  }
  if (!isIsoString(state.evaluated_at)) problems.push('evaluated_at must be an ISO-8601 UTC string');

  // Secret-leak guard: no token/secret material may ever leave this boundary.
  const blob = JSON.stringify(state);
  if (/\b(shpat_[a-z0-9_]+|access_token|refresh_token|token_secret)\b/i.test(blob)) {
    problems.push('response appears to contain credential material');
  }
  return { valid: problems.length === 0, problems };
}

// ── Tenant-scoped retrieval (read-only; org scope resolved by the caller) ────

async function retrieveIntegrationStates({ prisma: providedPrisma, organizationId, storeId = null, now = new Date() } = {}) {
  const db = resolveDb(providedPrisma);
  if (!organizationId) throw new Error('Authenticated organization is required');
  const where = { organization_id: organizationId };
  if (storeId) where.id = storeId;
  const stores = await db.stores.findMany({ where });
  // Single-store queries return ONE state (or null for a cross-tenant /
  // unknown id — no existence leak); list queries return an array.
  if (storeId) {
    return stores.length ? evaluateOneStore(db, stores[0], organizationId, now) : null;
  }
  const out = [];
  for (const row of stores) {
    out.push(await evaluateOneStore(db, row, organizationId, now));
  }
  return out;
}

async function evaluateOneStore(db, row, organizationId, now) {
  const [ledgerRows, regRows, delivRows, covRows] = await Promise.all([
    db.store_sync_domain_states.findMany({ where: { store_id: row.id } }),
    db.webhook_registrations.findMany({ where: { store_id: row.id } }),
    db.webhook_deliveries.findMany({
      where: { store_id: row.id, received_at: { gte: new Date(now.getTime() - 7 * 24 * 3600 * 1000) } },
    }),
    db.intelligence_order_coverage.findMany({ where: { store_id: row.id } }),
  ]);
  const coverage = coverageFromRows(covRows);
  const normalized = normalizeStoreRecord(row, organizationId);
  return evaluateIntegrationState({
    store: normalized,
    domain_states: ledgerRows,
    webhook_registrations: regRows,
    webhook_deliveries: delivRows,
    order_coverage: coverage,
    organization_id: organizationId,
  }, now);
}

function coverageFromRows(rows) {
  if (!rows || !rows.length) return null;
  const starts = rows.map(row => row.coverage_start).filter(Boolean);
  const ends = rows.map(row => row.coverage_end).filter(Boolean);
  const status = starts.length === rows.length ? 'complete' : 'partial';
  return {
    status,
    start: starts.length ? iso(new Date(Math.max(...starts.map(date => date.getTime())))) : null,
    end: ends.length ? iso(new Date(Math.max(...ends.map(date => date.getTime())))) : null,
    certified_at: rows.length ? iso(rows.reduce((max, row) =>
      (!max || row.certified_at > max.certified_at) ? row : max, rows[0]).certified_at) : null,
    customer_lifetime_verified: rows.some(row => row.customer_lifetime_verified === true),
  };
}

module.exports = {
  INTEGRATION_STATE_CONTRACT_VERSION,
  OVERALL_STATES,
  STATE_SEVERITY,
  SYNC_PHASES,
  APP_REQUESTED_SCOPES,
  evaluateIntegrationState,
  normalizeStoreRecord,
  worstState,
  canonicalStateSummary,
  validateIntegrationState,
  retrieveIntegrationStates,
};
