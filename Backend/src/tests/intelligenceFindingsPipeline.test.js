'use strict';

// Task 229 §7 — the first-priority-finding pipeline. Proves:
//   (1) A defensible operational finding fires ONLY when the certified coverage
//       gate + verified, equal-period, same-currency evidence is present.
//   (2) When historical completeness is NOT certified, NO finding is fabricated
//       and the honest no-finding reason is returned for surfacing.
// Uses a mocked prisma; deterministic via options.now.

const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateOrganizationFindings } = require('../services/intelligenceFindingsAggregator');
const { TRUSTED_SOURCE } = require('../services/intelligenceOrderCoverage');

const ORG = 'org-1';
const STORE = 'store-1';
const NOW = '2026-11-10T00:00:00Z'; // currentEnd = 2026-11-10; currentStart = 11-03; previousStart = 10-27

const orders = [];
for (let i = 0; i < 15; i++) orders.push({ customer_id: `p${i}`, total: '100.00', refunded_total: '0.00', currency: 'USD', ordered_at: new Date('2026-10-30T12:00:00Z'), recovery_status: null });
for (let i = 0; i < 15; i++) orders.push({ customer_id: `c${i}`, total: '50.00', refunded_total: '0.00', currency: 'USD', ordered_at: new Date('2026-11-06T12:00:00Z'), recovery_status: null });

function makePrisma({ coverage }) {
  return {
    stores: { findMany: async () => [{ id: STORE, organization_id: ORG, status: 'active', last_synced_at: '2026-11-09T12:00:00Z', platform: 'shopify', shop_domain: 't.myshopify.com' }] },
    webhook_registrations: { count: async () => 0 },
    intelligence_order_coverage: { findFirst: async () => coverage },
    orders: {
      findMany: async () => orders,
      groupBy: async () => [],
    },
  };
}

test('P5: a certified store with a verified 50% revenue drop fires a revenue_change finding', async () => {
  const coverage = { source: TRUSTED_SOURCE, source_run_id: 'run-1', certified_at: '2026-11-09T00:00:00Z', customer_lifetime_verified: false };
  const prisma = makePrisma({ coverage });
  const out = await evaluateOrganizationFindings(prisma, ORG, { now: NOW });

  const rev = out.findings.find(f => f.type === 'revenue_change');
  assert.ok(rev, `expected a revenue_change finding; got types: ${out.findings.map(f => f.type)}`);
  assert.equal(rev.severity, 'high');
  assert.equal(rev.scope.storeId, STORE);
  assert.equal(rev.scope.organizationId, ORG);
  assert.equal(rev.evidence.verified, true);
  assert.equal(rev.evidence.complete, true);
  assert.equal(rev.evidence.currency, 'USD');
  assert.ok(rev.evidence.delta_pct <= -25, `expected a >=25% drop, got ${rev.evidence.delta_pct}`);
  // Evidence must be traceable to the certified run.
  assert.equal(rev.evidence.coverage_source, TRUSTED_SOURCE);
  assert.equal(rev.evidence.coverage_run_id, 'run-1');
  // Guardrails: a finding that would leak unsafe language must not be produced.
  assert.ok(rev.title.length > 0 && !/you (are|will) be fined/i.test(rev.title + rev.description));
});

test('P5: with certified coverage but no material change, no revenue finding is fabricated', async () => {
  const prisma = {
    stores: { findMany: async () => [{ id: STORE, organization_id: ORG, status: 'active', last_synced_at: '2026-11-09T12:00:00Z', platform: 'shopify', shop_domain: 't.myshopify.com' }] },
    webhook_registrations: { count: async () => 0 },
    intelligence_order_coverage: { findFirst: async () => ({ source: TRUSTED_SOURCE, source_run_id: 'run-1', certified_at: '2026-11-09', customer_lifetime_verified: false }) },
    // Identical revenue both periods -> below the 25% threshold.
    orders: { findMany: async () => [
      ...Array.from({ length: 12 }, (_, i) => ({ customer_id: `p${i}`, total: '100.00', refunded_total: '0.00', currency: 'USD', ordered_at: new Date('2026-10-30T12:00:00Z'), recovery_status: null })),
      ...Array.from({ length: 12 }, (_, i) => ({ customer_id: `c${i}`, total: '100.00', refunded_total: '0.00', currency: 'USD', ordered_at: new Date('2026-11-06T12:00:00Z'), recovery_status: null })),
    ], groupBy: async () => [] },
  };
  const out = await evaluateOrganizationFindings(prisma, ORG, { now: NOW });
  assert.equal(out.findings.find(f => f.type === 'revenue_change'), undefined);
});

test('P5: uncertified order history -> NO operational finding + honest diagnostic surfaced', async () => {
  const prisma = makePrisma({ coverage: null });
  const out = await evaluateOrganizationFindings(prisma, ORG, { now: NOW });
  assert.equal(out.findings.length, 0);
  assert.ok(out.diagnostics.some(d => d.status === 'order_history_completeness_unverified'),
    `expected an honest no-finding reason; got: ${JSON.stringify(out.diagnostics)}`);
});

test('P5: untrusted coverage source is treated the same as missing (no finding, honest diagnostic)', async () => {
  const prisma = makePrisma({ coverage: { source: 'SOME_UNTRUSTED_SOURCE', source_run_id: 'run-1', certified_at: '2026-11-09', customer_lifetime_verified: false } });
  const out = await evaluateOrganizationFindings(prisma, ORG, { now: NOW });
  assert.equal(out.findings.length, 0);
  assert.ok(out.diagnostics.some(d => d.status === 'order_history_completeness_unverified'));
});
