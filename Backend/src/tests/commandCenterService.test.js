'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const DB_PATH = require.resolve('../configs/database');
require.cache[DB_PATH] = { id: DB_PATH, filename: DB_PATH, loaded: true, exports: { prisma: null } };
const { getCommandCenter, prioritizedFindings, snapshotStatus, buildMetrics, composeBriefing, resourceEvidence, CONTRACT_VERSION } = require('../services/commandCenterService');

const NOW = new Date('2026-11-08T12:00:00Z');
const generatedAt = new Date('2026-11-08T11:55:00Z');
const snapshot = (extra = {}) => ({
  id: 'state-1', schema_version: '1.1', generated_at: generatedAt,
  data_freshness_at: generatedAt, valid_until: new Date('2026-11-08T12:10:00Z'),
  staleness_threshold_mins: 15, computation_status: 'complete',
  revenue_today: '18420', revenue_yesterday: '25000', revenue_delta_pct: -26.32,
  abandoned_cart_count: 4, metadata: { revenue_currency: 'USD', warnings: [] }, ...extra,
});
const capability = (id, extra = {}) => ({ id, name: id, operational: true, authorization: 'granted', sync_state: 'succeeded', freshness: 'fresh', limited_reasons: [], ...extra });
const integration = (extra = {}) => ({
  overall_status: 'connected', status_explanation: 'Store evidence is synchronized.', evaluated_at: NOW.toISOString(),
  merchant_action_required: false, recommended_next_step: 'Review evidence.',
  store: { id: 'store-1' }, coverage: { status: 'complete' },
  capabilities: [capability('orders'), capability('abandoned-checkouts'), capability('inventory.levels')], ...extra,
});
const finding = (extra = {}) => ({ id: 'finding-1', store_id: 'store-1', type: 'revenue_change', severity: 'high', title: 'Net sales declined', description: 'Recorded net sales declined between comparable periods.', detected_at: NOW, evidence: { verified: true }, ...extra });

const scenarios = [
  ['healthy sufficient evidence stays calm', {}, integration(), [], 'Your latest synchronized business picture'],
  ['verified revenue deterioration leads briefing', {}, integration(), [finding()], 'Net sales declined'],
  ['inventory unavailable remains a local limitation', {}, integration({ overall_status: 'limited_access', status_explanation: 'Inventory evidence is incomplete.', capabilities: [capability('orders'), capability('abandoned-checkouts'), capability('inventory.levels', { operational: false, authorization: 'missing_scope', sync_state: 'unsupported', freshness: null })] }), [], 'Your latest synchronized business picture'],
  ['stale order evidence is not current performance', { generated_at: new Date('2026-11-03T12:00:00Z') }, integration({ overall_status: 'sync_failed', status_explanation: 'Orders have not refreshed.' }), [], 'Your latest business evidence needs a refresh'],
  ['new merchant synchronization has no fabricated history', { revenue_today: null, revenue_yesterday: null, revenue_delta_pct: null, abandoned_cart_count: null }, integration({ overall_status: 'synchronizing' }), [], 'Revluma is preparing your first business overview'],
  ['no verified findings is bounded', {}, integration(), [], 'Your latest synchronized business picture'],
  ['contradictory multicurrency financial evidence is withheld', { revenue_today: null, revenue_yesterday: null, revenue_delta_pct: null, computation_status: 'partial', metadata: { revenue_currency: null, warnings: ['Orders in multiple currencies cannot be summed.'] } }, integration(), [], 'A partial operational picture is available'],
  ['partial initial synchronization is explicit', { computation_status: 'partial' }, integration({ overall_status: 'synchronizing' }), [], 'Revluma is preparing your first business overview'],
  ['disconnected integration is not a business decline', {}, integration({ overall_status: 'disconnected', status_explanation: 'The store is disconnected.' }), [], 'Reconnect Shopify to restore your operational briefing'],
  ['failed business-state generation is unavailable', { computation_status: 'failed' }, integration(), [], 'Your operational briefing is unavailable'],
];

for (const [name, statePatch, state, findings, expected] of scenarios) {
  test(`briefing example: ${name}`, () => {
    const snap = snapshot(statePatch);
    const status = snapshotStatus(snap, NOW);
    const result = composeBriefing({ snapshot: snap, status, state, findings, warnings: snap.metadata.warnings });
    assert.equal(result.headline, expected);
    assert.ok(result.next_investigation.route.startsWith('/dashboard/'));
    assert.ok(!/doing great|everything looks good|optimize your store/i.test(result.summary));
  });
}

test('fresh, stale, partial, failed, unavailable and unknown snapshot states remain distinct', () => {
  assert.equal(snapshotStatus(snapshot(), NOW), 'current');
  assert.equal(snapshotStatus(snapshot({ generated_at: new Date('2026-11-08T10:00:00Z') }), NOW), 'stale');
  assert.equal(snapshotStatus(snapshot({ computation_status: 'partial' }), NOW), 'partial');
  assert.equal(snapshotStatus(snapshot({ computation_status: 'failed' }), NOW), 'failed');
  assert.equal(snapshotStatus(null, NOW), 'unavailable');
  assert.equal(snapshotStatus(snapshot({ generated_at: 'invalid' }), NOW), 'unknown');
});

test('metrics carry UTC definitions, currency and provenance', () => {
  const metrics = buildMetrics(snapshot(), integration(), 'current');
  assert.equal(metrics[0].value, 18420);
  assert.equal(metrics[0].currency, 'USD');
  assert.equal(metrics[0].reporting_period.timezone, 'UTC');
  assert.match(metrics[0].definition, /net of refunds/);
  assert.equal(metrics[0].source, 'business_states.current');
});

