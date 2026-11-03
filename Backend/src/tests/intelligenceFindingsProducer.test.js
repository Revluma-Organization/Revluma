'use strict';

/**
 * Controlled-fixture proof of the intelligence findings pipeline.
 *
 * intelligence_findings had never held a row in production. These tests
 * establish what that actually means, using fixtures rather than merchant data:
 *
 *   - the pipeline does produce and persist a real, evidence-backed finding when
 *     qualifying conditions exist, so an empty table is not an inherent property
 *     of the code;
 *   - it produces nothing when evidence is unverified, insufficient, or belongs
 *     to another tenant, so an empty table is the correct outcome for the data
 *     production currently holds;
 *   - repeated passes update a finding instead of duplicating it.
 *
 * The production shape is reproduced deliberately in one case: a store with five
 * orders and no certified coverage yields no business finding, which is the
 * evidence gate working rather than a defect.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateOrganizationFindings,
} = require('../services/intelligenceFindingsAggregator');
const {
  persistVerifiedFindings,
} = require('../services/intelligenceFindingsRepository');

const ORG = '1dc6aa19-9737-4770-a340-ff812a8b139a';
const OTHER_ORG = '9dc6aa19-9737-4770-a340-ff812a8b139b';
const STORE = '3ed79446-cb6d-4a1c-b174-9ec1ab91fe15';
const TRUSTED_SOURCE = 'shopify_verified_history_v1';

// Fixed clock so the 7-day windows are deterministic.
const NOW = new Date('2026-11-03T12:00:00Z');
const CURRENT_END = Date.UTC(2026, 10, 3); // 2026-11-03T00:00:00Z
const CURRENT_START = CURRENT_END - 7 * 86400000; // 2026-10-27
const PREVIOUS_START = CURRENT_START - 7 * 86400000; // 2026-10-20

const DAY = 86400000;

/**
 * Build the fake Prisma surface the aggregator and repository actually use.
 * Findings rows are kept in a Map keyed the way the unique index is, so upsert
 * semantics are exercised rather than assumed.
 */
function fakePrisma(fixture) {
  const findings = new Map();
  const calls = { upsertCreate: 0, upsertUpdate: 0, groupBy: 0 };

  const ordersInRange = (storeId, from, to) =>
    (fixture.orders || [])
      .filter(
        (order) =>
          order.store_id === storeId &&
          order.ordered_at.getTime() >= from &&
          order.ordered_at.getTime() < to
      )
      .map((order) => ({
        customer_id: order.customer_id,
        total: order.total,
        currency: order.currency,
        ordered_at: order.ordered_at,
      }));

  return {
    _findings: findings,
    _calls: calls,

    stores: {
      findMany: async ({ where }) =>
        (fixture.stores || [])
          .filter((store) => store.organization_id === where.organization_id)
          .map((store) => ({
            id: store.id,
            status: store.status,
            last_synced_at: store.last_synced_at,
            platform: store.platform,
            shop_domain: store.shop_domain,
          })),

      // The repository rechecks ownership per finding, even for trusted callers.
      findFirst: async ({ where }) => {
        const store = (fixture.stores || []).find(
          (candidate) =>
            candidate.id === where.id &&
            candidate.organization_id === where.organization_id
        );
        return store ? { id: store.id } : null;
      },
    },

    webhook_registrations: {
      count: async ({ where }) =>
        (fixture.webhookRegistrations || []).filter(
          (registration) =>
            registration.store_id === where.store_id &&
            registration.status === where.status
        ).length,
    },

    intelligence_order_coverage: {
      findFirst: async ({ where }) => {
        const coverage = (fixture.coverage || []).find(
          (candidate) =>
            candidate.store_id === where.store_id &&
            candidate.organization_id === where.organization_id
        );
        if (!coverage) return null;

        const startBound = where.coverage_start.lte;
        const endBound = where.coverage_end.gte;
        if (coverage.coverage_start > startBound) return null;
        if (coverage.coverage_end < endBound) return null;

        return {
          source: coverage.source,
          source_run_id: coverage.source_run_id,
          certified_at: coverage.certified_at,
          customer_lifetime_verified: coverage.customer_lifetime_verified,
        };
      },
    },

    orders: {
      findMany: async ({ where }) =>
        ordersInRange(
          where.store_id,
          where.ordered_at.gte.getTime(),
          where.ordered_at.lt.getTime()
        ),

      groupBy: async ({ where }) => {
        calls.groupBy += 1;
        const byCustomer = new Map();
        for (const order of fixture.orders || []) {
          if (order.store_id !== where.store_id) continue;
          if (!where.customer_id.in.includes(order.customer_id)) continue;
          if (order.ordered_at.getTime() >= where.ordered_at.lt.getTime()) continue;
          const previous = byCustomer.get(order.customer_id);
          if (!previous || order.ordered_at < previous) {
            byCustomer.set(order.customer_id, order.ordered_at);
          }
        }
        return [...byCustomer].map(([customer_id, ordered_at]) => ({
          customer_id,
          _min: { ordered_at },
        }));
      },
    },

    intelligence_findings: {
      upsert: async ({ where, create, update }) => {
        const key = `${where.organization_id_dedupe_key.organization_id}|${where.organization_id_dedupe_key.dedupe_key}`;
        if (findings.has(key)) {
          calls.upsertUpdate += 1;
          findings.set(key, { ...findings.get(key), ...update });
        } else {
          calls.upsertCreate += 1;
          findings.set(key, { ...create, status: 'open' });
        }
        return findings.get(key);
      },
    },
  };
}

