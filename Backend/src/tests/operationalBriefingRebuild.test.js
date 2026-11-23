'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const DB_PATH = require.resolve('../configs/database');
require.cache[DB_PATH] = { id: DB_PATH, filename: DB_PATH, loaded: true, exports: { prisma: null } };

const {
  composeBriefing,
  selectFeaturedIntelligence,
  composeRecentDevelopments,
  assessBriefingSituation,
} = require('../services/commandCenterService');

const NOW = new Date('2026-11-08T12:00:00Z');
const PREV_BRIEFING = new Date('2026-11-08T06:00:00Z');

const snapshot = (extra = {}) => ({
  id: 'state-2',
  schema_version: '1.1',
  generated_at: new Date('2026-11-08T11:55:00Z'),
  data_freshness_at: new Date('2026-11-08T11:50:00Z'),
  valid_until: new Date('2026-11-08T12:25:00Z'),
  staleness_threshold_mins: 30,
  computation_status: 'complete',
  revenue_today: '18420',
  revenue_yesterday: '19000',
  revenue_delta_pct: -3.05,
  abandoned_cart_count: 2,
  metadata: { revenue_currency: 'USD', warnings: [] },
  ...extra,
});

const previousSnapshot = {
  id: 'state-1',
  generated_at: PREV_BRIEFING,
  computation_status: 'complete',
};

const integration = (extra = {}) => ({
  overall_status: 'connected',
  status_explanation: 'Store evidence is synchronized.',
  evaluated_at: NOW.toISOString(),
  merchant_action_required: false,
  recommended_next_step: null,
  store: { id: 'store-1' },
  coverage: { status: 'complete' },
  capabilities: [
    { id: 'orders', name: 'orders', operational: true, authorization: 'granted', sync_state: 'succeeded', freshness: 'fresh', limited_reasons: [] },
  ],
  ...extra,
});

const presentedFinding = (overrides = {}) => ({
  contract_version: 'command-center-priority-finding-v1',
  id: 'finding-1',
  organization_id: 'merchant-a',
  store_id: 'store-1',
  category: 'business_performance',
  type: 'revenue_change',
  severity: 'high',
  title: 'Net sales declined',
  description: 'Recorded net sales declined between comparable periods.',
  detected_at: '2026-11-08T10:00:00Z',
  last_verified_at: '2026-11-08T11:00:00Z',
  confidence: { classification: 'high', rationale: ['Verified'], numerical_score: null },
  lifecycle: { state: 'open', current_validity: 'current_evidence_verified', invalidated: false },
  evidence: { classification: 'verified_observation', source: 'orders', observations: [], references: [], duplicate_finding_ids: [] },
  recommendation: { available: true, step: 'Review', rationale: 'Narrows the affected orders.', expected_result: null, validation_method: null, prerequisites: [], read_only: true, executed: false },
  investigation: { finding_id: 'finding-1', route: '/dashboard/rev-intell?finding=finding-1', context_contract: 'rev-selected-finding-v1', revalidate_on_open: true },
  read_only: true,
  ...overrides,
});

test('featured intelligence excludes unresolved Top Priority and selects qualifying secondary discovery', () => {
  const topPriority = presentedFinding({ id: 'priority-1', title: 'Top priority issue', detected_at: '2026-11-08T04:00:00Z' });
  const secondaryOld = presentedFinding({ id: 'old-2', type: 'order_volume_change', severity: 'medium', title: 'Order volume shifted earlier', detected_at: '2026-11-07T18:00:00Z' });
  const secondaryNew = presentedFinding({ id: 'new-3', type: 'refund_increase', severity: 'medium', title: 'Refund value rose this morning', detected_at: '2026-11-08T09:30:00Z' });

  const result = selectFeaturedIntelligence({
    presentedFindings: [topPriority, secondaryOld, secondaryNew],
    priorityFindingId: 'priority-1',
    status: 'current',
    state: integration(),
    snapshot: snapshot(),
    hasPreviousBriefing: true,
    previousGeneratedAt: PREV_BRIEFING.toISOString(),
    now: NOW,
  });

  assert.equal(result.status, 'qualified');
  assert.equal(result.empty_state, null);
  assert.equal(result.item.finding_id, 'new-3');
  assert.equal(result.item.is_new, true);
  assert.equal(result.item.verification_status, 'verified');
  assert.notEqual(result.item.finding_id, 'priority-1');
});

test('featured intelligence never duplicates Top Priority when only one active finding exists', () => {
  const onlyFinding = presentedFinding({ id: 'priority-1' });
  const result = selectFeaturedIntelligence({
    presentedFindings: [onlyFinding],
    priorityFindingId: 'priority-1',
    status: 'current',
    state: integration(),
    snapshot: snapshot(),
    hasPreviousBriefing: true,
    previousGeneratedAt: PREV_BRIEFING.toISOString(),
    now: NOW,
  });

  assert.equal(result.status, 'empty');
  assert.equal(result.empty_state, 'no_new_findings');
  assert.equal(result.item, null);
});