test('missing monetary currency never displays a scalar', () => {
  const metrics = buildMetrics(snapshot({ metadata: { revenue_currency: null, warnings: [] } }), integration(), 'current');
  assert.equal(metrics[0].value, null);
  assert.equal(metrics[0].availability, 'unknown');
  assert.match(metrics[0].availability_reason, /currency/);
});

test('failed generation produces no financial or checkout indicators', () => {
  assert.deepEqual(buildMetrics(snapshot({ computation_status: 'failed' }), integration(), 'failed'), []);
});

test('verified zero requires available source evidence', () => {
  const zero = buildMetrics(snapshot({ abandoned_cart_count: 0 }), integration(), 'current');
  assert.equal(zero[3].zero_semantics, 'verified_zero');
  const unverified = buildMetrics(snapshot({ abandoned_cart_count: 0 }), integration({ capabilities: [capability('orders'), capability('abandoned-checkouts', { operational: false, sync_state: 'never_synchronized' })] }), 'current');
  assert.equal(unverified[3].availability, 'not_synchronized');
});

test('weak hypotheses and invalidated evidence never enter priority findings', () => {
  const valid = finding();
  const result = prioritizedFindings([
    finding({ id: 'hypothesis', severity: 'critical', evidence: { verified: false } }),
    finding({ id: 'duplicate', evidence: { verified: true } }),
    valid,
  ]);
  assert.deepEqual(result.map(item => item.id), ['duplicate', 'finding-1']);
});

test('findings are deduplicated and ordered by defensible severity then recency', () => {
  const result = prioritizedFindings([
    finding({ id: 'low', severity: 'low' }),
    finding({ id: 'critical', severity: 'critical', detected_at: new Date('2026-11-08T10:00:00Z') }),
    finding({ id: 'critical', severity: 'critical' }),
  ]);
  assert.deepEqual(result.map(item => item.id), ['critical', 'low']);
});

test('finding investigation preserves its authoritative id', () => {
  const result = composeBriefing({ snapshot: snapshot(), status: 'current', state: integration(), findings: [finding({ id: 'abc/def' })], warnings: [] });
  assert.equal(result.next_investigation.finding_id, 'abc/def');
  assert.match(result.next_investigation.route, /finding=abc%2Fdef/);
  assert.equal(result.next_investigation.kind, 'investigate_finding');
});

test('stale metric values are labelled rather than suppressed', () => {
  const metrics = buildMetrics(snapshot(), integration(), 'stale');
  assert.equal(metrics[0].availability, 'stale');
  assert.equal(metrics[0].value, 18420);
  assert.match(metrics[0].availability_reason, /not current performance/);
});

test('resource freshness uses each resource last success, not one global timestamp', () => {
  const state = integration();
  const rows = [
    { store_id: 'store-1', domain: 'orders', last_succeeded_at: new Date('2026-11-08T11:00:00Z'), last_attempted_at: NOW },
    { store_id: 'store-1', domain: 'abandoned_checkouts', last_succeeded_at: new Date('2026-11-07T11:00:00Z'), last_attempted_at: NOW },
  ];
  const resources = resourceEvidence([state], rows);
  assert.equal(resources.find(item => item.resource === 'orders').last_success_at, '2026-11-08T11:00:00.000Z');
  assert.equal(resources.find(item => item.resource === 'abandoned-checkouts').last_success_at, '2026-11-07T11:00:00.000Z');
});

test('unauthorized, unsupported, retrieval failure and unknown coverage are not collapsed', () => {
  const state = integration({ capabilities: [
    capability('orders', { authorization: 'missing_scope' }),
    capability('abandoned-checkouts', { sync_state: 'unsupported', operational: false }),
    capability('inventory.levels', { sync_state: 'failed', operational: false }),
  ] });
  const availability = resourceEvidence([state], []).map(item => item.availability);
  assert.deepEqual(availability, ['unauthorized', 'unsupported', 'retrieval_failed']);
});

test('no-findings language is bounded by available checks and evidence', () => {
  const result = composeBriefing({ snapshot: snapshot(), status: 'current', state: integration(), findings: [], warnings: [] });
  assert.match(result.no_findings_note, /not proof/);
  assert.doesNotMatch(result.no_findings_note, /no issues exist|healthy/);
});

test('primary finding does not invent a cause or recovery estimate', () => {
  const result = composeBriefing({ snapshot: snapshot(), status: 'current', state: integration(), findings: [finding()], warnings: [] });
  assert.match(result.observation, /not an unrecorded cause/);
  assert.equal(JSON.stringify(result).includes('recoverable_revenue'), false);
});

test('contract has a stable version and read-only composition', () => {
  assert.equal(CONTRACT_VERSION, 'command-center-v1');
});

test('tenant-scoped snapshot and store reads never accept browser tenant or metric input', async () => {
  const calls = [];
  const prisma = {
    business_states: { findFirst: async args => { calls.push(['snapshot', args]); return null; } },
    intelligence_findings: { findMany: async args => { calls.push(['findings', args]); return []; } },
    stores: { findMany: async args => { calls.push(['stores', args]); return []; } },
    store_sync_domain_states: { findMany: async () => { throw new Error('No store IDs means no domain query'); } },
  };
  const result = await getCommandCenter({ prisma, organizationId: 'merchant-a', now: NOW });
  assert.equal(result.context.organization_id, 'merchant-a');
  assert.equal(result.business_state.presentation_status, 'unavailable');
  for (const [, args] of calls) assert.equal(args.where.organization_id, 'merchant-a');
  assert.equal(JSON.stringify(result).includes('access_token'), false);
});