function store(overrides = {}) {
  return {
    id: STORE,
    organization_id: ORG,
    platform: 'shopify',
    status: 'active',
    last_synced_at: new Date('2026-11-03T00:37:21Z'),
    shop_domain: 'revluma-test-store-v1.myshopify.com',
    ...overrides,
  };
}

function certifiedCoverage(overrides = {}) {
  return {
    store_id: STORE,
    organization_id: ORG,
    source: TRUSTED_SOURCE,
    source_run_id: 'run-fixture-1',
    certified_at: new Date('2026-11-03T00:37:46Z'),
    coverage_start: new Date(PREVIOUS_START),
    coverage_end: new Date(CURRENT_END),
    customer_lifetime_verified: false,
    ...overrides,
  };
}

/** n orders of `total` each, spread across a window starting at `from`. */
function orderBatch({ from, count, total, currency = 'USD', prefix }) {
  return Array.from({ length: count }, (_, index) => ({
    store_id: STORE,
    customer_id: `11111111-1111-4111-8111-${String(index).padStart(2, '0')}${prefix}00000`,
    total,
    currency,
    ordered_at: new Date(from + index * 3600000),
  }));
}

/** Revenue halves period over period on equal order counts. */
function qualifyingRevenueDropFixture() {
  return {
    stores: [store()],
    webhookRegistrations: [],
    coverage: [certifiedCoverage()],
    orders: [
      ...orderBatch({ from: PREVIOUS_START + DAY, count: 20, total: 100, prefix: 'a' }),
      ...orderBatch({ from: CURRENT_START + DAY, count: 20, total: 50, prefix: 'b' }),
    ],
  };
}

async function evaluateAndPersist(fixture, organizationId = ORG) {
  const db = fakePrisma(fixture);
  const evaluated = await evaluateOrganizationFindings(db, organizationId, { now: NOW });
  const persisted = await persistVerifiedFindings(db, organizationId, evaluated.findings);
  return { db, evaluated, persisted };
}

test('a verified revenue decline produces a persisted, evidence-backed finding', async () => {
  const { evaluated, persisted, db } = await evaluateAndPersist(
    qualifyingRevenueDropFixture()
  );

  const revenue = evaluated.findings.find((f) => f.type === 'revenue_change');
  assert.ok(revenue, 'a 50% verified decline must produce a revenue_change finding');
  assert.equal(revenue.severity, 'high');
  assert.equal(revenue.evidence.verified, true);
  assert.equal(revenue.evidence.complete, true);
  assert.equal(revenue.evidence.currency, 'USD');
  assert.equal(revenue.evidence.previousRevenue, 2000);
  assert.equal(revenue.evidence.currentRevenue, 1000);
  assert.equal(revenue.evidence.delta_pct, -50);
  assert.equal(revenue.evidence.currentCount, 20);
  assert.equal(revenue.evidence.previousCount, 20);

  assert.equal(persisted, 1);
  assert.equal(db._findings.size, 1);

  const row = [...db._findings.values()][0];
  assert.equal(row.organization_id, ORG);
  assert.equal(row.store_id, STORE);
  assert.equal(row.type, 'revenue_change');
  assert.equal(row.evidence.coverage_source, TRUSTED_SOURCE);
});

test('the finding states a measured change and never claims a cause or recoverable money', async () => {
  const { evaluated } = await evaluateAndPersist(qualifyingRevenueDropFixture());
  const revenue = evaluated.findings.find((f) => f.type === 'revenue_change');

  assert.match(revenue.title, /Verified revenue decreased 50%/);

  // The description must disclaim both causation and a recoverable amount. Note
  // that the word "recoverable" appears precisely in order to disclaim it, so
  // the assertion checks for the disclaimer rather than banning the word.
  assert.match(revenue.description, /does not establish its cause/);
  assert.match(revenue.description, /amount of recoverable revenue/);

  // No specific sum may be presented as money the merchant has definitely lost.
  for (const text of [revenue.title, revenue.description]) {
    assert.ok(
      !/(\$\s?\d|lost\s+\$|recover\s+\$|guarantee|will earn)/i.test(text),
      `must not assert a recoverable amount: ${text}`
    );
  }

  // The measured delta belongs in structured evidence, not in prose.
  assert.equal(revenue.evidence.delta_pct, -50);

  assert.ok(revenue.action?.guidance, 'must tell the merchant how to investigate');
  assert.ok(revenue.action?.measurement, 'must say how to verify the change later');
  assert.equal(revenue.action.route, '/dashboard');
});

