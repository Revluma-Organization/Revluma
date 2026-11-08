'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

function stub(modulePath, exports) {
  const id = require.resolve(modulePath);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
const NOW = new Date('2026-11-08T12:00:00Z');
const calls = [];
stub('../configs/database', { prisma: null });
stub('../services/revIntegrationState', {
  retrieveIntegrationStates: async ({ organizationId, now }) => {
    calls.push(['integration', organizationId, now]);
    return [{ store: { id: 'store-1' }, overall_status: 'connected', capabilities: [], coverage: { status: 'complete' } }];
  },
});
stub('../services/businessHealthRepository', {
  fetchBusinessHealthBundle: async (prisma, organizationId, storeId, now) => {
    calls.push(['health', organizationId, storeId, now]);
    return { store: { id: storeId } };
  },
});
stub('../services/operationalActivityRepository', {
  fetchOperationalActivityBundle: async (prisma, organizationId, storeId, now) => {
    calls.push(['activity', organizationId, storeId, now]);
    return { store: { id: storeId } };
  },
});
stub('../services/businessHealth', {
  buildBusinessHealth: (bundle, now) => ({ contract_version: 'rev-business-health-v1', store_id: bundle.store.id, generated_at: now.toISOString() }),
  validateBusinessHealth: value => value.contract_version === 'rev-business-health-v1',
});
stub('../services/operationalActivity', {
  buildOperationalActivity: (bundle, now, limit, cursor) => ({ contract_version: 'rev-operational-activity-v1', store_id: bundle.store.id, generated_at: now.toISOString(), limit, next_cursor: cursor, items: [] }),
  validateOperationalActivity: value => value.contract_version === 'rev-operational-activity-v1',
});

const { getCommandCenter } = require('../services/commandCenterService');

test('Task 219 composes Task 218 health and activity once for the authoritative primary store', async () => {
  const prisma = {
    business_states: { findFirst: async () => null },
    intelligence_findings: { findMany: async () => [] },
    stores: { findMany: async () => [{ id: 'store-1', shop_domain: 'revluma-test-store-v1.myshopify.com', platform: 'shopify', last_synced_at: null, sync_completed_at: null }] },
    store_sync_domain_states: { findMany: async () => [] },
  };
  const result = await getCommandCenter({ prisma, organizationId: 'merchant-a', now: NOW });
  assert.equal(result.contract_version, 'command-center-v1');
  assert.equal(result.business_health.store_id, 'store-1');
  assert.equal(result.operational_activity.store_id, 'store-1');
  assert.equal(result.operational_activity.limit, 20);
  assert.equal(result.operational_activity.next_cursor, null);
  assert.deepEqual(calls.filter(call => call[0] === 'health'), [['health', 'merchant-a', 'store-1', NOW]]);
  assert.deepEqual(calls.filter(call => call[0] === 'activity'), [['activity', 'merchant-a', 'store-1', NOW]]);
  assert.equal(calls.filter(call => call[0] === 'health').length, 1);
  assert.equal(calls.filter(call => call[0] === 'activity').length, 1);
  assert.equal(JSON.stringify(result).includes('access_token'), false);
});
