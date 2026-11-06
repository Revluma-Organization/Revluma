'use strict';

// Universal capability report: fused view of
//   - resourceRegistry (what could exist, what we wired, under what rules)
//   - store.granted_scopes (merchant consent evidence — recorded at OAuth)
//   - sync ledger (what actually happened per domain)
// Pure given (registry entry, ledger row, granted scope set). No I/O.
//
// Status vocabulary (message-6 §10):
//   IMPLEMENTED_VERIFIED     — acquisition live + production-verified visibility (per registry), ledger ok
//   IMPLEMENTED_UNVERIFIED   — wired (or live once) but not verified for THIS store NOW
//   REQUIRES_ADDITIONAL_SCOPES — merchant consent does not cover required scopes
//   REQUIRES_APP_APPROVAL    — Shopify app review/protected-data or equivalent approval gate
//   PLAN_RESTRICTED          — merchant plan blocks the surface (e.g. Markets on non-Plus)
//   SYNC_FAILED              — latest run errored; error_code present
//   ACCESS_DENIED            — Shopify rejected the surface for this app/store
//   UNAVAILABLE_PLATFORM     — surface not accessible to non-approved partner apps
//   NOT_IMPLEMENTED          — we have not built it (registry acquisition=not_implemented)
//   RECONCILIATION_FAILED    — source↔DB reconciliation mismatch (reserved; set only with evidence)

const STATUS = Object.freeze({
  IMPLEMENTED_VERIFIED: 'IMPLEMENTED_VERIFIED',
  IMPLEMENTED_UNVERIFIED: 'IMPLEMENTED_UNVERIFIED',
  REQUIRES_ADDITIONAL_SCOPES: 'REQUIRES_ADDITIONAL_SCOPES',
  REQUIRES_APP_APPROVAL: 'REQUIRES_APP_APPROVAL',
  PLAN_RESTRICTED: 'PLAN_RESTRICTED',
  SYNC_FAILED: 'SYNC_FAILED',
  ACCESS_DENIED: 'ACCESS_DENIED',
  UNAVAILABLE_PLATFORM: 'UNAVAILABLE_PLATFORM',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  RECONCILIATION_FAILED: 'RECONCILIATION_FAILED',
});

// Registry id → ledger domain (null when no ledger family exists yet)
const LEDGER_DOMAIN_BY_ID = Object.freeze({
  'products': 'products',
  'product.variants': 'variants',
  'inventory.items': 'inventory',
  'inventory.levels': 'inventory',
  'inventory.locations': 'locations',
  'orders': 'orders',
  'order.transactions': 'transactions',
  'order.refunds': 'refunds',
  'order.fulfillments': 'fulfillments',
  'customers': 'customers',
  'abandoned-checkouts': 'abandoned_checkouts',
  'webhooks': 'webhooks',
});

function hasApproval(entry) {
  const a = String(entry.approval || 'none');
  return a !== 'none';
}

function universalStatus(entry, ledgerRow, grantedSet) {
  const required = Array.isArray(entry.scopes) ? entry.scopes : [];
  const granted = grantedSet instanceof Set ? grantedSet : new Set(grantedSet || []);
  const missing = required.filter(scope => !granted.has(scope));

  // 1) Evidence rules first: a ledger row that says DENIED beats any optimism.
  if (ledgerRow && String(ledgerRow.status || '').toLowerCase() === 'degraded') {
    const code = String(ledgerRow.error_code || '');
    if (/ACCESS_DENIED/i.test(code)) return STATUS.ACCESS_DENIED;
    return STATUS.SYNC_FAILED;
  }
  if (ledgerRow && String(ledgerRow.status || '').toLowerCase() === 'failed') return STATUS.SYNC_FAILED;

  // 2) Scopes gate: do not call anything verified when consent does not cover it.
  if (missing.length) return STATUS.REQUIRES_ADDITIONAL_SCOPES;

  // 3) App approval & plan gates outrank "not_implemented" — different remedy path.
  if (hasApproval(entry) && entry.acquisition === 'not_implemented') return STATUS.REQUIRES_APP_APPROVAL;
  if (Array.isArray(entry.planRestrictions) && entry.planRestrictions.length && entry.acquisition === 'not_implemented') return STATUS.PLAN_RESTRICTED;

  // 4) Not built.
  if (entry.acquisition === 'not_implemented') return STATUS.NOT_IMPLEMENTED;
  if (entry.acquisition === 'blocked') return STATUS.UNAVAILABLE_PLATFORM;

  // 5) Built: verified only with CURRENT ledger evidence (ok + pagination complete where relevant).
  if (ledgerRow && String(ledgerRow.status || '').toLowerCase() === 'ok') {
    const paginationComplete = ledgerRow.pagination_complete !== false; // non-paginated reads default complete
    if (paginationComplete && entry.verification === 'live_read') return STATUS.IMPLEMENTED_VERIFIED;
    return STATUS.IMPLEMENTED_UNVERIFIED;
  }
  // Built but never ran (or ledger not yet wired/persisted): cannot claim verified.
  return STATUS.IMPLEMENTED_UNVERIFIED;
}