test('equal order counts means no order-volume finding is invented', async () => {
  const { evaluated } = await evaluateAndPersist(qualifyingRevenueDropFixture());

  assert.ok(
    !evaluated.findings.some((f) => f.type === 'order_volume_change'),
    '20 orders in both periods is not a volume change'
  );
});

test('orders without certified coverage produce no business finding', async () => {
  const fixture = qualifyingRevenueDropFixture();
  fixture.coverage = [];

  const { evaluated, persisted } = await evaluateAndPersist(fixture);

  assert.equal(persisted, 0);
  assert.ok(
    !evaluated.findings.some((f) => f.type === 'revenue_change'),
    'uncertified history must not support a revenue claim'
  );
  assert.ok(
    evaluated.diagnostics.some(
      (d) => d.status === 'order_history_completeness_unverified'
    ),
    'the reason must be recorded, not silently dropped'
  );
});

test('an untrusted coverage source is rejected', async () => {
  const fixture = qualifyingRevenueDropFixture();
  fixture.coverage = [certifiedCoverage({ source: 'local_row_count' })];

  const { evaluated, persisted } = await evaluateAndPersist(fixture);

  assert.equal(persisted, 0);
  assert.ok(!evaluated.findings.some((f) => f.type === 'revenue_change'));
});

test('a coverage window that does not span both periods is rejected', async () => {
  const fixture = qualifyingRevenueDropFixture();
  // Starts after previousStart, so the earlier period is not covered.
  fixture.coverage = [certifiedCoverage({ coverage_start: new Date(CURRENT_START) })];

  const { evaluated, persisted } = await evaluateAndPersist(fixture);

  assert.equal(persisted, 0);
  assert.ok(!evaluated.findings.some((f) => f.type === 'revenue_change'));
});

test('the production shape — five orders, no certification — yields no business finding', async () => {
  const fixture = {
    stores: [store()],
    webhookRegistrations: [],
    coverage: [],
    orders: orderBatch({ from: PREVIOUS_START + DAY, count: 5, total: 700, prefix: 'c' }),
  };

  const { evaluated, persisted } = await evaluateAndPersist(fixture);

  assert.equal(persisted, 0);
  assert.equal(
    evaluated.findings.filter((f) => f.type !== 'integration_failure').length,
    0
  );
});

test('fewer than ten orders per period is below the evidence threshold', async () => {
  const fixture = qualifyingRevenueDropFixture();
  fixture.orders = [
    ...orderBatch({ from: PREVIOUS_START + DAY, count: 9, total: 100, prefix: 'a' }),
    ...orderBatch({ from: CURRENT_START + DAY, count: 9, total: 50, prefix: 'b' }),
  ];

  const { evaluated, persisted } = await evaluateAndPersist(fixture);

  assert.equal(persisted, 0);
  assert.ok(!evaluated.findings.some((f) => f.type === 'revenue_change'));
});

test('a movement below the 25% threshold is not reported as a finding', async () => {
  const fixture = qualifyingRevenueDropFixture();
  fixture.orders = [
    ...orderBatch({ from: PREVIOUS_START + DAY, count: 20, total: 100, prefix: 'a' }),
    ...orderBatch({ from: CURRENT_START + DAY, count: 20, total: 90, prefix: 'b' }),
  ];

  const { evaluated } = await evaluateAndPersist(fixture);

  assert.ok(
    !evaluated.findings.some((f) => f.type === 'revenue_change'),
    'a 10% move is inside normal variation'
  );
});

test('failed webhook registrations produce an integration_failure finding', async () => {
  const fixture = {
    // Mirrors the production store that has never synced: 16 failed
    // registrations and no last_synced_at.
    stores: [store({ last_synced_at: null })],
    webhookRegistrations: Array.from({ length: 16 }, () => ({
      store_id: STORE,
      status: 'failed',
    })),
    coverage: [],
    orders: [],
  };

  const { evaluated, persisted, db } = await evaluateAndPersist(fixture);

  const integration = evaluated.findings.find((f) => f.type === 'integration_failure');
  assert.ok(integration, 'failed webhook setup is reportable on its own');
  assert.equal(integration.severity, 'high');
  assert.equal(integration.evidence.verified, true);
  assert.equal(integration.evidence.setup_status, 'failed');
  assert.equal(integration.evidence.failed_webhook_registrations, 16);

  assert.equal(persisted, 1);
  const row = [...db._findings.values()][0];
  assert.equal(row.type, 'integration_failure');
});

