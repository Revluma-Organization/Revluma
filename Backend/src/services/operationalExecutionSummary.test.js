'use strict';
const assert = require('node:assert/strict');
const { summarizeExecutions } = require('./operationalExecutionSummary');
assert.deepEqual(summarizeExecutions([]), { pending_count: 0, completed_count: 0, failed_count: 0, other_count: 0 });
assert.deepEqual(summarizeExecutions([
  { status: 'queued' }, { status: 'pending' }, { status: 'processing' },
  { status: 'sent' }, { status: 'delivered' }, { status: 'completed' },
  { status: 'failed' }, { status: 'bounced' }, { status: 'rejected' },
  { status: 'unknown' }, { status: null },
]), { pending_count: 3, completed_count: 3, failed_count: 3, other_count: 2 });
assert.equal(summarizeExecutions([{ status: 'delivered' }]).completed_count, 1);
assert.equal(summarizeExecutions([{ status: 'failed' }]).failed_count, 1);
console.log('operationalExecutionSummary tests passed');
