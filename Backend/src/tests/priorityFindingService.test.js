'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assessFinding, freshnessFor, prioritizedFindings, presentPriorityFinding,
  recommendationForFinding, findingPeriod, observationFor,
  CONTRACT_VERSION, PRIORITY_METHOD_VERSION,
} = require('../services/priorityFindingService');
const { TRUSTED_SOURCE } = require('../services/intelligenceOrderCoverage');
const NOW = new Date('2026-11-08T12:00:00Z');
const evidence = (extra = {}) => ({
  verified: true, complete: true, source: 'orders', coverage_source: TRUSTED_SOURCE,
  coverage_run_id: 'coverage-run-123', currency: 'USD',
  previousStart: '2026-10-25T00:00:00Z', previousEnd: '2026-11-01T00:00:00Z',
  currentStart: '2026-11-01T00:00:00Z', currentEnd: '2026-11-08T00:00:00Z',
  currentCount: 20, previousCount: 20, currentRevenue: 650, previousRevenue: 1000,
  ...extra,
});
const finding = (extra = {}) => ({
  id: '123e4567-e89b-42d3-a456-426614174000', store_id: 'store-a', type: 'revenue_change',
  severity: 'high', status: 'open', dedupe_key: null, title: 'Net sales declined',
  description: 'Recorded net sales declined between comparable periods.',
  detected_at: '2026-11-08T10:00:00Z', updated_at: '2026-11-08T11:30:00Z',
  evidence: evidence(), ...extra,
});
const assess = (f, resource = null) => assessFinding(f, { now: NOW, resource });
const candidate = (f = finding()) => ({ finding: f, assessment: assess(f), duplicates: [] });

// Freshness and source-state behavior (8).
for (const [name, mutation, expected] of [
  ['fresh within one hour', f => { f.updated_at = '2026-11-08T11:30:00Z'; }, 'fresh'],
  ['aging after one hour', f => { f.updated_at = '2026-11-08T10:00:00Z'; }, 'aging'],
  ['stale after one day', f => { f.updated_at = '2026-11-06T10:00:00Z'; }, 'stale'],
  ['stale measurement window', f => { f.evidence.currentEnd = '2026-11-01T00:00:00Z'; }, 'stale'],
  ['failed current resource', () => {}, 'stale'],
  ['unknown timestamp', f => { f.updated_at = null; f.detected_at = null; }, 'unknown'],
  ['future update bounded age', f => { f.updated_at = '2026-11-09T00:00:00Z'; }, 'fresh'],
  ['invalid timestamp fails closed', f => { f.updated_at = 'invalid'; f.detected_at = 'invalid'; }, 'unknown'],
]) test(`freshness: ${name}`, () => {
  const f = finding(); mutation(f);
  const resource = name === 'failed current resource' ? { availability: 'retrieval_failed' } : null;
  assert.equal(freshnessFor(f, NOW, resource).state, expected);
});

// Validity, lifecycle, confidence and coverage (12).
for (const [name, mutation, field, expected] of [
  ['verified current eligible', () => {}, 'eligible', true],
  ['acknowledged remains current', f => { f.status = 'acknowledged'; }, 'eligible', true],
  ['resolved is historical', f => { f.status = 'resolved'; }, 'current_validity', 'historical_resolved'],
  ['dismissed is historical', f => { f.status = 'dismissed'; }, 'current_validity', 'historical_dismissed'],
  ['invalidated is not current', f => { f.status = 'invalidated'; }, 'current_validity', 'historical_invalidated'],
  ['superseded is not current', f => { f.status = 'superseded'; }, 'current_validity', 'historical_superseded'],
  ['unverified evidence excluded', f => { f.evidence.verified = false; }, 'current_validity', 'evidence_unverified'],
  ['incomplete evidence excluded', f => { f.evidence.complete = false; }, 'current_validity', 'evidence_unverified'],
  ['contradictory evidence excluded', f => { f.evidence.contradictory = true; }, 'current_validity', 'contradictory_evidence'],
  ['fresh certified evidence high confidence', () => {}, 'confidence', 'high'],
  ['aging certified evidence moderate confidence', f => { f.updated_at = '2026-11-08T09:00:00Z'; }, 'confidence', 'moderate'],
  ['uncertified evidence insufficient confidence', f => { f.evidence.coverage_run_id = null; }, 'confidence', 'insufficient_evidence'],
]) test(`assessment: ${name}`, () => {
  const f = finding(); mutation(f);
  assert.equal(assess(f)[field], expected);
});

