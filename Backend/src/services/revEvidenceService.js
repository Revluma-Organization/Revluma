'use strict';

const { prisma: defaultDb } = require('../configs/database');
const { getResource, IMPLEMENTED_IDS } = require('./resourceRegistry');
const { getAuthorizedResource, authorizedResourceIds } = require('./authorizedResourceCatalog');
const { requiredScopes, scopeSatisfied } = require('./authorizedDataService');
const { normalizeCurrency, totalsByCurrency } = require('./financialIntegrity');
const {
  EVIDENCE_SCHEMA_VERSION, createEvidence, validateEvidenceCollection,
} = require('./revEvidenceContract');

const MAX_CONTEXT_ITEMS = 24;
const MAX_REFERENCES_PER_ITEM = 40;
const DEFAULT_FRESH_SECONDS = Math.max(60, Number(process.env.REV_EVIDENCE_FRESH_SECONDS) || 2 * 3600);
const DOMAIN_FRESHNESS = Object.freeze({
  orders: 3600, transactions: 3600, refunds: 3600, inventory: 1800,
  customers: 4 * 3600, products: 2 * 3600, content: 24 * 3600,
  discounts: 3600, checkouts: 1800,
});

function domainFor(resourceId) {
  return getResource(resourceId)?.category || String(resourceId).split('.')[0] || 'store';
}

function freshnessPolicy(resourceId) {
  const domain = domainFor(resourceId);
  const configured = Number(process.env[`REV_EVIDENCE_FRESH_${domain.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_SECONDS`]);
  return Number.isFinite(configured) && configured >= 60 ? configured : (DOMAIN_FRESHNESS[domain] || DEFAULT_FRESH_SECONDS);
}

function iso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function freshnessFor(resourceId, syncedAt, status, now) {
  const asOf = iso(syncedAt);
  const policySeconds = freshnessPolicy(resourceId);
  if (status === 'running') return { state: 'synchronizing', as_of: asOf, age_seconds: null, policy: `${policySeconds}s`, note: 'Synchronization is in progress; no completed result is asserted.' };
  if (!asOf) return { state: 'never_synchronized', as_of: null, age_seconds: null, policy: `${policySeconds}s`, note: 'No successful synchronization timestamp is available.' };
  const ageSeconds = Math.max(0, Math.floor((now.getTime() - Date.parse(asOf)) / 1000));
  const state = ageSeconds <= policySeconds ? 'fresh' : ageSeconds <= policySeconds * 2 ? 'aging' : 'stale';
  return { state, as_of: asOf, age_seconds: ageSeconds, policy: `${policySeconds}s`, note: `Domain freshness policy: fresh <= ${policySeconds}s, aging <= ${policySeconds * 2}s.` };
}

function snapshotPeriod(store, now) {
  const end = iso(store.last_synced_at) || now.toISOString();
  const startDate = new Date(Math.min(Date.parse(end), now.getTime()) - 1000);
  return { start: startDate.toISOString(), end: now.toISOString(), timezone: 'UTC', semantics: '[start, end)', label: 'Current synchronized snapshot' };
}

function coverage(status, note, source = 'store_sync_domain_states') {
  const complete = status === 'complete';
  return {
    status, complete, period_status: complete ? 'current_snapshot' : status === 'partial' ? 'partial' : 'unavailable',
    source, note,
  };
}

function confidenceFor(status, freshness) {
  if (['available', 'verified_zero'].includes(status) && freshness.state === 'fresh') return { level: 'high', score: 0.95, basis: 'Complete paginated source retrieval, active snapshot reconciliation and fresh domain ledger.' };
  if (['available', 'partial', 'stale'].includes(status)) return { level: 'medium', score: 0.55, basis: 'Evidence is explicitly partial, aging or stale and must not be presented as current complete coverage.' };
  return { level: 'none', score: 0, basis: 'No affirmative store metric is established.' };
}

