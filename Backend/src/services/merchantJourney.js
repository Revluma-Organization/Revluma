'use strict';

// Task 225 — read-only projection of Task 213's canonical integration truth.
// This service never persists browser flags, estimates progress, or treats an
// OAuth callback as synchronization/readiness. Command Center independently
// revalidates evidence; this contract only selects the next safe destination.
const CONTRACT_VERSION = 'rev-merchant-journey-v1';
const REQUIRED_DOMAINS = ['products', 'orders', 'abandoned_checkouts'];
const STATES = Object.freeze([
  'unauthenticated', 'authenticated_setup_required', 'shopify_authorization_pending',
  'shopify_authorized', 'initial_sync_running', 'initial_sync_partial',
  'initial_sync_failed', 'capability_limited', 'briefing_ready',
  'insufficient_history', 'returning_merchant', 'authorization_required',
  'workspace_recovery_required',
]);
const COPY = Object.freeze({
  authenticated_setup_required: ['Connect your Shopify store', 'Authorize read-only Shopify access to start gathering your store evidence.'],
  shopify_authorization_pending: ['Finish Shopify authorization', 'Your installation is not verified yet. Return to Shopify or restart authorization safely.'],
  shopify_authorized: ['Shopify access is authorized', 'Authorization succeeded. Initial data retrieval has not completed; this is not briefing readiness.'],
  initial_sync_running: ['Your initial synchronization is running', 'Revluma is retrieving store evidence. No completion time or percentage is estimated.'],
  initial_sync_partial: ['Some store evidence is available', 'You can review available evidence while unavailable resources and their limits remain visible.'],
  initial_sync_failed: ['Initial synchronization needs attention', 'Authorization may be valid, but Revluma could not retrieve enough evidence. Review the integration diagnostics.'],
  capability_limited: ['Your workspace is available with limitations', 'Review the briefing for verified evidence and explicit coverage gaps. Limited evidence is not a clean bill of health.'],
  briefing_ready: ['Your first briefing is ready', 'Open Command Center to review the current operational evidence and any supported next step.'],
  insufficient_history: ['Your available briefing has limited history', 'Revluma can show current verified observations, but historical comparisons and conclusions remain limited.'],
  returning_merchant: ['Welcome back', 'Your existing store evidence is available. Open Command Center for a fresh, server-verified briefing.'],
  authorization_required: ['Shopify authorization is required again', 'Reconnect Shopify to restore access. Synchronization or briefing readiness is not claimed.'],
  workspace_recovery_required: ['Workspace status needs verification', 'The saved integration state is unavailable or contradictory. Review diagnostics; no setup completion is assumed.'],
});
const AUTH_FAILURES = new Set(['authorization_required', 'authorization_expired', 'authorization_revoked']);

function validState(state) {
  return state && state.contract_version === 'rev-integration-state-v1' &&
    typeof state.organization_id === 'string' && state.organization_id &&
    state.store && typeof state.store.id === 'string' && state.store.id &&
    state.store.provider === 'shopify' && typeof state.store.shop_domain === 'string' &&
    state.authorization && state.synchronization && Array.isArray(state.capabilities);
}

