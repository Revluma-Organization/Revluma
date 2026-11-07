'use strict';

// Task 209 — independent Node boundary for canonical question orchestration.
const CONTRACT_VERSION = 'rev-question-orchestration-v1';
const QUESTION_CONTRACT_VERSION = 'rev-question-understanding-v1';
const STATES = new Set(['received', 'understanding', 'planning', 'executing', 'reconciling',
  'composing', 'validating', 'completed', 'partial_success', 'needs_clarification',
  'unsupported', 'failed', 'cancelled']);
const DOMAINS = new Set(['revenue', 'checkout', 'integration', 'operational', 'retention']);
const SPECIALISTS = new Set(['revenue', 'retention', 'operational']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function validateQuestionUnderstanding(value) {
  const errors = [];
  if (!object(value)) return ['question_understanding_not_object'];
  if (value.contract_version !== QUESTION_CONTRACT_VERSION) errors.push('question_understanding_contract');
  if (typeof value.primary_intent !== 'string' || !value.primary_intent) errors.push('question_primary_intent');
  if (!Array.isArray(value.secondary_intents) || !Array.isArray(value.candidate_intents)) errors.push('question_secondary_intents');
  if (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) errors.push('question_confidence');
  if (!Array.isArray(value.required_domains) || value.required_domains.some(domain => !DOMAINS.has(domain))) errors.push('question_domains');
  if (typeof value.clarification_required !== 'boolean' || typeof value.partial_answer_allowed !== 'boolean') errors.push('question_answerability');
  if (!Array.isArray(value.missing_information) || !object(value.context_used)) errors.push('question_context');
  return errors;
}

function validateQuestionOrchestration(value, { organizationId = null, evidenceIds = new Set() } = {}) {
  const errors = validateQuestionUnderstanding(value?.question_understanding);
  if (!object(value)) return ['orchestration_not_object'];
  if (value.contract_version !== CONTRACT_VERSION) errors.push('orchestration_contract');
  if (!STATES.has(value.state)) errors.push('orchestration_state');
  if (!object(value.tenant) || value.tenant.organization_id !== organizationId || !Array.isArray(value.tenant.store_ids)) errors.push('orchestration_tenant');
  if (typeof value.request_fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.request_fingerprint)) errors.push('orchestration_idempotency');
  if (!Array.isArray(value.state_history) || value.state_history.some(entry => !STATES.has(entry?.state))) errors.push('orchestration_state_history');
  if (value.recursion_depth !== 0 || value.max_recursion_depth !== 0) errors.push('orchestration_recursion');
  if (!Array.isArray(value.selected_specialists) || value.selected_specialists.some(name => !SPECIALISTS.has(name))
      || value.selected_specialists.length > value.max_specialist_fanout || value.max_specialist_fanout > 3) errors.push('orchestration_fanout');
  if (!Number.isFinite(value.per_specialist_timeout_ms) || value.per_specialist_timeout_ms <= 0
      || !Number.isFinite(value.overall_deadline_ms) || value.overall_deadline_ms <= 0
      || !Number.isInteger(value.max_transient_retries) || value.max_transient_retries < 0 || value.max_transient_retries > 1) errors.push('orchestration_bounds');
  if (!Array.isArray(value.tasks)) errors.push('orchestration_tasks');
  for (const task of Array.isArray(value.tasks) ? value.tasks : []) {
    if (!DOMAINS.has(task.domain) || (task.specialist !== null && !SPECIALISTS.has(task.specialist))) errors.push('orchestration_capability');
    if (!Array.isArray(task.dependencies) || task.dependencies.some(domain => !DOMAINS.has(domain) || domain === task.domain)) errors.push('orchestration_dependency');
    if (!Number.isInteger(task.attempts) || task.attempts < 0 || task.attempts > value.max_transient_retries + 1) errors.push('orchestration_retry_budget');
  }
  if (!object(value.reconciliation)) errors.push('orchestration_reconciliation');
  if (!Array.isArray(value.reconciliation?.contradictions)) errors.push('orchestration_contradictions');
  for (const contradiction of Array.isArray(value.reconciliation?.contradictions) ? value.reconciliation.contradictions : []) {
    if (contradiction.status !== 'unresolved') errors.push('orchestration_contradiction_state');
    if ((contradiction.evidence_references || []).some(ref => !evidenceIds.has(ref))) errors.push('orchestration_evidence_reference');
  }
  if ((value.reconciliation?.hypotheses_promoted_to_facts || 0) !== 0) errors.push('orchestration_epistemics');
  const forbidden = /^(?:access_token|database_url|connection_string|traceback|stack|email|phone|address)$/i;
  const walk = (entry, depth = 0) => {
    if (depth > 12) { errors.push('orchestration_sensitive_field'); return; }
    if (Array.isArray(entry)) { entry.forEach(child => walk(child, depth + 1)); return; }
    if (!object(entry)) return;
    for (const [key, child] of Object.entries(entry)) {
      if (forbidden.test(key)) errors.push('orchestration_sensitive_field');
      walk(child, depth + 1);
    }
  };
  walk(value);
  return [...new Set(errors)].sort();
}

module.exports = { CONTRACT_VERSION, QUESTION_CONTRACT_VERSION, validateQuestionUnderstanding, validateQuestionOrchestration };