function unknownEvidence({ store, resourceId, status, coverageStatus, note, now, freshness }) {
  const storeIds = [store.id];
  return createEvidence({
    organization_id: store.organization_id, store_id: store.id, store_ids: storeIds,
    evidence_type: 'resource_availability', domain: domainFor(resourceId),
    classification: 'unknown', status, metric: `${resourceId}.availability`,
    label: `${resourceId}: ${status}`, value: null, unit: 'reference', currency: null,
    definition: note, period: snapshotPeriod(store, now),
    source: { system: 'shopify', resource: resourceId, references: [] },
    retrieved_at: now.toISOString(), computed_at: null,
    coverage: coverage(coverageStatus, note), freshness,
    provenance: { retrieval: 'none', transformation: 'No value calculated because the required source conditions were not satisfied.', calculation_version: null, lineage: [`resource:${resourceId}`], reproducible: false },
    measurement: null, confidence: confidenceFor(status, freshness),
    store_scope: 'store', limitations: [note],
  });
}

async function authorizedStores(db, organizationId, storeId) {
  if (!organizationId || typeof organizationId !== 'string') {
    const error = new Error('Authenticated organization context is required.'); error.code = 'EVIDENCE_AUTHORIZATION_REQUIRED'; error.statusCode = 403; throw error;
  }
  const where = { organization_id: organizationId, platform: 'shopify', ...(storeId ? { id: storeId } : {}) };
  const stores = storeId
    ? await db.stores.findFirst({ where, select: { id: true, organization_id: true, status: true, last_synced_at: true, granted_scopes: true } })
    : await db.stores.findMany({ where, orderBy: { id: 'asc' }, take: 8, select: { id: true, organization_id: true, status: true, last_synced_at: true, granted_scopes: true } });
  const result = storeId ? (stores ? [stores] : []) : stores;
  if (storeId && !result.length) {
    const error = new Error('Store evidence is unavailable.'); error.code = 'EVIDENCE_STORE_NOT_AUTHORIZED'; error.statusCode = 404; throw error;
  }
  return result;
}

function grantedScopes(store) {
  return String(store.granted_scopes || '').split(',').map(value => value.trim()).filter(Boolean);
}

function scopesFor(resourceId) {
  const registry = getResource(resourceId);
  return registry?.scopes || requiredScopes(resourceId);
}

