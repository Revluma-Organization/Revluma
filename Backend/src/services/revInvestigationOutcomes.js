'use strict';

// Task 207 — independent Node boundary validation for the canonical outcome.
// Python composes this from the existing integration/evidence contracts; Node
// never trusts its classification without checking shape, tenant and safety.
const OUTCOME_CONTRACT_VERSION = 'rev-investigation-outcome-v1';
const OUTCOMES = Object.freeze([
  'success', 'partial_success', 'insufficient_history', 'insufficient_coverage',
  'integration_disconnected', 'authorization_required', 'authorization_expired',
  'permission_insufficient', 'sync_in_progress', 'sync_stale', 'sync_failed',
  'source_unavailable', 'retrieval_failed', 'unsupported_capability',
  'unsupported_question', 'ambiguous_question', 'invalid_request', 'internal_error',
]);

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

function validateInvestigationOutcome(value, organizationId = null) {
  const errors = [];
  if (!object(value)) return ['outcome_not_object'];
  if (value.contract_version !== OUTCOME_CONTRACT_VERSION) errors.push('outcome_contract_version');
  if (!OUTCOMES.includes(value.outcome)) errors.push('outcome_classification');
  if (!object(value.tenant) || typeof value.tenant.organization_id !== 'string') errors.push('outcome_tenant');
  if (organizationId && value.tenant?.organization_id !== organizationId) errors.push('outcome_tenant_mismatch');
  if (value.tenant && !Array.isArray(value.tenant.store_ids)) errors.push('outcome_store_scope');
  for (const key of ['required_domains', 'available_domains', 'unavailable_domains']) {
    if (!Array.isArray(value[key])) errors.push(`outcome_${key}`);
  }
  if (!object(value.answerability) || !Array.isArray(value.answerability.can_answer)
      || !Array.isArray(value.answerability.cannot_establish)) errors.push('outcome_answerability');
  if (!object(value.retry) || typeof value.retry.eligible !== 'boolean') errors.push('outcome_retry');
  if (!object(value.history) || !object(value.coverage)) errors.push('outcome_history_coverage');
  if (typeof value.diagnostic_reference !== 'string' || !/^REV-[A-F0-9]{16}$/.test(value.diagnostic_reference)) {
    errors.push('outcome_diagnostic_reference');
  }
  for (const forbidden of ['stack', 'traceback', 'access_token', 'database_url', 'connection_string']) {
    if (Object.prototype.hasOwnProperty.call(value, forbidden)) errors.push('outcome_sensitive_field');
  }
  return [...new Set(errors)].sort();
}

function retryabilityForError(code) {
  // Authentication, validation, authorization and invalid upstream contracts
  // are permanent until configuration/access changes. Only transient service
  // transport failures may be retried as the same investigation.
  return ['INTELLIGENCE_TIMEOUT', 'INTELLIGENCE_UNAVAILABLE'].includes(code);
}

function investigationOutcomeFromTransportError({ code, investigationId = null, organizationId = null }) {
  const retryEligible = retryabilityForError(code);
  return {
    contract_version: OUTCOME_CONTRACT_VERSION,
    outcome: code === 'INTELLIGENCE_INVALID_REQUEST' ? 'invalid_request'
      : code === 'INTELLIGENCE_AUTH_FAILED' ? 'authorization_required'
        : code === 'INTELLIGENCE_INVALID_RESPONSE' ? 'internal_error' : 'source_unavailable',
    investigation_id: investigationId,
    tenant: organizationId ? { organization_id: organizationId, store_ids: [] } : null,
    retry: { eligible: retryEligible, status: 'not_requested', starts_sync: false },
    error_code: code,
  };
}

module.exports = {
  OUTCOME_CONTRACT_VERSION, OUTCOMES, validateInvestigationOutcome,
  retryabilityForError, investigationOutcomeFromTransportError,
};