// Ranking, ties, duplicates and stability (12).
test('priority: higher severity leads without a fabricated numeric score', () => {
  const low = finding({ id: 'low', severity: 'low' }), high = finding({ id: 'high', severity: 'high' });
  const result = prioritizedFindings([low, high], { now: NOW });
  assert.equal(result.candidates[0].finding.id, 'high');
  assert.equal(JSON.stringify(result).includes('priority_score'), false);
});
test('priority: fresh candidate outranks aging at same severity', () => {
  const aging = finding({ id: 'aging', updated_at: '2026-11-08T08:00:00Z' });
  const fresh = finding({ id: 'fresh', updated_at: '2026-11-08T11:45:00Z' });
  assert.equal(prioritizedFindings([aging, fresh], { now: NOW }).candidates[0].finding.id, 'fresh');
});
test('priority: measured sample outranks unmeasured observation at same severity/freshness', () => {
  const unmeasured = finding({ id: 'unmeasured', type: 'integration_failure', evidence: { verified: true, source: 'stores', storeId: 'store-a', observed_at: NOW.toISOString() } });
  const measured = finding({ id: 'measured' });
  assert.equal(prioritizedFindings([unmeasured, measured], { now: NOW }).candidates[0].finding.id, 'measured');
});
test('priority: unsupported critical finding cannot outrank verified low finding', () => {
  const bad = finding({ id: 'bad', severity: 'critical', evidence: evidence({ verified: false }) });
  const good = finding({ id: 'good', severity: 'low' });
  const result = prioritizedFindings([bad, good], { now: NOW });
  assert.deepEqual(result.candidates.map(x => x.finding.id), ['good']);
  assert.equal(result.excluded[0].finding_id, 'bad');
});
test('priority: stale high-value finding cannot dominate', () => {
  const stale = finding({ id: 'stale', evidence: evidence({ currentEnd: '2026-10-20T00:00:00Z', currentRevenue: 999999 }) });
  const good = finding({ id: 'good', severity: 'low' });
  assert.deepEqual(prioritizedFindings([stale, good], { now: NOW }).candidates.map(x => x.finding.id), ['good']);
});
test('priority: deterministic stable-id tie handling is disclosed', () => {
  const a = finding({ id: 'aaa', detected_at: '2026-11-08T10:00:00Z' });
  const b = finding({ id: 'bbb', detected_at: '2026-11-08T10:00:00Z' });
  const result = prioritizedFindings([b, a], { now: NOW });
  assert.deepEqual(result.candidates.map(x => x.finding.id), ['aaa', 'bbb']);
  assert.match(result.tie.statement, /equal severity, freshness and measured-sample/);
});
test('priority: latest update is stable across input order', () => {
  const a = finding({ id: 'aaa' }), b = finding({ id: 'bbb', severity: 'low' });
  const first = prioritizedFindings([a, b], { now: NOW });
  const second = prioritizedFindings([b, a], { now: NOW });
  assert.deepEqual(first.candidates.map(x => x.finding.id), second.candidates.map(x => x.finding.id));
});
test('priority: same dedupe key produces one candidate and preserves duplicate IDs', () => {
  const old = finding({ id: 'old', dedupe_key: 'same', updated_at: '2026-11-08T10:00:00Z' });
  const current = finding({ id: 'current', dedupe_key: 'same', updated_at: '2026-11-08T11:00:00Z' });
  const result = prioritizedFindings([old, current], { now: NOW });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].finding.id, 'current');
  assert.deepEqual(result.candidates[0].duplicates, ['old']);
});
test('priority: same type and window without dedupe signal remains independent', () => {
  const a = finding({ id: 'a', dedupe_key: null }), b = finding({ id: 'b', dedupe_key: null });
  assert.equal(prioritizedFindings([a, b], { now: NOW }).candidates.length, 2);
});
test('priority: different stores never merge identical dedupe keys', () => {
  const a = finding({ id: 'a', dedupe_key: 'same' }), b = finding({ id: 'b', store_id: 'store-b', dedupe_key: 'same' });
  assert.equal(prioritizedFindings([a, b], { now: NOW }).candidates.length, 2);
});
test('priority: no defensible finding returns an honest exclusion', () => {
  const result = prioritizedFindings([finding({ evidence: evidence({ verified: false }) })], { now: NOW });
  assert.equal(result.candidates.length, 0);
  assert.equal(result.excluded[0].reason, 'evidence_unverified');
});
test('priority: current order evidence failure invalidates candidate', () => {
  const state = { capabilities: [{ id: 'orders', operational: true, sync_state: 'failed', freshness: 'stale', limited_reasons: ['Latest sync failed.'] }] };
  const result = prioritizedFindings([finding()], { now: NOW, resourcesByStore: new Map([['store-a', state]]) });
  assert.equal(result.candidates.length, 0);
  assert.equal(result.excluded[0].reason, 'stale_unreverified');
});