// Certification gate shared by resource snapshot evidence and computed
// revenue evidence: a value is only asserted when the domain ledger proves
// a complete, reconciled, sufficiently fresh snapshot.
//
// `countCheck` (default true) additionally reconciles the active
// commerce_resource_records snapshot count and row provenance against the
// ledger. Computed revenue does not read commerce_resource_records (it sums
// the orders table), so it certifies on the ledger alone.
function snapshotGate({ store, resourceId, ledgerRow, aggregateRows = [], sampleRows = [], now, countCheck = true }) {
  const freshness = freshnessFor(resourceId, ledgerRow?.last_succeeded_at || ledgerRow?.last_checked_at, ledgerRow?.status, now);
  const registry = getResource(resourceId);
  if (!registry || registry.acquisition === 'blocked' || registry.acquisition === 'not_implemented') {
    return { deny: unknownEvidence({ store, resourceId, status: 'unsupported', coverageStatus: 'unsupported', note: 'This resource is not a supported implemented capability.', now, freshness }) };
  }
  const missing = scopesFor(resourceId).filter(scope => !scopeSatisfied(grantedScopes(store), scope));
  if (missing.length) {
    return { deny: unknownEvidence({ store, resourceId, status: 'unauthorized', coverageStatus: 'missing_authorization', note: `Required Shopify authorization is not granted: ${missing.join(', ')}.`, now, freshness }) };
  }
  if (!ledgerRow) {
    return { deny: unknownEvidence({ store, resourceId, status: 'not_synchronized', coverageStatus: 'not_synchronized', note: 'This resource has no synchronization ledger; absence of records is not zero activity.', now, freshness }) };
  }
  if (ledgerRow.status === 'running') {
    return { deny: unknownEvidence({ store, resourceId, status: 'pending', coverageStatus: 'synchronizing', note: 'Synchronization is in progress; evidence is pending completion.', now, freshness }) };
  }
  if (['degraded', 'failed'].includes(ledgerRow.status)) {
    const denied = ledgerRow.status === 'degraded' && /ACCESS_DENIED|PERMISSION/.test(String(ledgerRow.error_code || ''));
    return { deny: unknownEvidence({ store, resourceId, status: denied ? 'unauthorized' : 'retrieval_failed', coverageStatus: denied ? 'missing_authorization' : 'retrieval_failed', note: `Latest resource synchronization did not complete (${ledgerRow.error_code || 'sync_error'}).`, now, freshness }) };
  }
  if (ledgerRow.status !== 'ok' || ledgerRow.pagination_complete !== true) {
    return { deny: unknownEvidence({ store, resourceId, status: 'partial', coverageStatus: 'partial', note: 'The resource has not completed a fully paginated synchronized snapshot.', now, freshness }) };
  }
  const reconciliation = ledgerRow.checkpoint?.reconciliation;
  if (reconciliation && [reconciliation.missing, reconciliation.duplicates, reconciliation.mapping_errors].some(value => Number(value) !== 0)) {
    return { deny: unknownEvidence({ store, resourceId, status: 'contradictory', coverageStatus: 'contradictory', note: 'Source reconciliation reported missing, duplicate or invalid records.', now, freshness }) };
  }
  let count = 0;
  if (countCheck) {
    const aggregate = aggregateRows.find(row => row.resource_id === resourceId);
    count = Number(aggregate?._count?._all || 0);
    if (count !== Number(ledgerRow.records_discovered || 0)) {
      return { deny: unknownEvidence({ store, resourceId, status: 'contradictory', coverageStatus: 'contradictory', note: 'Active snapshot count does not match the successful synchronization ledger.', now, freshness }) };
    }
    const samples = sampleRows.filter(row => row.resource_id === resourceId);
    if (samples.some(row => !row.source_id || !row.sync_run_id || !row.content_hash)) {
      return { deny: unknownEvidence({ store, resourceId, status: 'invalid', coverageStatus: 'invalid', note: 'An active source record is missing required identity or provenance.', now, freshness }) };
    }
    return { ok: {
      count, samples, freshness,
      runId: ledgerRow.checkpoint?.sync_run_id || samples[0]?.sync_run_id || null,
      retrievedAt: iso(aggregate?._max?.synced_at || ledgerRow.last_succeeded_at),
    } };
  }
  // Ledger-certified but no snapshot-record count reconciliation (computed
  // metrics): the run identity and ledger timestamp still anchor provenance.
  return { ok: {
    count: 0, samples: [], freshness,
    runId: ledgerRow.checkpoint?.sync_run_id || null,
    retrievedAt: iso(ledgerRow.last_succeeded_at),
  } };
}

async function resourceEvidence(store, resourceId, ledgerRow, aggregateRows, sampleRows, now) {
  const gate = snapshotGate({ store, resourceId, ledgerRow, aggregateRows, sampleRows, now });
  if (gate.deny) return gate.deny;
  const { count, samples, runId, freshness, retrievedAt } = gate.ok;
  const status = freshness.state === 'stale' ? 'stale' : count === 0 ? 'verified_zero' : 'available';
  return createEvidence({
    organization_id: store.organization_id, store_id: store.id, store_ids: [store.id],
    evidence_type: 'resource_snapshot_count', domain: domainFor(resourceId),
    classification: 'deterministic_calculation', status, metric: `${resourceId}.active_record_count`,
    label: `${resourceId} active records`, value: count, unit: 'count', currency: null,
    definition: 'Count of distinct active records from the latest completely paginated and reconciled Shopify snapshot. A zero is asserted only with complete current-snapshot coverage.',
    period: snapshotPeriod(store, now),
    source: {
      system: 'shopify', resource: resourceId,
      references: samples.slice(0, MAX_REFERENCES_PER_ITEM).map(row => ({ source_id: row.source_id, resource: resourceId, sync_run_id: row.sync_run_id })),
    },
    retrieved_at: retrievedAt || now.toISOString(),
    computed_at: now.toISOString(), coverage: coverage('complete', 'Latest snapshot completed root and nested pagination and passed active-record reconciliation.'),
    freshness,
    provenance: {
      retrieval: 'aggregate', transformation: 'COUNT active commerce_resource_records for the authorized store and resource; reconcile to the source ledger.',
      calculation_version: 'active-snapshot-count-v1',
      lineage: [`ledger:${resourceId}`, ...(runId ? [`sync_run:${runId}`] : []), `content_hashes:${samples.length}`], reproducible: true,
    },
    measurement: null, confidence: confidenceFor(status, freshness), store_scope: 'store',
    limitations: ['Current synchronized snapshot, not historical activity or a store-wide revenue measure.', ...(samples.length < count ? [`Source references are bounded to ${samples.length} of ${count} records.`] : [])],
  });
}

