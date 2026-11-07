'use strict';

// Independent Node egress enforcement. Python/model output and persisted prose
// are untrusted; citations do not make an unsupported causal/action claim safe.
const CAUSAL_STATES = new Set(['observed', 'observed_difference', 'deterministic_relationship', 'statistical_association', 'hypothesis', 'verified_causal', 'unknown']);
const ACTION_STATES = new Set(['recommended', 'presented_to_merchant', 'merchant_confirmed', 'independently_verified', 'execution_requested', 'executing', 'executed', 'execution_failed', 'dismissed', 'superseded']);
const FINANCIAL_INTERPRETATIONS = new Set(['recorded_observed', 'recorded_aggregate', 'observed_difference', 'estimated_opportunity', 'recoverable', 'verified_recovered']);
const ELIGIBLE_INTERPRETATIONS = new Set(['recorded_observed', 'recorded_aggregate', 'observed_difference']);
const FINANCIAL_WORDS = /\b(?:lost|losing|loss(?:es)?|recover(?:s|ed|able|y)?|recoup(?:ed)?|saved|preventable|guarantee(?:d|s)?|stockout\s+loss|revenue\s+leak|won\s+back)\b/i;
const FINANCIAL_NEGATION = /\b(?:not|no|cannot|can't|unknown|unverified|without|doesn't|does\s+not|isn't|is\s+not|aren't|are\s+not|never)\b/i;
const CAUSAL_WORDS = /\b(?:caused|causes|causing|because\s+of|due\s+to|resulted\s+in|led\s+to|drove|driven\s+by|attributable\s+to|attributed\s+to|responsible\s+for|proved|proves|confirmed\s+that)\b/i;
const CAUSAL_NEGATION = /\b(?:not\s+(?:establish|established|prove|proven|confirm|confirmed|known)|no\s+(?:causal\s+)?evidence|cause\s+is\s+unknown|causes\s+are\s+not|does\s+not\s+establish|cannot\s+establish|can't\s+establish|unknown\s+cause)\b/i;
const ACTION_NEGATION = /(?:\bnothing\s*$|\bnothing\s+(?:has|have)|\bno\s+change\s+(?:has|have)|\b(?:has|have)\s+not\s+been|\bdid\s+not|\bcannot|\bcan't)/i;
const ACTION_WORDS = /\b(?:(?:(?:i|we|revluma|rev)\s+|i['’]ve\s+|we['’]ve\s+)(?:(?:have|has)\s+)?(?:(?:successfully|already)\s+)?(?:fixed|updated|changed|executed|completed|applied|refunded|cancelled|canceled|sent|launched|created|recovered)|(?:successfully|already)\s+(?:fixed|updated|changed|executed|completed|applied|recovered)|(?:has|have)\s+been\s+(?:fixed|updated|changed|executed|completed|applied|recovered)|(?:issue|problem)\s+is\s+(?:fixed|resolved)|(?:product|price|prices|settings|discount|order|inventory)\s+(?:was|were)\s+(?:fixed|updated|changed|executed|applied))\b/i;
const METRIC_TERMS = [
  [['revenue', 'sales', 'order_value'], ['revenue', 'sales', 'order_value']],
  [['order'], ['order']],
  [['inventory', 'stock', 'units'], ['inventory', 'stock', 'units']],
  [['checkout', 'payment'], ['checkout', 'payment']],
  [['traffic', 'session'], ['traffic', 'session']],
  [['conversion'], ['conversion']],
];

function sentences(text) {
  return String(text || '').split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

function narrativeGuardrailErrors(text) {
  const errors = [];
  for (const sentence of sentences(text)) {
    const causal = CAUSAL_WORDS.exec(sentence);
    if (causal) {
      const prefix = sentence.slice(0, causal.index);
      const suffix = sentence.slice(causal.index + causal[0].length);
      const qualified = CAUSAL_NEGATION.test(prefix) || /^\s+are\s+not\s+(?:established|known|verified)/i.test(suffix);
      if (!qualified) errors.push('unsupported_causal_language');
    }
    const financial = FINANCIAL_WORDS.exec(sentence);
    if (financial && !FINANCIAL_NEGATION.test(sentence.slice(0, financial.index))) errors.push('unsupported_financial_impact_language');
    const action = ACTION_WORDS.exec(sentence);
    if (action && !ACTION_NEGATION.test(sentence.slice(0, action.index))) errors.push('generated_action_or_outcome_claim');
  }
  return [...new Set(errors)];
}

function financialEvidenceErrors(item) {
  const interpretation = item?.measurement?.interpretation;
  if (!FINANCIAL_INTERPRETATIONS.has(interpretation) || ELIGIBLE_INTERPRETATIONS.has(interpretation)) return [];
  const impact = item.financial_impact;
  if (!impact || typeof impact !== 'object' || Array.isArray(impact)) return ['financial_impact_record_required'];
  const errors = [];
  for (const field of ['methodology_id', 'methodology_version', 'inputs', 'coverage', 'assumptions', 'limitations']) {
    const value = impact[field];
    if (value == null || value === '' || (Array.isArray(value) && !value.length) || (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length)) errors.push(`financial_impact_${field}_required`);
  }
  if (impact.eligible !== true) errors.push('financial_impact_not_eligible');
  if (impact.independent_attribution_verified !== true) errors.push('financial_impact_attribution_unverified');
  return [...new Set(errors)];
}

function relevant(claim, item) {
  const eligibleStatus = ['available', 'verified_zero'].includes(item.status) || (item.status === 'partial' && claim.status === 'partial');
  if (item.quality_eligible === false || !eligibleStatus) return false;
  const currentReference = (claim.value && typeof claim.value === 'object' && item.id === claim.value.current_evidence_id) ||
    (claim.calculation?.inputs || []).some((entry) => entry?.role === 'current' && entry?.evidence_id === item.id);
  if (claim.period && item.period && JSON.stringify(claim.period) !== JSON.stringify(item.period) && !currentReference) return false;
  if (claim.currency && item.currency && claim.currency !== item.currency) return false;
  const text = String(claim.text || claim.statement || '').toLowerCase();
  const metric = String(item.metric || '').toLowerCase();
  if (claim.metric) return String(claim.metric).toLowerCase() === metric;
  for (const [textTerms, metricTerms] of METRIC_TERMS) {
    if (textTerms.some((term) => new RegExp(`\\b${term}\\w*\\b`, 'i').test(text))) {
      return metricTerms.some((term) => metric.includes(term));
    }
  }
  return true;
}

function causalMethodologyEligible(methodology) {
  if (!methodology || typeof methodology !== 'object' || Array.isArray(methodology)) return false;
  const allowed = new Set(['randomized_controlled_trial', 'difference_in_differences', 'instrumental_variable', 'regression_discontinuity']);
  return allowed.has(methodology.design) && methodology.eligible === true && methodology.independently_verified === true &&
    ['methodology_version', 'inputs', 'coverage', 'assumptions', 'limitations'].every((field) => {
      const value = methodology[field];
      return value != null && value !== '' && (!Array.isArray(value) || value.length > 0) &&
        (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 0);
    });
}

function validateActionStates(recommendations) {
  const errors = [];
  (recommendations || []).forEach((action, index) => {
    if (!ACTION_STATES.has(action.action_state)) errors.push(`recommendation_${index}_invalid_action_state`);
    if (action.action_state !== 'recommended') errors.push(`recommendation_${index}_generated_state_not_authoritative`);
    for (const field of ['execution_status', 'execution_actor', 'executed_at', 'execution_outcome', 'verified_by', 'verified_at']) {
      if (![null, undefined, 'not_requested', 'unverified'].includes(action[field])) errors.push(`recommendation_${index}_${field}_not_authoritative`);
    }
    if (action.executed !== false) errors.push(`recommendation_${index}_execution_flag_invalid`);
    if (![null, undefined, 'not_confirmed'].includes(action.merchant_confirmation)) errors.push(`recommendation_${index}_merchant_confirmation_not_authoritative`);
    if (![null, undefined, 'unverified'].includes(action.independent_verification)) errors.push(`recommendation_${index}_independent_verification_not_authoritative`);
  });
  return [...new Set(errors)];
}

function responseGuardrailErrors(payload) {
  const errors = narrativeGuardrailErrors(payload?.text);
  const evidence = payload?.evidence;
  const rawItems = Array.isArray(evidence) ? evidence : [...(evidence?.items || []), ...(evidence?.comparison_items || [])];
  const items = new Map(rawItems.filter((item) => item?.id).map((item) => [String(item.id), item]));
  const sourceReferences = [...items.values()].flatMap((item) => item.source?.references || []);
  for (const marker of String(payload?.text || '').matchAll(/\[(\d+)\]/g)) {
    const index = Number(marker[1]);
    if (index < 1 || index > sourceReferences.length || !sourceReferences[index - 1]) errors.push('unresolved_citation_reference');
  }
  for (const item of items.values()) errors.push(...financialEvidenceErrors(item));
  const claims = ['facts', 'comparison_facts', 'year_over_year_facts', 'hypotheses', 'claims'].flatMap((key) => payload?.[key] || []);
  for (const claim of claims) {
    if (claim.causal_status != null && !CAUSAL_STATES.has(claim.causal_status)) errors.push('invalid_causal_state');
    if (claim.causal_status === 'verified_causal' && !causalMethodologyEligible(claim.causal_methodology)) errors.push('verified_causal_methodology_required');
    const references = claim.evidence_ids?.length ? claim.evidence_ids : (claim.basis_evidence_ids?.length ? claim.basis_evidence_ids : (claim.hypothesis?.supports || []));
    const isUnknown = claim.classification === 'unknown';
    const isRestated = claim.restated === true;
    if (!references.length && !isUnknown && !isRestated) errors.push('material_claim_evidence_required');
    if (['lost', 'recoverable', 'saved', 'prevented', 'avoided', 'leakage'].includes(claim.financial_impact)) errors.push('canonical_financial_impact_not_eligible');
    for (const reference of (isRestated || isUnknown ? [] : references)) {
      const item = items.get(String(reference));
      if (!item) errors.push('material_claim_unknown_evidence');
      else if (item.quality_eligible === false || (!['available', 'verified_zero'].includes(item.status) && !(item.status === 'partial' && claim.status === 'partial'))) errors.push('material_claim_irrelevant_or_ineligible_evidence');
      else if (claim.status !== 'hypothesis' && claim.classification !== 'hypothesis' && !relevant(claim, item)) errors.push('material_claim_irrelevant_or_ineligible_evidence');
    }
    errors.push(...narrativeGuardrailErrors(claim.text || claim.statement));
  }
  errors.push(...validateActionStates(payload?.recommendations));
  return [...new Set(errors)];
}

function assertResponseGuardrails(payload) {
  const errors = responseGuardrailErrors(payload);
  if (errors.length) {
    const error = new Error(`Rev response failed safety validation: ${errors.join(', ')}`);
    error.code = 'UNSAFE_ADVISOR_RESPONSE';
    error.guardrailErrors = errors;
    throw error;
  }
  return payload;
}

function safePersistedNarrative(content) {
  if (typeof content !== 'string' || !narrativeGuardrailErrors(content).length) return content;
  return 'This earlier generated statement was suppressed because its causal, financial-impact, or action claim was not independently supported. Rev is read-only; please request a fresh evidence-based answer.';
}

module.exports = {
  ACTION_STATES, CAUSAL_STATES, narrativeGuardrailErrors, financialEvidenceErrors,
  validateActionStates, responseGuardrailErrors, assertResponseGuardrails,
  safePersistedNarrative,
};
