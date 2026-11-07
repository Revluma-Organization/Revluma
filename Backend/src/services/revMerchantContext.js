'use strict';

// Builds a bounded read-only context from organization-scoped, verified records.
const { TRUSTED_SOURCE } = require('./intelligenceOrderCoverage');
const { normalizeCurrency } = require('./financialIntegrity');

function validIanaTimezone(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const candidate = value.trim().slice(0, 64);
  try { new Intl.DateTimeFormat('en', { timeZone: candidate }); return candidate; }
  catch { return null; }
}
const FINANCIAL_FINDING_TYPES = new Set(['revenue_change', 'order_volume_change', 'returning_customer_change']);
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
function certifiedFinding(finding) {
  const evidence = finding?.evidence;
  if (!evidence || evidence.verified !== true) return false;
  if (finding.type === 'integration_failure') return evidence.source === 'stores' && evidence.storeId === finding.store_id;
  if (!FINANCIAL_FINDING_TYPES.has(finding.type)) return false; // Fail closed for unknown finding contracts.
  if (evidence.complete !== true || evidence.coverage_source !== TRUSTED_SOURCE ||
      typeof evidence.coverage_run_id !== 'string' || !evidence.coverage_run_id.trim()) return false;
  const { previousStart, previousEnd, currentStart, currentEnd } = evidence;
  if (![previousStart, previousEnd, currentStart, currentEnd].every(validDate)) return false;
  const ps = Date.parse(previousStart), pe = Date.parse(previousEnd);
  const cs = Date.parse(currentStart), ce = Date.parse(currentEnd);
  if (!(ps < pe && pe <= cs && cs < ce && pe - ps === ce - cs)) return false;
  if (typeof evidence.currency !== 'string' || !/^[A-Z]{3}$/.test(evidence.currency)) return false;
  if (![evidence.currentCount, evidence.previousCount].every(n => Number.isInteger(n) && n >= 0)) return false;
  if (finding.type === 'revenue_change' &&
      ![evidence.currentRevenue, evidence.previousRevenue].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0)) return false;
  if (finding.type === 'returning_customer_change' &&
      ![evidence.currentReturning, evidence.previousReturning].every(n => Number.isInteger(n) && n >= 0)) return false;
  return true;
}
const EVIDENCE_KEYS = new Set([
  'verified', 'complete', 'currency', 'currentCount', 'previousCount',
  'currentRevenue', 'previousRevenue', 'currentStart', 'currentEnd',
  'previousStart', 'previousEnd', 'failed_webhook_registrations',
  'coverage_source', 'coverage_run_id',
]);
function boundedEvidence(evidence) {
  return Object.fromEntries(Object.entries(evidence).filter(([key, value]) =>
    EVIDENCE_KEYS.has(key) && (
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value)) ||
      (typeof value === 'string' && value.length <= 100)
    )
  ));
}
function safeTimestamp(value) {
  if (value == null) return 'never_synced';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : 'unknown_sync_time';
}
function compactEvidence(evidence) {
  const result = {};
  for (const [key, value] of Object.entries(boundedEvidence(evidence))) {
    const next = JSON.stringify({ ...result, [key]: value });
    if (next.length <= 560) result[key] = value;
  }
  return JSON.stringify(result);
}
async function buildMerchantContext(prisma, organizationId) {
  if (!organizationId) throw new TypeError('organizationId is required');
  const stores = await prisma.stores.findMany({
    where: { organization_id: organizationId },
    orderBy: [{ id: 'asc' }],
    select: { id: true, platform: true, status: true, last_synced_at: true },
    take: 8,
  });
  const findings = await prisma.intelligence_findings.findMany({
    where: { organization_id: organizationId, status: 'open', store_id: { in: stores.map(s => s.id) } },
    orderBy: [{ detected_at: 'desc' }],
    take: 10,
    select: { id: true, store_id: true, type: true, severity: true, title: true,
      description: true, evidence: true, detected_at: true },
  });
  const allowedStores = new Set(stores.map(s => s.id));
  let resourceCounts = [];
  let resourceRecords = [];
  if (allowedStores.size && prisma.commerce_resource_records) {
    [resourceCounts, resourceRecords] = await Promise.all([
      prisma.commerce_resource_records.groupBy({
        by: ['resource_id'], where: { store_id: { in: [...allowedStores] }, active: true },
        _count: { _all: true }, _max: { synced_at: true }, orderBy: { resource_id: 'asc' }, take: 32,
      }),
      prisma.commerce_resource_records.findMany({
        where: { store_id: { in: [...allowedStores] }, active: true }, orderBy: [{ synced_at: 'desc' }], take: 100,
        select: { resource_id: true, source_id: true, payload: true, synced_at: true },
      }),
    ]);
  }
  const seenSamples = new Set();
  const samples = [];
  for (const row of resourceRecords) {
    if (seenSamples.has(row.resource_id)) continue;
    seenSamples.add(row.resource_id);
    samples.push([String(row.resource_id).slice(0, 64), String(row.source_id).slice(0, 160), safeTimestamp(row.synced_at), JSON.stringify(row.payload).slice(0, 360)].join(' | ').slice(0, 620));
    if (samples.length >= 8) break;
  }
  let evidence = [];
  let evidenceErrors = [];
  let evidenceComplete = false;
  // The canonical contract is additive to the legacy bounded fields during
  // migration. Python validates and consumes these typed items directly.
  if (allowedStores.size && prisma.store_sync_domain_states && prisma.commerce_resource_records) {
    try {
      const retrieved = await require('./revEvidenceService').retrieveEvidence({
        organizationId, limit: 2,
      }, { db: prisma });
      evidence = retrieved.items;
      evidenceErrors = retrieved.errors;
      evidenceComplete = retrieved.complete;
    } catch (error) {
      evidenceErrors = [{ code: error.code || 'EVIDENCE_STORAGE_FAILURE' }];
      evidenceComplete = false;
    }
  }
  const limitations = [
    'Connection does not prove complete order coverage.',
    'No verified checkout abandonment rate is available in this context.',
    'No findings does not prove the store has no issues.',
    'Authorized resource samples are bounded; use the resource API for complete paginated records and the capability report for exclusions.',
  ];
  // Task 198 — merchant reporting timezone + configured currencies.
  // Priority mirrors the Python intelligence layer: the synced Shopify
  // profile timezone, then UTC. Stores that configure DIFFERENT timezones
  // are never silently collapsed: the context says UTC and says why, so
  // periods resolve on an asserted calendar.
  let reportingTimezone = 'UTC';
  let reportingTimezoneSource = 'default_utc';
  const configuredCurrencies = new Set();
  const perStoreTimezones = [];
  if (allowedStores.size) {
    let profiles = [];
    if (prisma.store_profiles) {
      profiles = await prisma.store_profiles.findMany({
        where: { store_id: { in: [...allowedStores] } },
        select: { store_id: true, iana_timezone: true, currency_code: true },
      });
    }
    let settingsRows = [];
    if (prisma.store_settings) {
      settingsRows = await prisma.store_settings.findMany({
        where: { store_id: { in: [...allowedStores] } },
        select: { store_id: true, settings: true },
      });
    }
    const settingsByStore = new Map(settingsRows.map(row => [row.store_id, row.settings]));
    const profileByStore = new Map(profiles.map(profile => [profile.store_id, profile]));
    for (const storeId of allowedStores) {
      const profile = profileByStore.get(storeId) || {};
      const settings = (settingsByStore.get(storeId) && typeof settingsByStore.get(storeId) === 'object')
        ? settingsByStore.get(storeId) : {};
      const settingsTimezone = validIanaTimezone(settings.timezone || settings.store_timezone);
      const profileTimezone = validIanaTimezone(profile.iana_timezone);
      const settingsCurrency = normalizeCurrency(settings.currency || settings.store_currency);
      const profileCurrency = normalizeCurrency(profile.currency_code);
      if (settingsCurrency) configuredCurrencies.add(settingsCurrency);
      else if (profileCurrency) configuredCurrencies.add(profileCurrency);
      perStoreTimezones.push(settingsTimezone || profileTimezone);
    }
    const distinct = [...new Set(perStoreTimezones.filter(Boolean))];
    if (distinct.length === 1) {
      reportingTimezone = distinct[0];
      reportingTimezoneSource = 'store_settings_or_profile';
    } else if (distinct.length > 1) {
      reportingTimezoneSource = 'utc_conflicting_stores';
      limitations.push(`Connected stores use different configured timezones (${distinct.join(', ')}); reporting periods use UTC.`);
    }
  }

  return {
    schema_version: 'rev-merchant-context-v3',
    evidence_schema_version: require('./revEvidenceContract').EVIDENCE_SCHEMA_VERSION,
    organization_id: organizationId,
    store_ids: [...allowedStores],
    reporting_timezone: reportingTimezone,
    reporting_timezone_source: reportingTimezoneSource,
    configured_currencies: [...configuredCurrencies].sort(),
    evidence,
    evidence_errors: evidenceErrors,
    evidence_complete: evidenceComplete,
    observed_at: new Date().toISOString(),
    // Python's normalizer permits only three nested levels; array entries
    // must be primitive strings rather than nested objects.
    stores: stores.slice(0, 8).map(s =>
      ['store', String(s.id || '').slice(0, 36),
        String(s.platform || '').slice(0, 24),
        String(s.status || '').slice(0, 24),
        safeTimestamp(s.last_synced_at)].join(' | ')),
    verified_findings: findings.filter(f =>
      allowedStores.has(f.store_id) && certifiedFinding(f))
      .slice(0, 5).map(f =>
        ['finding', String(f.id || '').slice(0, 36),
          String(f.type || '').slice(0, 40),
          String(f.severity || '').slice(0, 16),
          compactEvidence(f.evidence)].join(' | ').slice(0, 620)),
    authorized_resources: resourceCounts.map(row => [String(row.resource_id).slice(0, 64), `persisted_records=${Number(row._count?._all || 0)}`, `last_synced=${safeTimestamp(row._max?.synced_at)}`].join(' | ')),
    authorized_resource_samples: samples,
    limitations,
  };
}
module.exports = { buildMerchantContext, boundedEvidence, certifiedFinding };