const REVENUE_RESOURCE_ID = 'revenue';
const IANA_TIMEZONE_ERROR = 'EVIDENCE_PERIOD_INVALID';

function validIanaTimezone(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const candidate = value.trim().slice(0, 80);
  try { new Intl.DateTimeFormat('en', { timeZone: candidate }); return candidate; }
  catch { return null; }
}

function periodError(message) {
  const error = new Error(message);
  error.code = IANA_TIMEZONE_ERROR;
  error.statusCode = 400;
  return error;
}

// Task 198 — computed revenue resource. Revenue is never a snapshotted
// resource; it is calculated from the certified orders snapshot, per
// verified currency. Incompatible currencies are never summed, and no
// figure is asserted without the same ledger certification the snapshot
// count requires.
function resolveRevenuePeriod(period, store, now) {
  if (!period) {
    const end = now.toISOString();
    const start = iso(store.last_synced_at) || end;
    return {
      start: start < end ? start : new Date(Date.parse(end) - 1).toISOString(),
      end, timezone: 'UTC', semantics: '[start, end)',
      label: 'Since last orders sync (current synchronized snapshot)',
      explicit: false,
    };
  }
  const start = typeof period.start === 'string' ? period.start : null;
  const end = typeof period.end === 'string' ? period.end : null;
  const startMs = start ? Date.parse(start) : NaN;
  const endMs = end ? Date.parse(end) : NaN;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw periodError('start and end must be ISO timestamps with end after start.');
  }
  if (period.timezone != null && period.timezone !== '') {
    const explicit = validIanaTimezone(period.timezone);
    if (!explicit) throw periodError('timezone must be a valid IANA timezone.');
  }
  const timezone = validIanaTimezone(period.timezone) || 'UTC';
  return {
    start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(),
    timezone, semantics: '[start, end)', label: 'Requested reporting period',
    explicit: true,
  };
}

function revenueDenial(note, { store, resourceId, now, freshness }) {
  return unknownEvidence({ store, resourceId, status: 'partial', coverageStatus: 'partial', note, now, freshness });
}