// Canonical presentation (10).
test('presentation: typed versioned contract and ownership', () => {
  const result = presentPriorityFinding(candidate(), 'org-a');
  assert.equal(result.contract_version, CONTRACT_VERSION);
  assert.equal(result.priority.method_version, PRIORITY_METHOD_VERSION);
  assert.equal(result.organization_id, 'org-a');
  assert.equal(result.store_id, 'store-a');
});
test('presentation: finding and coverage references are authoritative', () => {
  const refs = presentPriorityFinding(candidate(), 'org-a').evidence.references;
  assert.ok(refs.some(ref => ref.id === `finding:${finding().id}`));
  assert.ok(refs.some(ref => ref.source_record_id === 'coverage-run-123'));
});
test('presentation: confidence rationale is visible without percentages', () => {
  const result = presentPriorityFinding(candidate(), 'org-a');
  assert.equal(result.confidence.classification, 'high');
  assert.equal(result.confidence.numerical_score, null);
  assert.ok(result.confidence.rationale.length >= 2);
});
test('presentation: limitations are claim-specific', () => {
  const limits = presentPriorityFinding(candidate(), 'org-a').limitations;
  assert.ok(limits.some(x => /cause/.test(x)));
  assert.ok(limits.some(x => /recoverable revenue/.test(x)));
});
test('presentation: reporting period and last verification are preserved', () => {
  const result = presentPriorityFinding(candidate(), 'org-a');
  assert.equal(result.reporting_period.timezone, 'UTC');
  assert.equal(result.last_verified_at, '2026-11-08T11:30:00.000Z');
});
test('presentation: investigation preserves exact encoded ID', () => {
  const f = finding({ id: 'abc/def' });
  const result = presentPriorityFinding(candidate(f), 'org-a');
  assert.equal(result.investigation.finding_id, 'abc/def');
  assert.match(result.investigation.route, /abc%2Fdef/);
  assert.equal(result.investigation.revalidate_on_open, true);
});
test('presentation: duplicate provenance remains inspectable', () => {
  const entry = { ...candidate(), duplicates: ['old-id'] };
  assert.deepEqual(presentPriorityFinding(entry, 'org-a').evidence.duplicate_finding_ids, ['old-id']);
});
test('presentation: read-only recommendation has no execution', () => {
  const result = presentPriorityFinding(candidate(), 'org-a');
  assert.equal(result.recommendation.read_only, true);
  assert.equal(result.recommendation.executed, false);
  assert.equal(result.recommendation.execution_status, 'not_requested');
});
test('presentation: empty candidate stays empty', () => assert.equal(presentPriorityFinding(null, 'org-a'), null));
test('presentation: stale context invalidates current recommendation', () => {
  const f = finding({ evidence: evidence({ currentEnd: '2026-10-01T00:00:00Z' }) });
  const result = presentPriorityFinding(candidate(f), 'org-a');
  assert.equal(result.lifecycle.invalidated, true);
  assert.equal(result.recommendation.available, false);
  assert.ok(result.recommendation.prerequisites.length > 0);
});

