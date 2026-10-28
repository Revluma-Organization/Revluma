'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { presentFinding, presentFindings } = require('../services/mvpFindingPresentation');
const base = { id: 'finding-1', type: 'revenue_change', severity: 'high', evidence: { verified: true, complete: true, delta_pct: -35 }, action: { label: 'Investigate orders', route: '/dashboard/analytics' } };
test('verified revenue movement is prioritized without invented loss or root cause', () => {
  const item = presentFinding(base);
  assert.equal(item.mvp_assessment.priority, 'high');
  assert.equal(item.mvp_assessment.confidence, 'verified_comparison');
  assert.equal(item.mvp_assessment.estimated_recoverable_revenue, null);
  assert.match(item.mvp_assessment.explanation, /does not establish the cause/);
  assert.equal(item.mvp_assessment.measurement.metric, 'revenue_by_comparable_period');
  assert.deepEqual(item.mvp_assessment.recommended_action, base.action);
});
test('unverified evidence never receives a confident priority', () => {
  const item = presentFinding({ ...base, evidence: { verified: false } });
  assert.equal(item.mvp_assessment.priority, 'unverified');
  assert.equal(item.mvp_assessment.confidence, 'insufficient_evidence');
});
test('failed integration outranks medium business finding', () => {
  const items = presentFindings([
    { ...base, severity: 'medium' },
    { ...base, id: 'finding-2', type: 'integration_failure', severity: 'low' },
  ]);
  assert.equal(items[0].id, 'finding-2');
  assert.equal(items[0].mvp_assessment.measurement.metric, 'successful_store_sync');
});
test('invalid severity does not elevate a finding', () => {
  assert.equal(presentFinding({ ...base, severity: 'unexpected' }).mvp_assessment.priority, 'low');
});
