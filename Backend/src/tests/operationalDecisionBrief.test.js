'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDecisionBrief, prioritizeDecisionBriefs } = require('../services/operationalDecisionBrief');
const now = '2026-10-29T12:00:00.000Z';
const evidence = {
  verified: true, complete: true, currency: 'USD', coverage_source: 'shopify_verified_orders',
  coverage_run_id: 'run-1', previousStart: '2026-10-01T00:00:00Z',
  previousEnd: '2026-10-08T00:00:00Z', currentStart: '2026-10-08T00:00:00Z',
  currentEnd: '2026-10-15T00:00:00Z', currentCount: 25, previousCount: 30,
};
const finding = {
  id: 'finding-1', organization_id: 'org-a', store_id: 'store-a', type: 'revenue_change',
  severity: 'high', title: 'Revenue declined', description: 'Recorded revenue declined.',
  detected_at: '2026-10-16T00:00:00Z', evidence,
  action: { label: 'Investigate', guidance: 'Review order volume', measurement: 'Compare equal periods' },
};
const ctx = { organizationId: 'org-a', storeIds: ['store-a'], now };
test('authorized verified finding becomes advisory-only decision brief', () => {
  const brief = buildDecisionBrief(finding, ctx);
  assert.equal(brief.evidence_class, 'verified_observation');
  assert.equal(brief.cause_status, 'not_established');
  assert.equal(brief.execution_status, 'advisory_only');
  assert.equal(brief.reporting_period.currency, 'USD');
  assert.equal(brief.suggested_action.measurement, 'Compare equal periods');
  assert.equal(brief.evidence_reference.coverage_run_id, 'run-1');
  assert.equal(brief.recoverable_revenue, undefined);
});
test('cross-tenant and unauthorized store findings are rejected', () => {
  assert.equal(buildDecisionBrief({ ...finding, organization_id: 'org-b' }, ctx), null);
  assert.equal(buildDecisionBrief({ ...finding, store_id: 'store-b' }, ctx), null);
  assert.equal(buildDecisionBrief(finding, { ...ctx, organizationId: '' }), null);
});
test('unverified, incomplete, and uncertified financial findings are rejected', () => {
  for (const bad of [{ verified: false }, { complete: false }, { coverage_run_id: '' },
    { coverage_source: '' }, { currentCount: NaN }, { currency: null },
    { currentStart: 'not-a-date' }]) {
    assert.equal(buildDecisionBrief({ ...finding, evidence: { ...evidence, ...bad } }, ctx), null);
  }
});
test('integration failure can be communicated without financial coverage', () => {
  const brief = buildDecisionBrief({ ...finding, type: 'integration_failure', evidence: { verified: true } }, ctx);
  assert.equal(brief.reporting_period, null);
  assert.equal(brief.evidence_reference, null);
});
test('old findings are labelled historical and never imply a verified cause', () => {
  const brief = buildDecisionBrief(finding, { ...ctx, now: '2026-12-01T00:00:00Z' });
  assert.equal(brief.data_freshness, 'historical');
  assert.match(brief.limitations.join(' '), /historical/);
});
test('priority ordering is deterministic and excludes unavailable briefs', () => {
  const high = buildDecisionBrief(finding, ctx);
  const medium = { ...high, finding_id: 'finding-2', priority: 'medium', priority_rank: 2 };
  assert.deepEqual(prioritizeDecisionBriefs([medium, null, high]).map(x => x.finding_id), ['finding-1', 'finding-2']);
});