// Recommendations for every supported finding family (12).
for (const [type, needle] of [
  ['revenue_change', /order count and average order value/],
  ['order_volume_change', /product-level completed-order counts/],
  ['returning_customer_change', /returning-buyer counts/],
  ['refund_increase', /affected orders, products and recorded refund reasons/],
  ['integration_failure', /Shopify authorization/],
]) test(`recommendation: ${type} is specific and executable`, () => {
  const f = finding({ type });
  if (type === 'refund_increase') f.evidence = evidence({ source: 'order_transactions', refund_coverage_complete: true, currentRefundTotal: 400, previousRefundTotal: 200 });
  if (type === 'returning_customer_change') f.evidence = evidence({ currentReturning: 4, previousReturning: 8 });
  if (type === 'integration_failure') f.evidence = { verified: true, source: 'stores', storeId: 'store-a', observed_at: NOW.toISOString() };
  const rec = recommendationForFinding(f, assess(f));
  assert.equal(rec.available, true);
  assert.match(rec.step, needle);
  assert.ok(rec.rationale && rec.validation_method && rec.expected_result);
});
test('recommendation: unknown type withholds manufactured advice', () => {
  const rec = recommendationForFinding(finding({ type: 'unknown' }), { eligible: true });
  assert.equal(rec.available, false);
  assert.equal(rec.step, null);
});
test('recommendation: refund advice promises no recovery', () => {
  const f = finding({ type: 'refund_increase', evidence: evidence({ source: 'order_transactions', refund_coverage_complete: true, currentRefundTotal: 400, previousRefundTotal: 200 }) });
  assert.doesNotMatch(JSON.stringify(recommendationForFinding(f, assess(f))), /will recover|guaranteed|issue a refund/i);
});
test('recommendation: inventory history gap does not become stockout advice', () => {
  const f = finding({ evidence: evidence({ inventory_history_available: false }) });
  const a = assess(f);
  assert.ok(a.limitations.some(x => /Inventory history is unavailable/.test(x)));
  assert.doesNotMatch(recommendationForFinding(f, a).step, /stockout|restock/i);
});
test('recommendation: stale finding gets prerequisite only', () => {
  const f = finding({ updated_at: '2026-11-01T00:00:00Z' });
  const rec = recommendationForFinding(f, assess(f));
  assert.equal(rec.available, false);
  assert.match(rec.prerequisites[0], /fresh, verified/);
});
test('recommendation: invalid lifecycle never presented as current', () => {
  const f = finding({ status: 'resolved' });
  const rec = recommendationForFinding(f, assess(f));
  assert.equal(rec.lifecycle_state, 'invalidated');
  assert.equal(rec.executed, false);
});
test('recommendation: no arbitrary numeric business impact', () => {
  const rec = recommendationForFinding(finding(), assess(finding()));
  assert.equal(JSON.stringify(rec).includes('recoverable_amount'), false);
  assert.equal(JSON.stringify(rec).includes('impact_score'), false);
});
test('recommendation: refund validation uses transaction date and currency', () => {
  const f = finding({ type: 'refund_increase', evidence: evidence({ source: 'order_transactions', refund_coverage_complete: true, currentRefundTotal: 400, previousRefundTotal: 200 }) });
  assert.match(recommendationForFinding(f, assess(f)).validation_method, /transaction-date attribution and currency/);
});

// Observations and periods (8).
test('observations: revenue includes actual current and comparison values', () => {
  const values = observationFor(finding());
  assert.equal(values[0].value, 650); assert.equal(values[1].value, 1000); assert.equal(values[0].currency, 'USD');
});
test('observations: refunds use refund totals not order lifetime totals', () => {
  const f = finding({ type: 'refund_increase', evidence: evidence({ currentRefundTotal: 400, previousRefundTotal: 200 }) });
  assert.equal(observationFor(f)[0].label, 'Current refund value');
});
test('observations: order volume has no currency', () => {
  const values = observationFor(finding({ type: 'order_volume_change' }));
  assert.equal(values[0].unit, 'count'); assert.equal(values[0].currency, null);
});
test('observations: returning customers expose numerator and denominator', () => {
  const values = observationFor(finding({ type: 'returning_customer_change', evidence: evidence({ currentReturning: 4, previousReturning: 8 }) }));
  assert.equal(values.length, 4); assert.equal(values[0].value, 4);
});
test('observations: integration uses actual store state', () => {
  const f = finding({ type: 'integration_failure', evidence: { status: 'connected', failed_webhook_registrations: 8 } });
  assert.equal(observationFor(f)[0].value, 'connected'); assert.equal(observationFor(f)[1].value, 8);
});
test('observations: missing money or currency is unavailable not zero', () => {
  const values = observationFor(finding({ evidence: evidence({ currentRevenue: null }) }));
  assert.equal(values[0].value, null); assert.equal(values[0].availability, 'unknown');
});
test('period: equal windows preserve all four boundaries', () => {
  const p = findingPeriod(evidence());
  assert.equal(p.kind, 'equal_length_utc_windows');
  assert.equal(p.comparison_end, '2026-11-01T00:00:00.000Z');
});
test('period: absent period remains explicitly unavailable', () => {
  const p = findingPeriod({});
  assert.equal(p.kind, 'unavailable'); assert.equal(p.start, null);
});

