'use strict';

const { REQUIRED_INITIAL_RESOURCES } = require('./integrationDiagnostics');

function buildRecoveryPlan(store, rows = [], now = Date.now()) {
  if (store.current_sync_job_id && store.initial_sync_status === 'running' && store.sync_started_at && now - new Date(store.sync_started_at).getTime() < 20 * 60 * 1000) {
    return { action: 'none', reason: 'job_already_running', jobId: store.current_sync_job_id, resources: [] };
  }
  const byDomain = new Map(rows.map(row => [row.domain, row]));
  const resources = REQUIRED_INITIAL_RESOURCES.map(domain => {
    const row = byDomain.get(domain);
    if (!row || row.status === 'never_run') return { resource: domain, action: 'initial', checkpoint: false };
    if (row.status === 'running') return { resource: domain, action: 'revalidate', checkpoint: Boolean(row.checkpoint && Object.keys(row.checkpoint).length) };
    if (row.status === 'failed') return { resource: domain, action: 'retry', checkpoint: Boolean(row.checkpoint && Object.keys(row.checkpoint).length), retryEligible: !/NOT_GRANTED|ACCESS_DENIED|UNSUPPORTED/.test(String(row.error_code || '')) };
    if (row.status === 'degraded') return { resource: domain, action: 'revalidate', checkpoint: Boolean(row.checkpoint && Object.keys(row.checkpoint).length) };
    return { resource: domain, action: 'none', checkpoint: false };
  });
  return {
    action: resources.some(item => item.action !== 'none') ? 'resume' : 'none',
    reason: resources.some(item => item.action !== 'none') ? 'resource_recovery_required' : 'required_resources_current',
    jobId: null,
    resources,
    preserveExistingData: true,
  };
}

module.exports = { buildRecoveryPlan };
