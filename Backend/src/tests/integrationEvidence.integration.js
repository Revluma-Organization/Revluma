'use strict';
// Real-PostgreSQL regression for the Task 201 integration evidence service.
//
// Requires a disposable local database (never production):
//   CREATE DATABASE revluma_rc;
//   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/revluma_rc?schema=public
//   RELEASE_CANDIDATE_ISOLATED_DB=true node src/tests/integrationEvidence.integration.js
//
// Scenario set: healthy multi-resource store, cross-tenant isolation,
// secret protection (token values never appear in evidence), multi-store
// rollup, and evidence-by-reference on real PostgreSQL.

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { prisma } = require('../configs/database');
const {
  retrieveIntegrationEvidence, retrieveIntegrationEvidenceById,
} = require('../services/revIntegrationEvidenceService');
const { validateEvidenceCollection } = require('../services/revEvidenceContract');

const url = String(process.env.DATABASE_URL || '');
if (process.env.RELEASE_CANDIDATE_ISOLATED_DB !== 'true' || !/@127\.0\.0\.1:5432\/revluma_rc\b/.test(url)) {
  throw new Error('Disposable localhost revluma_rc PostgreSQL and explicit opt-in required');
}

const results = [];
function record(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => results.push({ name, ok: true }))
    .catch((error) => results.push({ name, ok: false, error }));
}

const TOKEN_A = `shpat_rc_secret_${randomUUID()}`;
const TOKEN_B = `shpat_rc_secret_${randomUUID()}`;
const FULL_SCOPES = 'read_products,read_orders,read_inventory,read_customers,read_checkouts,read_locations,read_discounts,read_content,read_themes,read_shipping,read_returns';
const DOMAINS = ['store_domains', 'products', 'variants', 'orders', 'refunds', 'inventory', 'locations', 'transactions', 'fulfillments', 'customers', 'abandoned_checkouts', 'webhooks'];

function healthyLedgers(storeId, at) {
  return DOMAINS.map(domain => ({
    store_id: storeId, domain, status: 'ok',
    records_discovered: 50, records_inserted: 40, records_updated: 10, records_deleted: 0,
    pages_completed: 1, pagination_complete: true, error_code: null, error_details: null,
    retry_count: 0, last_attempted_at: at, last_succeeded_at: at, last_checked_at: at,
    checkpoint: { sync_run_id: `run-${domain}` },
  }));
}