// Required scenarios A–H as integrated contract examples (8).
test('scenario A: verified refund deterioration is evidence-backed and actionable', () => {
  const f = finding({ type: 'refund_increase', title: 'Refund value increased 100%', evidence: evidence({ source: 'order_transactions', refund_coverage_complete: true, refund_sync_run_id: 'refund-run-1', currentRefundTotal: 400, previousRefundTotal: 200, currentCount: 4, previousCount: 2 }) });
  const result = presentPriorityFinding(candidate(f), 'org-a');
  assert.equal(result.evidence.observations[0].value, 400);
  assert.equal(result.coverage.complete, true);
  assert.match(result.recommendation.step, /refund transactions/);
  assert.doesNotMatch(result.description, /because|caused by/i);
});
test('scenario B: inventory limitation does not suppress valid order finding', () => {
  const f = finding({ evidence: evidence({ inventory_history_available: false }) });
  const result = prioritizedFindings([f], { now: NOW });
  assert.equal(result.candidates.length, 1);
  assert.ok(result.candidates[0].assessment.limitations.some(x => /Inventory history/.test(x)));
});
test('scenario C: latest sync failure turns finding historical and low confidence', () => {
  const a = assess(finding(), { availability: 'retrieval_failed', reason: 'Latest synchronization failed.' });
  assert.equal(a.eligible, false); assert.equal(a.confidence, 'low');
  assert.ok(a.limitations.some(x => /Latest synchronization failed/.test(x)));
});
test('scenario D: incomplete order coverage excludes revenue-drop priority', () => {
  const a = assess(finding({ evidence: evidence({ complete: false }) }));
  assert.equal(a.eligible, false); assert.equal(a.coverage.state, 'incomplete');
});
test('scenario E: competing findings select defensible severity and evidence', () => {
  const unsupported = finding({ id: 'critical-estimate', severity: 'critical', evidence: evidence({ verified: false, currentRevenue: 1e9 }) });
  const verified = finding({ id: 'verified', severity: 'medium' });
  assert.equal(prioritizedFindings([unsupported, verified], { now: NOW }).candidates[0].finding.id, 'verified');
});
test('scenario F: duplicate detection retains provenance and one priority card', () => {
  const a = finding({ id: 'a', dedupe_key: 'same' }), b = finding({ id: 'b', dedupe_key: 'same' });
  const result = prioritizedFindings([a, b], { now: NOW });
  assert.equal(result.candidates.length, 1); assert.equal(result.candidates[0].duplicates.length, 1);
});
test('scenario G: no eligible findings yields no top priority', () => {
  const result = prioritizedFindings([finding({ status: 'resolved' })], { now: NOW });
  assert.equal(result.candidates.length, 0); assert.equal(presentPriorityFinding(null, 'org-a'), null);
});
test('scenario H: finding invalidated before investigation is not current', () => {
  const f = finding({ status: 'invalidated', updated_at: NOW.toISOString() });
  const result = presentPriorityFinding(candidate(f), 'org-a');
  assert.equal(result.lifecycle.current_validity, 'historical_invalidated');
  assert.equal(result.recommendation.available, false);
  assert.equal(result.investigation.revalidate_on_open, true);
});
test('dedupe: invalid duplicate cannot displace eligible representative', () => {
  const invalid = finding({ id: 'invalid', dedupe_key: 'same', updated_at: NOW.toISOString(), evidence: evidence({ verified: false }) });
  const valid = finding({ id: 'valid', dedupe_key: 'same', updated_at: '2026-11-08T10:00:00Z' });
  const result = prioritizedFindings([invalid, valid], { now: NOW });
  assert.deepEqual(result.candidates.map(item => item.finding.id), ['valid']);
  assert.equal(result.excluded[0].finding_id, 'invalid');
});