async function revenueEvidence(store, period, orderRows, ledgerRow, profileCurrency, now) {
  const gate = snapshotGate({ store, resourceId: 'orders', ledgerRow, now, countCheck: false });
  if (gate.deny) {
    // The denial evidence already carries the orders-domain source and
    // status; it is exactly why revenue cannot be asserted for this store.
    return gate.deny;
  }
  const { count, samples, runId, freshness } = gate.ok;
  const periodNote = period.explicit
    ? 'The period was requested by the caller; the certified snapshot must contain it (orders sync window defaults to 60 days), so completeness is asserted as partial.'
    : 'Latest orders snapshot completed root and nested pagination and passed active-record reconciliation for the requested period.';
  const coverageStatus = period.explicit ? 'partial' : 'complete';
  const currencyStatus = freshness.state === 'stale' ? 'stale' : null;
  const base = {
    organization_id: store.organization_id, store_id: store.id, store_ids: [store.id],
    evidence_type: 'revenue_metric', domain: 'orders',
    period,
    source: {
      system: 'shopify', resource: 'orders',
      references: samples.slice(0, MAX_REFERENCES_PER_ITEM).map(row => ({ source_id: row.source_id, resource: 'orders', sync_run_id: row.sync_run_id })),
    },
    retrieved_at: gate.ok.retrievedAt || now.toISOString(),
    computed_at: now.toISOString(),
    coverage: coverage(coverageStatus, periodNote),
    freshness,
    store_scope: 'store',
  };
  const totals = totalsByCurrency(orderRows, { valueKey: 'total', currencyKey: 'currency' });
  if (totals.currencies.length === 1) {
    const { currency, value } = totals.currencies[0];
    const amount = value.toFixed(2);
    const status = currencyStatus || (period.explicit ? 'partial' : 'available');
    return createEvidence({
      ...base,
      classification: 'deterministic_calculation', status,
      metric: 'revenue.recorded_order_value',
      label: `Recorded order value (${currency})`,
      value: amount, unit: 'currency', currency,
      definition: 'Sum of recorded order totals for non-test orders in the period, in the verified order currency. Orders without a verified ISO currency code are excluded and reported, never coerced into a default currency.',
      provenance: {
        retrieval: 'direct',
        transformation: 'SUM(orders.total) over non-test orders with ordered_at in [start, end), grouped by verified order currency; rows without a verified ISO currency are excluded and reported.',
        calculation_version: 'revenue-recorded-order-value-v1',
        lineage: [`ledger:orders`, ...(runId ? [`sync_run:${runId}`] : []), `order_rows:${orderRows.length}`, `currencies:${currency}`],
        reproducible: true,
      },
      measurement: {
        amount, currency, interpretation: 'net', tax: 'unknown', shipping: 'unknown',
        discounts: 'included', refunds: 'deducted', cancellations: 'unknown',
        numerator: null, denominator: null,
        formula: 'SUM(orders.total) WHERE ordered_at IN [start, end) AND test_flag IS NOT TRUE',
      },
      confidence: confidenceFor(status, freshness),
      limitations: [
        'Recorded order value is not a store-wide revenue measure: unsettled, in-transit or platform-level adjustments are not included.',
        ...(totals.rejected ? [`${totals.rejected} order row(s) without a verified ISO currency code were excluded and are not part of this total.`] : []),
      ],
    });
  }
  if (totals.currencies.length === 0) {
    if (count === 0 && profileCurrency && !period.explicit && !currencyStatus) {
      // Zero orders in a fully certified window: a currency zero is an
      // asserted "0.00" in the store's configured currency, never a count
      // zero or an unlabelled figure.
      const amount = '0.00';
      return createEvidence({
        ...base,
        classification: 'deterministic_calculation', status: 'available',
        metric: 'revenue.recorded_order_value',
        label: `Recorded order value (${profileCurrency})`,
        value: amount, unit: 'currency', currency: profileCurrency,
        definition: 'Sum of recorded order totals for non-test orders in the period. Zero orders were recorded in a fully certified window, so a zero is asserted in the store configured currency.',
        provenance: {
          retrieval: 'direct',
          transformation: 'SUM(orders.total) over non-test orders with ordered_at in [start, end); no rows present in a fully certified window.',
          calculation_version: 'revenue-recorded-order-value-v1',
          lineage: [`ledger:orders`, ...(runId ? [`sync_run:${runId}`] : []), `order_rows:0`, `currencies:${profileCurrency}`],
          reproducible: true,
        },
        measurement: {
          amount, currency: profileCurrency, interpretation: 'net', tax: 'not_applicable',
          shipping: 'not_applicable', discounts: 'not_applicable', refunds: 'not_applicable',
          cancellations: 'not_applicable', numerator: null, denominator: null, formula: 'SUM(orders.total) = 0 over certified empty window',
        },
        confidence: confidenceFor('available', freshness),
        limitations: ['Recorded order value is not a store-wide revenue measure: unsettled, in-transit or platform-level adjustments are not included.'],
      });
    }
    return revenueDenial(count === 0
      ? 'No orders were recorded in the certified window, and no verified currency is available to label a monetary amount, so no revenue figure is asserted.'
      : `${count} order(s) were recorded, but none has a verified ISO currency code, so no monetary revenue total can be asserted.`,
      { store, resourceId: 'orders', now, freshness });
  }
  return revenueDenial(
    `Orders in multiple currencies (${totals.currencies.map(c => c.currency).join(', ')}) cannot be summed into one scalar; per-currency revenue must be requested or computed separately.`,
    { store, resourceId: 'orders', now, freshness });
}

