'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateQuestionOrchestration } = require('../revQuestionOrchestration');

const ORG = '11111111-1111-1111-1111-111111111111';
const understanding = () => ({
  contract_version: 'rev-question-understanding-v1', primary_intent: 'revenue_investigation',
  primary_domain: 'revenue', secondary_intents: ['checkout_investigation'],
  candidate_intents: ['revenue_investigation', 'checkout_investigation'], confidence: 0.96,
  classification_certainty: 'resolved', required_domains: ['revenue', 'checkout'],
  missing_information: [], clarification_required: false, partial_answer_allowed: true,
  context_used: { followup: false },
});
const plan = () => ({
  contract_version: 'rev-question-orchestration-v1', investigation_id: 'investigation-1',
  request_fingerprint: 'a'.repeat(64), tenant: { organization_id: ORG, store_ids: ['store-a'] },
  period: { start: '2026-11-01', end: '2026-11-07' }, question: 'Revenue and checkout',
  question_understanding: understanding(), required_domains: ['revenue', 'checkout'],
  tools: ['store_health', 'integration_health', 'revenue_observations', 'checkout_observations'],
  tasks: [
    { task_id: '1', domain: 'revenue', specialist: 'revenue', dependencies: ['integration'], attempts: 1 },
    { task_id: '2', domain: 'checkout', specialist: null, dependencies: ['integration'], attempts: 1 },
  ],
  selected_specialists: ['revenue'], excluded_specialists: [], max_specialist_fanout: 3,
  per_specialist_timeout_ms: 5000, overall_deadline_ms: 12000, max_transient_retries: 1,
  max_recursion_depth: 0, recursion_depth: 0, shared_evidence: true, parallel_analysis: true,
  state: 'completed', state_history: [{ state: 'received' }, { state: 'completed' }],
  reconciliation: { shared_evidence_ids: ['ev-1'], duplicate_fact_count: 0,
    contradictions: [{ status: 'unresolved', evidence_references: ['ev-1'] }],
    relationships: [], unresolved: [], hypotheses_promoted_to_facts: 0 },
  execution_records: [], warnings: [],
});

test('valid multi-domain question plan passes independent validation', () => {
  assert.deepEqual(validateQuestionOrchestration(plan(), { organizationId: ORG, evidenceIds: new Set(['ev-1']) }), []);
});

test('foreign tenant, evidence, recursion and excess fanout fail closed', () => {
  const value = plan(); value.tenant.organization_id = 'foreign'; value.recursion_depth = 1;
  value.selected_specialists = ['revenue', 'retention', 'operational', 'revenue'];
  value.reconciliation.contradictions[0].evidence_references = ['foreign'];
  const errors = validateQuestionOrchestration(value, { organizationId: ORG, evidenceIds: new Set() });
  for (const code of ['orchestration_tenant', 'orchestration_recursion', 'orchestration_fanout', 'orchestration_evidence_reference']) assert.ok(errors.includes(code));
});

test('invented domains, capabilities and self dependencies are rejected', () => {
  const value = plan(); value.question_understanding.required_domains = ['made_up'];
  value.tasks[0].specialist = 'invented'; value.tasks[0].dependencies = ['revenue'];
  const errors = validateQuestionOrchestration(value, { organizationId: ORG, evidenceIds: new Set(['ev-1']) });
  assert.ok(errors.includes('question_domains') && errors.includes('orchestration_capability') && errors.includes('orchestration_dependency'));
});

test('retry budgets, confidence and terminal states are bounded', () => {
  const value = plan(); value.tasks[0].attempts = 3; value.question_understanding.confidence = 2; value.state = 'almost_done';
  const errors = validateQuestionOrchestration(value, { organizationId: ORG, evidenceIds: new Set(['ev-1']) });
  assert.ok(errors.includes('orchestration_retry_budget') && errors.includes('question_confidence') && errors.includes('orchestration_state'));
});

test('hypothesis promotion and secrets never pass the boundary', () => {
  const value = plan(); value.reconciliation.hypotheses_promoted_to_facts = 1; value.execution_records.push({ access_token: 'secret' });
  const errors = validateQuestionOrchestration(value, { organizationId: ORG, evidenceIds: new Set(['ev-1']) });
  assert.ok(errors.includes('orchestration_epistemics') && errors.includes('orchestration_sensitive_field'));
});