test('a store that never synced and has no failed registrations is diagnosed, not asserted', async () => {
  const fixture = {
    stores: [store({ last_synced_at: null })],
    webhookRegistrations: [],
    coverage: [],
    orders: [],
  };

  const { evaluated, persisted } = await evaluateAndPersist(fixture);

  assert.equal(persisted, 0);
  assert.ok(
    evaluated.diagnostics.some((d) => d.status === 'insufficient_sync_verification')
  );
});

test('repeated passes update the finding instead of duplicating it', async () => {
  const fixture = qualifyingRevenueDropFixture();
  const db = fakePrisma(fixture);

  const first = await evaluateOrganizationFindings(db, ORG, { now: NOW });
  const firstSaved = await persistVerifiedFindings(db, ORG, first.findings);

  const second = await evaluateOrganizationFindings(db, ORG, { now: NOW });
  const secondSaved = await persistVerifiedFindings(db, ORG, second.findings);

  assert.equal(firstSaved, 1);
  assert.equal(secondSaved, 1);
  assert.equal(db._findings.size, 1, 'the dedupe key must collapse repeat passes');
  assert.equal(db._calls.upsertCreate, 1);
  assert.equal(db._calls.upsertUpdate, 1);
});

test('a finding for another tenant is never persisted', async () => {
  const fixture = {
    // Store belongs to OTHER_ORG; evaluation is requested for ORG.
    stores: [store({ organization_id: OTHER_ORG })],
    webhookRegistrations: Array.from({ length: 3 }, () => ({
      store_id: STORE,
      status: 'failed',
    })),
    coverage: [],
    orders: [],
  };

  const db = fakePrisma(fixture);
  const evaluated = await evaluateOrganizationFindings(db, OTHER_ORG, { now: NOW });
  assert.ok(evaluated.findings.length > 0, 'the other tenant does have a finding');

  // Persisting that candidate under ORG must be refused by the scope check.
  const persisted = await persistVerifiedFindings(db, ORG, evaluated.findings);

  assert.equal(persisted, 0);
  assert.equal(db._findings.size, 0);
});

test('a candidate with unverified evidence is not persisted', async () => {
  const db = fakePrisma({ stores: [store()] });

  const forged = [
    {
      type: 'revenue_change',
      severity: 'critical',
      title: 'Fabricated',
      description: 'No evidence behind this.',
      scope: { organizationId: ORG, storeId: STORE },
      evidence: { verified: false },
      dedupe_key: 'revenue_change:forged',
    },
  ];

  assert.equal(await persistVerifiedFindings(db, ORG, forged), 0);
  assert.equal(db._findings.size, 0);
});

test('an unknown finding type is not persisted', async () => {
  const db = fakePrisma({ stores: [store()] });

  const unknown = [
    {
      type: 'competitor_undercutting_us',
      severity: 'high',
      title: 'Not a supported conclusion',
      description: 'Invented type.',
      scope: { organizationId: ORG, storeId: STORE },
      evidence: { verified: true },
      dedupe_key: 'competitor_undercutting_us:x',
    },
  ];

  assert.equal(await persistVerifiedFindings(db, ORG, unknown), 0);
});

test('a store id that is not a UUID is rejected', async () => {
  const db = fakePrisma({ stores: [store()] });

  const badScope = [
    {
      type: 'integration_failure',
      severity: 'high',
      title: 'Bad scope',
      description: 'Store id is not a UUID.',
      scope: { organizationId: ORG, storeId: 'not-a-uuid' },
      evidence: { verified: true },
      dedupe_key: 'integration_failure:bad',
    },
  ];

  assert.equal(await persistVerifiedFindings(db, ORG, badScope), 0);
});

test('mixed currencies across the window are refused rather than summed', async () => {
  const fixture = qualifyingRevenueDropFixture();
  fixture.orders = [
    ...orderBatch({ from: PREVIOUS_START + DAY, count: 20, total: 100, currency: 'USD', prefix: 'a' }),
    ...orderBatch({ from: CURRENT_START + DAY, count: 20, total: 50, currency: 'NGN', prefix: 'b' }),
  ];

  const { evaluated, persisted } = await evaluateAndPersist(fixture);

  assert.equal(persisted, 0);
  assert.ok(
    evaluated.diagnostics.some((d) => d.status === 'mixed_currency_or_no_orders')
  );
  assert.ok(!evaluated.findings.some((f) => f.type === 'revenue_change'));
});
