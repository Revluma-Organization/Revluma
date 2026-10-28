'use strict';
const { summarizeExecutions } = require('./operationalExecutionSummary');
function buildOperationalOverview({ workflows, executions, alerts, recovery, storeCount }) {
  return {
    observed_at: new Date().toISOString(),
    scope: { stores: storeCount, execution_window: 'latest 60 records', workflows_window: 'latest 30 records' },
    workflows: workflows.map(row => ({ ...row, controls: { pause: false, resume: false, investigate: false, review_settings: true } })),
    executions: { recent: executions, ...summarizeExecutions(executions), counts_are_windowed: true },
    recovery: recovery.map(row => ({ status: row.status, count: row._count._all })),
    alerts,
    campaigns: { available_actions: [], reason: 'No campaign execution actions have been verified for Command Center.' },
    controls_verified: false,
  };
}
module.exports = { buildOperationalOverview };
