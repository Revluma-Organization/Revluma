'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

function stub(modulePath, exports) {
  const id = require.resolve(modulePath);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

const NOW = new Date('2026-11-08T12:00:00Z');
const healthCalls = [];

stub('../configs/database', { prisma: null });
stub('../services/revIntegrationState', {
  retrieveIntegrationStates: async () => [
    { store: { id: 'store-1' }, overall_status: 'connected', capabilities: [], coverage: { status: 'complete' } },
    { store: { id: 'store-2' }, overall_status: 'limited_access', capabilities: [], coverage: { status: 'partial' } },
  ],
});
stub('../services/businessHealthRepository', {
  normalizePeriodDays: (v) => ([7, 14, 30].includes(Number(String(v).replace(/d$/i, ''))) ? Number(String(v).replace(/d$/i, '')) : 7),
  fetchBusinessHealthBundle: async (_prisma, organizationId, storeId, now, _state, options) => {
    const days = options && options.periodDays ? options.periodDays : 7;
    healthCalls.push({ organizationId, storeId, days });
    const tz = storeId === 'store-2' ? 'Europe/London' : 'America/New_York';
    return {
      store: { id: storeId, iana_timezone: tz },
      reportingPeriod: {
        current: { label: `last_${days}_days`, start: '2026-11-01T12:00:00.000Z', end: now.toISOString() },
        comparison: { label: `previous_${days}_days`, start: '2026-10-25T12:00:00.000Z', end: '2026-11-01T12:00:00.000Z' },
        days,
        display_label: `Last ${days} days`,
        timezone: tz,
        timezone_verified: true,
        note: `Rolling ${days}-day period in ${tz}.`,
      },
    };
  },
});
stub('../services/operationalActivityRepository', {
  fetchOperationalActivityBundle: async (_prisma, _orgId, storeId) => ({ store: { id: storeId } }),
});
stub('../services/businessHealth', {
  buildBusinessHealth: (bundle, now) => ({
    contract_version: 'rev-business-health-v1',
    store_id: bundle.store.id,
    generated_at: now.toISOString(),
    reporting_period: bundle.reportingPeriod,
  }),
  validateBusinessHealth: (v) => v.contract_version === 'rev-business-health-v1',
});
stub('../services/operationalActivity', {
  buildOperationalActivity: (bundle, now, limit, cursor) => ({
    contract_version: 'rev-operational-activity-v1',
    store_id: bundle.store.id,
    generated_at: now.toISOString(),
    limit,
    next_cursor: cursor,
    items: [],
  }),
  validateOperationalActivity: (v) => v.contract_version === 'rev-operational-activity-v1',
});

const { getCommandCenter } = require('../services/commandCenterService');

function makePrisma() {
  return {
    business_states: { findFirst: async () => null },
    intelligence_findings: { findMany: async () => [] },
    stores: {
      findMany: async () => [
        { id: 'store-1', shop_domain: 'acme-us.myshopify.com', platform: 'shopify', last_synced_at: NOW, sync_completed_at: NOW },
        { id: 'store-2', shop_domain: 'acme-uk.myshopify.com', platform: 'shopify', last_synced_at: NOW, sync_completed_at: NOW },
      ],
    },
    store_profiles: {
      findMany: async () => [
        { store_id: 'store-1', shop_name: 'Acme US', iana_timezone: 'America/New_York', currency_code: 'USD' },
        { store_id: 'store-2', shop_name: 'Acme UK', iana_timezone: 'Europe/London', currency_code: 'GBP' },
      ],
    },
    store_sync_domain_states: { findMany: async () => [] },
  };
}

test('Section 01 unifies verified Shopify store timezone and reporting period across context and business health', async () => {
  healthCalls.length = 0;
  const result = await getCommandCenter({ prisma: makePrisma(), organizationId: 'merchant-a', now: NOW });

  assert.equal(result.context.store.id, 'store-1');
  assert.equal(result.context.store.display_name, 'Acme US');
  assert.equal(result.context.store.iana_timezone, 'America/New_York');
  assert.equal(result.context.reporting_period.timezone, 'America/New_York');
  assert.equal(result.context.reporting_period.timezone_verified, true);
  assert.equal(result.context.reporting_period.label, 'Last 7 days');
  assert.equal(result.context.reporting_period.kind, result.business_health.reporting_period.current.label);
  assert.equal(result.context.reporting_period.timezone, result.business_health.reporting_period.timezone);
  assert.equal(result.context.stores.length, 2);
  assert.equal(result.context.stores[1].display_name, 'Acme UK');
  assert.equal(result.context.stores[1].connection_status, 'limited_access');
});

test('Section 01 supports tenant-safe store switching and period selection', async () => {
  healthCalls.length = 0;
  const result = await getCommandCenter({
    prisma: makePrisma(),
    organizationId: 'merchant-a',
    storeId: 'store-2',
    periodDays: '30d',
    now: NOW,
  });

  assert.equal(result.context.store.id, 'store-2');
  assert.equal(result.context.store.display_name, 'Acme UK');
  assert.equal(result.context.reporting_period.timezone, 'Europe/London');
  assert.equal(result.context.reporting_period.label, 'Last 30 days');
  assert.equal(result.context.reporting_period.days, 30);
  assert.equal(result.integration.overall_status, 'limited_access');
  assert.deepEqual(healthCalls[0], { organizationId: 'merchant-a', storeId: 'store-2', days: 30 });
});

test('Section 01 ignores unknown or foreign storeId and invalid period values safely', async () => {
  healthCalls.length = 0;
  const result = await getCommandCenter({
    prisma: makePrisma(),
    organizationId: 'merchant-a',
    storeId: 'foreign-tenant-store-999',
    periodDays: '999d',
    now: NOW,
  });

  assert.equal(result.context.store.id, 'store-1');
  assert.equal(result.context.reporting_period.days, 7);
  assert.equal(result.context.reporting_period.label, 'Last 7 days');
});
