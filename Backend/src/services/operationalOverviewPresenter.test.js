'use strict';
const assert = require('node:assert/strict');
const { buildOperationalOverview } = require('./operationalOverviewPresenter');
const row = buildOperationalOverview({
  workflows: [{ id: 'workflow-1', name: 'Recovery', status: 'active' }],
  executions: [{ id: 'execution-1', status: 'queued' }, { id: 'execution-2', status: 'delivered' }, { id: 'execution-3', status: 'failed' }],
  alerts: [{ id: 'alert-1', message: 'Provider error' }],
  recovery: [{ status: 'recovered', _count: { _all: 4 } }],
  storeCount: 1,
});
assert.equal(row.scope.stores, 1);
assert.equal(row.workflows[0].controls.pause, false);
assert.equal(row.workflows[0].controls.resume, false);
assert.equal(row.workflows[0].controls.investigate, false);
assert.equal(row.workflows[0].controls.review_settings, true);
assert.equal(row.executions.pending_count, 1);
assert.equal(row.executions.completed_count, 1);
assert.equal(row.executions.failed_count, 1);
assert.equal(row.executions.counts_are_windowed, true);
assert.deepEqual(row.recovery, [{ status: 'recovered', count: 4 }]);
assert.equal(row.alerts.length, 1);
assert.deepEqual(row.campaigns.available_actions, []);
assert.equal(row.controls_verified, false);
console.log('operationalOverviewPresenter tests passed');