async function main() {
  const suffix = randomUUID().slice(0, 8);
  const now = new Date();
  const recent = new Date(now.getTime() - 5 * 60 * 1000);
  const userA = randomUUID();
  const userB = randomUUID();
  const orgA = randomUUID();
  const orgB = randomUUID();
  const storeA = randomUUID();
  const storeB = randomUUID();

  await prisma.users.createMany({ data: [
    { id: userA, full_name: 'RC Int A', email: `rc-int-a-${suffix}@example.invalid`, password_hash: 'x' },
    { id: userB, full_name: 'RC Int B', email: `rc-int-b-${suffix}@example.invalid`, password_hash: 'x' },
  ] });
  await prisma.organizations.createMany({ data: [
    { id: orgA, owner_id: userA, company_name: `RC Integration A ${suffix}`, slug: `rc-int-a-${suffix}`, industry: 'test', country: 'NG' },
    { id: orgB, owner_id: userB, company_name: `RC Integration B ${suffix}`, slug: `rc-int-b-${suffix}`, industry: 'test', country: 'NG' },
  ] });
  await prisma.stores.createMany({ data: [
    {
      id: storeA, organization_id: orgA, platform: 'shopify', shop_domain: `rc-int-a-${suffix}.myshopify.com`,
      access_token: TOKEN_A, granted_scopes: FULL_SCOPES, status: 'active',
      installed_at: new Date(now.getTime() - 30 * 86400000), last_synced_at: recent,
    },
    // storeB intentionally has NO granted scopes (the production data gap):
    // fresh syncs must still make it healthy, and the gap must stay visible.
    {
      id: storeB, organization_id: orgB, platform: 'shopify', shop_domain: `rc-int-b-${suffix}.myshopify.com`,
      access_token: TOKEN_B, granted_scopes: null, status: 'active',
      installed_at: new Date(now.getTime() - 30 * 86400000), last_synced_at: recent,
    },
  ] });
  await prisma.store_sync_domain_states.createMany({ data: [...healthyLedgers(storeA, recent), ...healthyLedgers(storeB, recent)] });
  await prisma.webhook_registrations.createMany({ data: [storeA, storeB].map(storeId => ({
    store_id: storeId, external_id: `wh-${storeId.slice(0, 8)}`, topic: 'orders/create',
    delivery_url: `https://example.invalid/webhooks/shopify`, status: 'active',
  })) });
  await prisma.webhook_deliveries.createMany({ data: [storeA, storeB].map((storeId, i) => ({
    provider: 'shopify', delivery_id: `dlv-${suffix}-${i}`, store_id: storeId, topic: 'orders/create',
    status: 'processed', received_at: recent, processed_at: recent,
  })) });
  await prisma.intelligence_order_coverage.createMany({ data: [orgA, orgB].map(orgId => ({
    store_id: orgId === orgA ? storeA : storeB, organization_id: orgId,
    coverage_start: new Date(now.getTime() - 30 * 86400000), coverage_end: now,
    source: 'rc-integration-evidence', source_run_id: suffix,
  })) });

  try {
    await record('healthy store on real PostgreSQL is healthy with contract-valid items', async () => {
      const result = await retrieveIntegrationEvidence({ organizationId: orgA, db: prisma });
      assert.equal(result.overall_status, 'healthy');
      assert.deepEqual(result.store_ids, [storeA]);
      assert.equal(result.stores[0].connection.state, 'authenticated');
      assert.equal(result.stores[0].webhooks.state, 'healthy');
      const check = validateEvidenceCollection(result.items, { organizationId: orgA, storeIds: result.store_ids });
      assert.equal(check.valid, true, JSON.stringify(check.errors || null));
      // 1 connection + 1 authorization + 9 critical capabilities + 1 webhook + 1 health
      assert.equal(result.items.length, 14);
    });

    await record('evidence is tenant-isolated: other organizations and stores are invisible', async () => {
      const a = await retrieveIntegrationEvidence({ organizationId: orgA, db: prisma });
      const b = await retrieveIntegrationEvidence({ organizationId: orgB, db: prisma });
      assert.deepEqual(a.store_ids, [storeA]);
      assert.deepEqual(b.store_ids, [storeB]);
      // storeB has no recorded scopes: fresh syncs keep it healthy, the gap is a warning.
      assert.equal(b.overall_status, 'healthy', `org B should be healthy, got ${b.overall_status}`);
      assert.ok(b.stores[0].health.warnings.some(w => w.includes('No granted Shopify scopes are recorded')));
      const payloadA = JSON.stringify(a);
      assert.ok(!payloadA.includes(storeB), 'org A evidence must not mention org B store id');
      assert.ok(!payloadA.includes('rc-int-b-'));
      const foreignById = await retrieveIntegrationEvidence({ organizationId: orgA, storeId: storeB, db: prisma });
      assert.equal(foreignById.overall_status, 'disconnected');
      assert.deepEqual(foreignById.store_ids, []);
    });

    await record('token values never appear anywhere in evidence output', async () => {
      const a = await retrieveIntegrationEvidence({ organizationId: orgA, db: prisma });
      const b = await retrieveIntegrationEvidence({ organizationId: orgB, db: prisma });
      for (const payload of [JSON.stringify(a), JSON.stringify(b)]) {
        assert.ok(!payload.includes(TOKEN_A), 'org A token must not appear in org A evidence');
        assert.ok(!payload.includes(TOKEN_B), 'org B token must not appear in org A evidence');
      }
    });

    await record('evidence-by-reference resolves a real item on PostgreSQL', async () => {
      const result = await retrieveIntegrationEvidence({ organizationId: orgA, db: prisma });
      const target = result.items.find(item => item.metric === 'integration.health_overall');
      const fetched = await retrieveIntegrationEvidenceById({ organizationId: orgA, evidenceId: target.id, db: prisma });
      assert.equal(fetched.id, target.id);
      assert.equal(fetched.store_id, null); // organization-scoped item
      await assert.rejects(
        () => retrieveIntegrationEvidenceById({ organizationId: orgA, evidenceId: `ev-${'0'.repeat(24)}`, db: prisma }),
        err => err.code === 'EVIDENCE_NOT_FOUND',
      );
    });
  } finally {
    await prisma.intelligence_order_coverage.deleteMany({ where: { organization_id: { in: [orgA, orgB] } } });
    await prisma.webhook_deliveries.deleteMany({ where: { store_id: { in: [storeA, storeB] } } });
    await prisma.webhook_registrations.deleteMany({ where: { store_id: { in: [storeA, storeB] } } });
    await prisma.store_sync_domain_states.deleteMany({ where: { store_id: { in: [storeA, storeB] } } });
    await prisma.stores.deleteMany({ where: { id: { in: [storeA, storeB] } } });
    await prisma.organizations.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await prisma.users.deleteMany({ where: { id: { in: [userA, userB] } } });
  }

  const failed = results.filter(r => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? 'ok' : 'FAIL'} - ${r.name}`);
    if (!r.ok) console.log(`  ${String(r.error && r.error.stack || r.error).split('\n').slice(0, 6).join('\n  ')}`);
  }
  console.log(`integration-evidence RC: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect().catch(() => {}));