function universalRow(entry, ledgerRow, grantedScopes) {
  const required = Array.isArray(entry.scopes) ? entry.scopes : [];
  const granted = new Set(Array.isArray(grantedScopes) ? grantedScopes : String(grantedScopes || '').split(',').map(s => s.trim()).filter(Boolean));
  const missing = required.filter(scope => !granted.has(scope));
  const status = universalStatus(entry, ledgerRow, granted);
  const ledgerDomain = LEDGER_DOMAIN_BY_ID[entry.id] || null;
  return {
    id: entry.id,
    name: entry.name,
    category: entry.category,
    surface: entry.surface,
    status,
    implementation: entry.acquisition,
    verification_basis: entry.verification || 'none',
    required_scopes: required,
    granted_required_scopes: required.filter(scope => granted.has(scope)),
    missing_scopes: missing,
    recorded_granted_scopes: [...granted], // admin-only audience; no PII
    additional_approval: hasApproval(entry) ? entry.approval : null,
    plan_restrictions: entry.planRestrictions || [],
    restrictions: entry.restrictions || [],
    ledger_domain: ledgerDomain,
    records_discovered: ledgerRow?.records_discovered ?? null,
    records_inserted: ledgerRow?.records_inserted ?? null,
    records_updated: ledgerRow?.records_updated ?? null,
    records_deleted: ledgerRow?.records_deleted ?? null,
    pages_completed: ledgerRow?.pages_completed ?? null,
    pagination_complete: ledgerRow?.pagination_complete ?? null,
    retry_count: ledgerRow?.retry_count ?? null,
    error_code: ledgerRow?.error_code ?? null,
    last_attempted_at: ledgerRow?.last_attempted_at ?? null,
    last_succeeded_at: ledgerRow?.last_succeeded_at ?? null,
    freshness_seconds: ledgerRow?.freshness_seconds ?? null,
    reconciliation: {
      // Source↔DB reconciliation counters. Populated only after a genuine
      // re-read comparison runs; null means "not run", never "passed".
      missing: null,
      duplicates: null,
      mapping_errors: null,
      last_run_at: null,
    },
    reason:
      status === STATUS.REQUIRES_ADDITIONAL_SCOPES ? `merchant must re-consent for: ${missing.join(', ')}`
      : status === STATUS.REQUIRES_APP_APPROVAL ? `shopify app approval required: ${entry.approval}`
      : status === STATUS.PLAN_RESTRICTED ? `merchant plan restriction: ${(entry.planRestrictions || []).join('; ')}`
      : status === STATUS.ACCESS_DENIED ? (ledgerRow?.error_code || 'shopify refused this surface for this app/store')
      : status === STATUS.SYNC_FAILED ? (ledgerRow?.error_code || 'latest sync failed')
      : status === STATUS.NOT_IMPLEMENTED ? (entry.restrictions?.[0] || 'not yet implemented')
      : status === STATUS.UNAVAILABLE_PLATFORM ? 'surface not available to non-partner-approved apps'
      : null,
  };
}

module.exports = { universalStatus, universalRow, LEDGER_DOMAIN_BY_ID, STATUS };
