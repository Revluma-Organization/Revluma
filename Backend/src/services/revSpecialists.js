'use strict';

// Task 208 — independent production boundary for specialist executions.
const CONTRACT_VERSION = 'rev-specialist-execution-v1';
const NAMES = Object.freeze(['revenue', 'retention', 'operational']);
const STAGES = Object.freeze([
  'request_received', 'intent_domain_validated', 'specialist_selected',
  'required_capabilities_determined', 'evidence_requirements_identified',
  'evidence_retrieved_authorized', 'evidence_quality_evaluated',
  'domain_analysis_performed', 'calculations_validated',
  'findings_recommendations_generated', 'epistemic_classifications_validated',
  'evidence_references_validated', 'specialist_result_returned',
  'conversation_context_incorporated',
]);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function validateSpecialistExecution(value, { organizationId = null, evidenceIds = new Set() } = {}) {
  const errors = [];
  if (!object(value)) return ['specialist_not_object'];
  if (value.contract_version !== CONTRACT_VERSION) errors.push('specialist_contract_version');
  if (!object(value.specialist) || !NAMES.includes(value.specialist.name) || typeof value.specialist.version !== 'string') errors.push('specialist_identity');
  if (typeof value.execution_id !== 'string' || !value.execution_id) errors.push('specialist_execution_identity');
  if (!object(value.tenant) || value.tenant.organization_id !== organizationId) errors.push('specialist_tenant');
  if (!Array.isArray(value.tenant?.store_ids)) errors.push('specialist_store_scope');
  if (!['success', 'partial', 'no_data', 'error'].includes(value.status)) errors.push('specialist_status');
  if (['success', 'partial'].includes(value.status) && !(value.verified_facts?.length || value.calculated_findings?.length)) errors.push('specialist_empty_success');
  if (!Array.isArray(value.lifecycle) || value.lifecycle.length !== STAGES.length
      || value.lifecycle.some((stage, index) => stage.stage !== STAGES[index])) errors.push('specialist_lifecycle');
  const refs = [...(value.evidence_references || [])];
  for (const collection of ['verified_facts', 'calculated_findings']) {
    if (!Array.isArray(value[collection])) errors.push('specialist_fact_collection');
    for (const fact of value[collection] || []) {
      if (!['verified_fact', 'calculated_observation'].includes(fact.epistemic_grade)) errors.push('specialist_epistemics');
      refs.push(...(fact.evidence_references || []));
    }
  }
  if (refs.some(ref => !evidenceIds.has(ref))) errors.push('specialist_evidence_reference');
  for (const hypothesis of value.hypotheses || []) {
    if (hypothesis.verified !== false || hypothesis.causal_status !== 'hypothesis') errors.push('specialist_hypothesis');
    if ((hypothesis.evidence_references || []).some(ref => !evidenceIds.has(ref))) errors.push('specialist_hypothesis_reference');
  }
  for (const rec of value.recommendations || []) {
    if (rec.executed !== false || rec.read_only !== true || rec.state !== 'recommended') errors.push('specialist_action_state');
    if ((rec.evidence_ids || []).some(ref => !evidenceIds.has(ref))) errors.push('specialist_recommendation_reference');
  }
  const forbidden = /^(?:email|phone|address|access_token|database_url|connection_string|traceback|stack)$/i;
  const walk = (entry, depth = 0) => {
    if (depth > 10) { errors.push('specialist_sensitive_field'); return; }
    if (Array.isArray(entry)) { for (const child of entry) walk(child, depth + 1); return; }
    if (!object(entry)) return;
    for (const [key, child] of Object.entries(entry)) {
      if (forbidden.test(key)) errors.push('specialist_sensitive_field');
      walk(child, depth + 1);
    }
  };
  walk(value);
  return [...new Set(errors)].sort();
}

module.exports = { CONTRACT_VERSION, NAMES, STAGES, validateSpecialistExecution };