async function retrieveRevenueEvidence(db, organizationId, stores, options, now, signal) {
  const storeIds = stores.map(store => store.id);
  const ledgerRows = await db.store_sync_domain_states.findMany({
    where: { OR: stores.map(store => ({ store_id: store.id, domain: 'orders' })) },
  });
  const profiles = db.store_profiles
    ? await db.store_profiles.findMany({ where: { store_id: { in: storeIds } }, select: { store_id: true, currency_code: true } })
    : [];
  const profileCurrencyByStore = new Map(profiles.map(profile => [profile.store_id, normalizeCurrency(profile.currency_code)]));
  const items = [];
  for (const store of stores) {
    if (signal?.aborted) { const error = new Error('Evidence retrieval cancelled.'); error.code = 'EVIDENCE_RETRIEVAL_CANCELLED'; error.statusCode = 499; throw error; }
    const period = resolveRevenuePeriod(options.period, store, now);
    const orderRows = await db.orders.findMany({
      where: {
        store_id: store.id,
        ordered_at: { gte: period.start, lt: period.end },
        OR: [{ test_flag: null }, { test_flag: false }],
      },
      select: { total: true, currency: true },
    });
    const ledgerRow = ledgerRows.find(row => row.store_id === store.id && row.domain === 'orders') || null;
    items.push(await revenueEvidence(store, period, orderRows, ledgerRow, profileCurrencyByStore.get(store.id) || null, now));
    if (items.length >= Math.min(Math.max(1, Number(options.limit) || MAX_CONTEXT_ITEMS), 100)) break;
  }
  const validation = validateEvidenceCollection(items, { organizationId, storeIds });
  if (!validation.valid) { const error = new Error('Evidence contract validation failed.'); error.code = 'EVIDENCE_CONTRACT_INVALID'; error.details = validation.errors; throw error; }
  return {
    schema_version: EVIDENCE_SCHEMA_VERSION, generated_at: now.toISOString(), items,
    errors: items.filter(item => !['available', 'verified_zero'].includes(item.status)).map(item => ({ code: item.status.toUpperCase(), resource_id: item.source.resource, evidence_id: item.id })),
    complete: items.length > 0 && items.every(item => ['available', 'verified_zero'].includes(item.status) && item.coverage.complete && item.freshness.state === 'fresh'),
  };
}

