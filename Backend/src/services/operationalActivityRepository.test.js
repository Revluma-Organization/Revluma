'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fetchOperationalActivityBundle } = require('./operationalActivityRepository');

const NOW = new Date('2026-11-07T12:00:00.000Z');
const DAY = 86400000;
const OWNED = { id: 'store-owned', organization_id: 'org-owned', shop_domain: 'x.myshopify.com' };

function makePrisma(over = {}) {
  const calls = [];
  const rec = (name, fn) => async (args) => { calls.push({ name, args }); return fn ? fn(args) : []; };
  const prisma = {
    stores: { findFirst: rec('stores.findFirst', (a) => (a.where.organization_id === 'org-owned' && a.where.id === 'store-owned') ? OWNED : null) },
    intelligence_findings: { findMany: rec('intelligence_findings.findMany', () => [{ id: 'f1', type: 'revenue', severity: 'high', status: 'open', title: 'Drop', description: 'x', dedupe_key: 'dk1', detected_at: new Date(NOW.getTime() - DAY), updated_at: new Date(NOW.getTime() - 0.5 * DAY) }]) },
    integration_lifecycle_events: { findMany: rec('integration_lifecycle_events.findMany', () => [{ id: 'l1', event_type: 'state_change', from_state: 'connected', to_state: 'disconnected', reason_code: 'R', source: 'engine', event_reference: 'ref', capability: 'shopify', observed_at: new Date(NOW.getTime() - 2 * DAY), created_at: new Date(NOW.getTime() - 1.9 * DAY) }]) },
    store_sync_domain_states: { findMany: rec('store_sync_domain_states.findMany', () => [{ domain: 'orders', status: 'failed', last_attempted_at: new Date(NOW.getTime() - 3 * DAY), last_succeeded_at: null, error_code: 'TOKEN_EXPIRED', retry_count: 2, updated_at: new Date(NOW.getTime() - 3 * DAY) }]) },
    ...over,
  };
  return { prisma, calls };
}

test('tenant isolation: store not in org -> null', async () => {
  const { prisma } = makePrisma();
  assert.equal(await fetchOperationalActivityBundle(prisma, 'org-other', 'store-owned', NOW), null);
});

test('cross-tenant store id -> null', async () => {
  const { prisma } = makePrisma();
  assert.equal(await fetchOperationalActivityBundle(prisma, 'org-owned', 'store-other', NOW), null);
});

test('findings scoped to store_id AND organization_id, windowed, bounded', async () => {
  const { prisma, calls } = makePrisma();
  await fetchOperationalActivityBundle(prisma, 'org-owned', 'store-owned', NOW);
  const f = calls.find((c) => c.name === 'intelligence_findings.findMany');
  assert.equal(f.args.where.store_id, 'store-owned');
  assert.equal(f.args.where.organization_id, 'org-owned');
  assert.ok(f.args.where.detected_at.gte, 'windowed on detected_at');
  assert.ok(f.args.take <= 500, 'bounded');
});

test('lifecycle + sync domains scoped to store_id', async () => {
  const { prisma, calls } = makePrisma();
  await fetchOperationalActivityBundle(prisma, 'org-owned', 'store-owned', NOW);
  const l = calls.find((c) => c.name === 'integration_lifecycle_events.findMany');
  assert.equal(l.args.where.store_id, 'store-owned');
  const s = calls.find((c) => c.name === 'store_sync_domain_states.findMany');
  assert.equal(s.args.where.store_id, 'store-owned');
});

test('partial failure: findings throws -> empty list, others still fetched', async () => {
  const { prisma: p } = makePrisma();
  p.intelligence_findings.findMany = async () => { throw new Error('db down'); };
  const bundle = await fetchOperationalActivityBundle(p, 'org-owned', 'store-owned', NOW);
  assert.deepEqual(bundle.findings, []);
  assert.equal(bundle.lifecycle.length, 1);
  assert.equal(bundle.syncDomains.length, 1);
});

test('requires an organization id', async () => {
  const { prisma } = makePrisma();
  await assert.rejects(() => fetchOperationalActivityBundle(prisma, null, 'store-owned', NOW), /organization/);
});