test('featured intelligence distinguishes all five mandatory empty states', () => {
  const base = {
    presentedFindings: [],
    priorityFindingId: null,
    state: integration(),
    snapshot: snapshot(),
    hasPreviousBriefing: true,
    previousGeneratedAt: PREV_BRIEFING.toISOString(),
    now: NOW,
  };

  assert.equal(selectFeaturedIntelligence({ ...base, status: 'current' }).empty_state, 'no_new_findings');
  assert.equal(selectFeaturedIntelligence({ ...base, status: 'current', state: integration({ overall_status: 'disconnected' }) }).empty_state, 'insufficient_evidence');
  assert.equal(selectFeaturedIntelligence({ ...base, status: 'current', state: integration({ overall_status: 'synchronizing' }) }).empty_state, 'investigation_running');
  assert.equal(selectFeaturedIntelligence({ ...base, status: 'failed' }).empty_state, 'generation_failed');
  assert.equal(selectFeaturedIntelligence({ ...base, status: 'unavailable', snapshot: null, hasPreviousBriefing: false, previousGeneratedAt: null }).empty_state, 'no_previous_briefing');
});

test('recent developments distinguishes new, ongoing, and resolved items and excludes routine sync noise', () => {
  const topPriority = presentedFinding({ id: 'priority-1', title: 'Top priority' });
  const featured = presentedFinding({ id: 'featured-2', title: 'Featured discovery' });
  const ongoingFinding = presentedFinding({ id: 'ongoing-3', title: 'Returning buyer share softened', detected_at: '2026-11-07T08:00:00Z' });
  const newFinding = presentedFinding({ id: 'new-4', title: 'Order volume shifted', detected_at: '2026-11-08T10:30:00Z' });

  const resolvedFindings = [
    { id: 'resolved-5', status: 'resolved', title: 'Checkout anomaly', resolved_at: new Date('2026-11-08T09:00:00Z'), updated_at: new Date('2026-11-08T09:00:00Z') },
  ];

  const operationalActivity = {
    items: [
      { event_id: 'sync:orders:succeeded:2026-11-08T11:00:00Z', type: 'sync', category: 'sync', status: 'succeeded', occurred_at: '2026-11-08T11:00:00Z' },
      { event_id: 'sync:inventory:failed:2026-11-08T08:00:00Z', type: 'sync', category: 'sync', status: 'failed', occurred_at: '2026-11-08T08:00:00Z' },
    ],
  };

  const result = composeRecentDevelopments({
    presentedFindings: [topPriority, featured, ongoingFinding, newFinding],
    resolvedFindings,
    priorityFindingId: 'priority-1',
    featuredFindingId: 'featured-2',
    operationalActivity,
    hasPreviousBriefing: true,
    previousGeneratedAt: PREV_BRIEFING.toISOString(),
    now: NOW,
  });

  assert.equal(result.empty_state, null);
  assert.equal(result.items.some(i => i.finding_id === 'priority-1'), false);
  assert.equal(result.items.some(i => i.finding_id === 'featured-2'), false);
  assert.equal(result.items.some(i => i.id.includes('sync:orders:succeeded')), false);

  const byId = new Map(result.items.map(i => [i.id, i]));
  assert.equal(byId.get('dev-finding:new-4').lifecycle, 'new');
  assert.equal(byId.get('dev-finding:ongoing-3').lifecycle, 'ongoing');
  assert.equal(byId.get('dev-resolved:resolved-5').lifecycle, 'resolved');
  assert.equal(byId.get('dev-op:sync:inventory:failed:2026-11-08T08:00:00Z').lifecycle, 'new');
});

test('recent developments distinguishes no_changes vs no_previous_briefing empty states', () => {
  const noChanges = composeRecentDevelopments({
    presentedFindings: [],
    resolvedFindings: [],
    hasPreviousBriefing: true,
    previousGeneratedAt: PREV_BRIEFING.toISOString(),
    now: NOW,
  });
  assert.equal(noChanges.empty_state, 'no_changes');

  const firstBriefing = composeRecentDevelopments({
    presentedFindings: [],
    resolvedFindings: [],
    hasPreviousBriefing: false,
    previousGeneratedAt: null,
    now: NOW,
  });
  assert.equal(firstBriefing.empty_state, 'no_previous_briefing');
});

test('assessment separates business posture from data quality and preserves briefing generation timestamp', () => {
  const partialNoFindings = assessBriefingSituation({
    snapshot: snapshot({ computation_status: 'partial' }),
    status: 'partial',
    state: integration({ overall_status: 'limited_access' }),
    findings: [],
  });
  assert.equal(partialNoFindings.state, 'normal');
  assert.equal(partialNoFindings.data_quality, 'partial');

  const disconnected = assessBriefingSituation({
    snapshot: null,
    status: 'unavailable',
    state: integration({ overall_status: 'disconnected' }),
    findings: [],
  });
  assert.equal(disconnected.state, 'insufficient_evidence');
  assert.equal(disconnected.data_quality, 'insufficient');

  const briefing = composeBriefing({
    snapshot: snapshot(),
    previousSnapshot,
    status: 'current',
    state: integration(),
    findings: [],
    presentedFindings: [],
    resolvedFindings: [],
    operationalActivity: null,
    warnings: [],
    now: NOW,
  });
  assert.equal(briefing.generated_at, '2026-11-08T11:55:00.000Z');
  assert.equal(briefing.previous_generated_at, '2026-11-08T06:00:00.000Z');
  assert.equal(briefing.has_previous_briefing, true);
});