function projectJourneyState(state, now = new Date()) {
  if (!validState(state)) {
    return { state: 'workspace_recovery_required', reason: 'integration_state_unavailable', store: null,
      explanation: COPY.workspace_recovery_required[1], title: COPY.workspace_recovery_required[0],
      next_route: '/dashboard/integrations', can_enter_workspace: false, required_resources: [] };
  }
  const sync = state.synchronization;
  const domains = sync.domains || {};
  const required = REQUIRED_DOMAINS.map(resource => ({ resource,
    state: domains[resource]?.state || 'unknown',
    last_succeeded_at: domains[resource]?.last_succeeded_at || null,
    pagination_complete: domains[resource]?.pagination_complete === true,
  }));
  const requiredReady = required.every(item => item.state === 'succeeded');
  const anyEvidence = required.some(item => item.state === 'succeeded' || item.state === 'partial');
  const limited = state.capabilities.filter(cap => Array.isArray(cap.limited_reasons) && cap.limited_reasons.length)
    .map(cap => ({ id: String(cap.id), reasons: cap.limited_reasons.map(String) }));
  let journey;
  let reason = state.status_reason || 'canonical_integration_state';
  if (AUTH_FAILURES.has(state.overall_status) || state.authorization.valid === false &&
      ['failed_by_latest_evidence', 'recorded_revoked', 'recorded_disconnected'].includes(state.authorization.verification)) {
    journey = 'authorization_required';
  } else if (['install_in_progress', 'no_credentials_recorded'].includes(state.authorization.verification)) {
    journey = 'shopify_authorization_pending';
  } else if (['running', 'queued', 'waiting_retrying', 'scheduled'].includes(sync.state)) {
    journey = 'initial_sync_running';
  } else if (['failed', 'stalled', 'cancelled'].includes(sync.state) && !anyEvidence) {
    journey = 'initial_sync_failed';
  } else if (!anyEvidence && sync.state === 'unknown' &&
      ['granted_unverified', 'verified_by_successful_synchronization'].includes(state.authorization.verification)) {
    journey = 'shopify_authorized';
  } else if (state.overall_status === 'unknown' || state.overall_status === 'needs_attention' && !anyEvidence) {
    journey = 'workspace_recovery_required';
  } else if (!requiredReady) {
    journey = anyEvidence || sync.state === 'partially_completed' ? 'initial_sync_partial' : 'shopify_authorized';
    if (journey === 'shopify_authorized' && state.authorization.verified !== true) journey = 'workspace_recovery_required';
  } else if (state.coverage?.status && state.coverage.status !== 'complete') {
    journey = 'insufficient_history'; reason = 'certified_history_incomplete';
  } else if (limited.length || state.overall_status !== 'connected') {
    journey = 'capability_limited';
  } else {
    const installed = Date.parse(state.store.installed_at || '');
    journey = Number.isFinite(installed) && now.getTime() - installed > 24 * 3600 * 1000
      ? 'returning_merchant' : 'briefing_ready';
  }
  const [title, explanation] = COPY[journey];
  return { state: journey, reason, store: { id: state.store.id, shop_domain: state.store.shop_domain },
    title, explanation, next_route: ['/dashboard/integrations'].includes(state.next_route) ? state.next_route :
      ['authenticated_setup_required', 'shopify_authorization_pending', 'shopify_authorized', 'initial_sync_running', 'initial_sync_failed', 'authorization_required', 'workspace_recovery_required'].includes(journey)
        ? '/dashboard/integrations' : '/dashboard/overview',
    can_enter_workspace: ['initial_sync_partial', 'capability_limited', 'briefing_ready', 'insufficient_history', 'returning_merchant'].includes(journey),
    required_resources: required, limited_capabilities: limited, authorization: {
      verified: state.authorization.verified === true, verification: state.authorization.verification,
    }, synchronization: { state: sync.state, last_succeeded_at: sync.last_succeeded_at || null } };
}

function validateJourney(journey) {
  const problems = [];
  if (!journey || journey.contract_version !== CONTRACT_VERSION) problems.push('invalid contract_version');
  if (!journey || !STATES.includes(journey.selected?.state)) problems.push('invalid state');
  if (!journey || typeof journey.organization_id !== 'string' || !journey.organization_id) problems.push('invalid organization');
  if (!journey || !Array.isArray(journey.stores)) problems.push('invalid stores');
  if (journey?.selected && !['', '/dashboard/integrations', '/dashboard/overview'].includes(journey.selected.next_route)) problems.push('unsafe route');
  return { valid: problems.length === 0, problems };
}

module.exports = { CONTRACT_VERSION, STATES, REQUIRED_DOMAINS, projectJourneyState, validateJourney };