async function retrieveEvidence({ organizationId, storeId = null, resourceId = null, limit = MAX_CONTEXT_ITEMS, period = null, signal } = {}, deps = {}) {
  const db = deps.db || defaultDb;
  const now = deps.now ? new Date(deps.now) : new Date();
  if (signal?.aborted) { const error = new Error('Evidence retrieval cancelled.'); error.code = 'EVIDENCE_RETRIEVAL_CANCELLED'; error.statusCode = 499; throw error; }
  const stores = await authorizedStores(db, organizationId, storeId);
  const resources = resourceId ? [resourceId] : [...new Set([...IMPLEMENTED_IDS, ...authorizedResourceIds()])];
  if (!stores.length) return { schema_version: EVIDENCE_SCHEMA_VERSION, generated_at: now.toISOString(), items: [], errors: [{ code: 'NO_AUTHORIZED_STORE', resource_id: resourceId }], complete: false };
  if (period != null && resourceId !== REVENUE_RESOURCE_ID) {
    // A reporting period only means something for computed evidence. For
    // snapshot resources it would be silently ignored, which is worse than a
    // 400 — reject it.
    const error = new Error('Reporting period parameters are only supported for the computed revenue resource.');
    error.code = 'EVIDENCE_PERIOD_UNSUPPORTED'; error.statusCode = 400;
    throw error;
  }
  if (resourceId === REVENUE_RESOURCE_ID) {
    // Validate the requested period before any order read (fail fast, 400).
    resolveRevenuePeriod(period, stores[0], now);
    try {
      return await retrieveRevenueEvidence(db, organizationId, stores, { period, limit }, now, signal);
    } catch (cause) {
      if (cause.code?.startsWith('EVIDENCE_')) throw cause;
      const error = new Error('Revenue evidence retrieval failed.');
      error.code = 'EVIDENCE_STORAGE_FAILURE'; error.statusCode = 503; error.cause = cause;
      throw error;
    }
  }
  const storeIds = stores.map(store => store.id);
  try {
    const authorizedPairs = stores.flatMap(store => resources.flatMap(id => {
      const registry = getResource(id);
      const document = getAuthorizedResource(id);
      if (!registry || registry.acquisition === 'blocked' || registry.acquisition === 'not_implemented') return [];
      return scopesFor(id).every(scope => scopeSatisfied(grantedScopes(store), scope))
        ? [{ store_id: store.id, resource_id: id }] : [];
    }));
    const scopedWhere = { OR: authorizedPairs };
    const [ledgerRows, aggregates, samples] = authorizedPairs.length ? await Promise.all([
      db.store_sync_domain_states.findMany({ where: { OR: authorizedPairs.map(pair => ({ store_id: pair.store_id, domain: pair.resource_id })) } }),
      db.commerce_resource_records.groupBy({
        by: ['store_id', 'resource_id'], where: { ...scopedWhere, active: true },
        _count: { _all: true }, _max: { synced_at: true },
      }),
      db.commerce_resource_records.findMany({
        where: { ...scopedWhere, active: true },
        orderBy: [{ resource_id: 'asc' }, { source_id: 'asc' }], take: 100,
        select: { store_id: true, resource_id: true, source_id: true, sync_run_id: true, content_hash: true, synced_at: true },
      }),
    ]) : [[], [], []];
    if (signal?.aborted) { const error = new Error('Evidence retrieval cancelled.'); error.code = 'EVIDENCE_RETRIEVAL_CANCELLED'; error.statusCode = 499; throw error; }
    const items = [];
    for (const store of stores) {
      for (const id of resources) {
        const row = ledgerRows.find(candidate => candidate.store_id === store.id && candidate.domain === id);
        items.push(await resourceEvidence(store, id, row,
          aggregates.filter(candidate => candidate.store_id === store.id),
          samples.filter(candidate => candidate.store_id === store.id), now));
        if (items.length >= Math.min(Math.max(1, Number(limit) || MAX_CONTEXT_ITEMS), 100)) break;
      }
      if (items.length >= limit) break;
    }
    const validation = validateEvidenceCollection(items, { organizationId, storeIds });
    if (!validation.valid) { const error = new Error('Evidence contract validation failed.'); error.code = 'EVIDENCE_CONTRACT_INVALID'; error.details = validation.errors; throw error; }
    return {
      schema_version: EVIDENCE_SCHEMA_VERSION, generated_at: now.toISOString(), items,
      errors: items.filter(item => !['available', 'verified_zero'].includes(item.status)).map(item => ({ code: item.status.toUpperCase(), resource_id: item.source.resource, evidence_id: item.id })),
      complete: items.length > 0 && items.every(item => ['available', 'verified_zero'].includes(item.status) && item.coverage.complete && item.freshness.state === 'fresh'),
    };
  } catch (cause) {
    if (cause.code?.startsWith('EVIDENCE_')) throw cause;
    const error = new Error('Evidence storage retrieval failed.');
    error.code = 'EVIDENCE_STORAGE_FAILURE'; error.statusCode = 503; error.cause = cause;
    throw error;
  }
}

async function retrieveEvidenceById(options, deps = {}) {
  const result = await retrieveEvidence({ ...options, resourceId: null, limit: 100 }, deps);
  const item = result.items.find(candidate => candidate.id === options.evidenceId);
  if (!item) { const error = new Error('Evidence reference is unavailable.'); error.code = 'EVIDENCE_NOT_FOUND'; error.statusCode = 404; throw error; }
  return item;
}

module.exports = {
  retrieveEvidence, retrieveEvidenceById, authorizedStores, freshnessFor,
  freshnessPolicy, domainFor, snapshotPeriod, MAX_CONTEXT_ITEMS,
  REVENUE_RESOURCE_ID, resolveRevenuePeriod, snapshotGate,
};
