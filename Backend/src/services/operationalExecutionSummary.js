'use strict';

// Counts describe observed message-send records, never business outcomes or recovered revenue.
const PENDING = new Set(['queued', 'pending', 'scheduled', 'processing']);
const COMPLETED = new Set(['sent', 'delivered', 'completed', 'success']);
const FAILED = new Set(['failed', 'bounced', 'rejected']);
function summarizeExecutions(records) {
  const result = { pending_count: 0, completed_count: 0, failed_count: 0, other_count: 0 };
  for (const row of records) {
    const status = String(row.status || '').toLowerCase();
    if (PENDING.has(status)) result.pending_count++;
    else if (COMPLETED.has(status)) result.completed_count++;
    else if (FAILED.has(status)) result.failed_count++;
    else result.other_count++;
  }
  return result;
}
module.exports = { summarizeExecutions };
