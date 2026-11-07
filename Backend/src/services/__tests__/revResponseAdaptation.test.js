'use strict';

// Task 210 — Node boundary for the adaptive answer structure and the
// evidence-derived confidence contract.
//
// Part 1 proves the JS mirror (deriveClaimConfidence / responseConfidence
// Category / classifyResponseProfile / selectElements / coverageSummary)
// returns byte-identical output to the Python keystone, pinned by the
// golden set generated from Python (scripts/gen_response_adaptation_golden
// .py). Part 2 proves the fail-closed boundary validator rejects every
// tampering shape the contract forbids and accepts a clean payload —
// including the meta follow-up restatement path.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  ADAPTATION_CONTRACT_VERSION,
  CONFIDENCE_CATEGORIES,
  deriveClaimConfidence,
  responseConfidenceCategory,
  classifyResponseProfile,
  selectElements,
  coverageSummary,
  validateResponseAdaptation,
} = require('../revResponseAdaptation');

const golden = require('./revResponseAdaptation.golden.json');

// ── fixtures (must mirror the golden generator exactly) ─────────────────────
function qsuff(sufficiency, reasons) {
  return { sufficiency, reasons, coverage: 'complete', freshness: 'fresh',
    currency_integrity: 'comparable', note: 'n' };
}
function qitem(id, quality, metric = 'net_revenue', value = '100.00') {
  return { id, metric, status: 'available', unit: 'currency', currency: 'USD',
    value, quality };
}

const ITEMS = {
  'ev-high': qitem('ev-high', qsuff('sufficient', [])),
  'ev-partial': qitem('ev-partial', qsuff('partial', ['partial_coverage'])),
  'ev-stale': qitem('ev-stale', qsuff('insufficient', ['stale_for_current_claim'])),
  'ev-conflict': qitem('ev-conflict', qsuff('partial', ['conflicting_evidence'])),
  'ev-mixed': qitem('ev-mixed', qsuff('partial', ['mixed_currencies_not_comparable'])),
  'ev-unavail': qitem('ev-unavail', qsuff('unavailable', ['source_retrieval_failed'])),
  'ev-cov-unknown': qitem('ev-cov-unknown', qsuff('partial', ['coverage_unknown'])),
  'ev-never': qitem('ev-never', qsuff('insufficient', ['never_synchronized_for_current_claim'])),
};

function claim(classification, evidenceIds = [], calculation = null,
  confidence = null, claimId = 'clm-1') {
  const c = {
    claim_id: claimId, classification,
    text: 'Revenue was NGN 1,000,000.00.',
    value: '100.00', value_kind: 'money',
    evidence_ids: [...evidenceIds],
  };
  if (calculation !== null) c.calculation = calculation;
  if (confidence !== null) c.confidence = confidence;
  return c;
}

const CLAIM_CASES = {
  verified_fact_sufficient: [
    claim('verified_fact', ['ev-high']), { 'ev-high': ITEMS['ev-high'] }],
  verified_fact_partial_coverage: [
    claim('verified_fact', ['ev-partial']), { 'ev-partial': ITEMS['ev-partial'] }],
  verified_fact_stale: [
    claim('verified_fact', ['ev-stale']), { 'ev-stale': ITEMS['ev-stale'] }],
  verified_fact_conflicting: [
    claim('verified_fact', ['ev-conflict']), { 'ev-conflict': ITEMS['ev-conflict'] }],
  verified_fact_mixed_currency: [
    claim('verified_fact', ['ev-mixed']), { 'ev-mixed': ITEMS['ev-mixed'] }],
  verified_fact_unavailable: [
    claim('verified_fact', ['ev-unavail']), { 'ev-unavail': ITEMS['ev-unavail'] }],
  verified_fact_worst_of_two: [
    claim('verified_fact', ['ev-high', 'ev-stale']),
    { 'ev-high': ITEMS['ev-high'], 'ev-stale': ITEMS['ev-stale'] }],
  verified_fact_cited_id_missing: [
    claim('verified_fact', ['ev-missing']), { 'ev-high': ITEMS['ev-high'] }],
  verified_fact_no_evidence: [
    claim('verified_fact', []), { 'ev-high': ITEMS['ev-high'] }],
  verified_fact_coverage_unknown: [
    claim('verified_fact', ['ev-cov-unknown']),
    { 'ev-cov-unknown': ITEMS['ev-cov-unknown'] }],
  calculated_observation_both_inputs: [
    claim('calculated_observation', [], { inputs: [
      { evidence_id: 'ev-high', period: 'current' },
      { evidence_id: 'ev-stale', period: 'previous' },
    ]}),
    { 'ev-high': ITEMS['ev-high'], 'ev-stale': ITEMS['ev-stale'] }],
  hypothesis_sufficient_capped: [
    claim('hypothesis', ['ev-high']), { 'ev-high': ITEMS['ev-high'] }],
  hypothesis_unavailable: [
    claim('hypothesis', ['ev-unavail']), { 'ev-unavail': ITEMS['ev-unavail'] }],
  unknown_grade: [
    claim('unknown', []), { 'ev-high': ITEMS['ev-high'] }],
  unrecognised_grade_fails_closed: [
    claim('bogus_grade', ['ev-high']), { 'ev-high': ITEMS['ev-high'] }],
};

test('method D1 claim confidence matches the Python keystone', () => {
  for (const [name, [c, items]] of Object.entries(CLAIM_CASES)) {
    assert.deepEqual(
      deriveClaimConfidence(c, items), golden.claim_confidence[name],
      `claim_confidence parity failed for ${name}`);
  }
});

// ── response-level category ──────────────────────────────────────────────────
function rec(category, grade = 'verified_fact', claimId = 'clm-x') {
  return claim(grade, [], null,
    { category, basis: [], limitations: [] }, claimId);
}

const RESPONSE_CATEGORY_CASES = {
  worst_of_answer_bearing: [
    [rec('high', 'verified_fact', 'clm-a'),
      rec('moderate', 'calculated_observation', 'clm-b'),
      rec('high', 'hypothesis', 'clm-c')], null],
  unknown_claims_do_not_drag: [
    [rec('high', 'verified_fact', 'clm-a'),
      rec('insufficient', 'unknown', 'clm-b')], null],
  claimless_with_items_uses_sufficiency: [
    [], { 'ev-partial': ITEMS['ev-partial'] }],
  claimless_with_no_items_insufficient: [[], null],
  bogus_recorded_category_ignored: [
    [rec('nonsense', 'verified_fact', 'clm-a')], { 'ev-high': ITEMS['ev-high'] }],
  claimless_all_sufficient_high: [[], { 'ev-high': ITEMS['ev-high'] }],
  claimless_worst_item_unavailable: [
    [], { 'ev-high': ITEMS['ev-high'], 'ev-unavail': ITEMS['ev-unavail'] }],
};

test('response-level category matches the Python keystone', () => {
  for (const [name, [claims, items]] of Object.entries(RESPONSE_CATEGORY_CASES)) {
    assert.equal(
      responseConfidenceCategory(claims, items),
      golden.response_category[name].expected,
      `response_category parity failed for ${name}`);
  }
});

// ── coverage representation ──────────────────────────────────────────────────
const WINDOW = { label: 'November 2026', start: '2026-11-01T00:00:00+00:00',
  end: '2026-11-07T12:00:00+00:00', timezone: 'UTC' };

function qcov(coverage, freshness, currency = 'comparable') {
  return { sufficiency: 'sufficient', reasons: [], coverage, freshness,
    currency_integrity: currency, note: 'n' };
}

const COVERAGE_CASES = {
  no_data: [[], []],
  complete_fresh: [[qitem('ev-a', qcov('complete', 'fresh'))], []],
  partial: [[qitem('ev-a', qcov('partial', 'fresh'))], []],
  stale_limits: [[qitem('ev-a', qcov('complete', 'stale'))], []],
  never_synchronized: [[qitem('ev-a', qcov('complete', 'never_synchronized'))], []],
  synchronizing: [[qitem('ev-a', qcov('complete', 'synchronizing'))], []],
  currency_mixed: [[qitem('ev-a', qcov('complete', 'fresh', 'mixed_not_comparable'))], []],
  currency_unknown: [[qitem('ev-a', qcov('complete', 'fresh', 'unknown_currency'))], []],
  certified_store: [[qitem('ev-a', qcov('complete', 'fresh'),
    'certified_store_count', 1)], []],
  comparison_window_included: [
    [qitem('ev-a', qcov('complete', 'fresh'))],
    [qitem('ev-b', qcov('partial', 'stale'))]],
  worst_freshness_wins: [
    [qitem('ev-a', qcov('complete', 'stale')),
      qitem('ev-b', qcov('complete', 'fresh'))], []],
  complete_beats_not_applicable: [
    [qitem('ev-a', qcov('complete', 'fresh')),
      qitem('ev-b', qcov('not_applicable', 'unknown'))], []],
  unknown_coverage: [
    [qitem('ev-a', qcov('partial', 'fresh')),
      qitem('ev-b', qcov('unknown', 'fresh'))], []],
};

test('coverage summary matches the Python keystone', () => {
  for (const [name, [items, comparison]] of Object.entries(COVERAGE_CASES)) {
    assert.deepEqual(
      coverageSummary(items, { window: WINDOW, comparisonItems: comparison }),
      golden.coverage[name],
      `coverage parity failed for ${name}`);
  }
});

// ── A-H profile classification ───────────────────────────────────────────────
const PROFILE_CASES = {
  a_casual_greeting: { intent: 'greeting',
    message: 'Hi, how are you today?' },
  a_casual_capability: { intent: 'capability',
    message: 'What can you help me with?' },
  b_direct_metric_query: { intent: 'revenue_investigation',
    message: 'How much did I earn this month?' },
  b_direct_count_query: { intent: 'revenue_investigation',
    message: 'How many orders did I get this week?' },
  b_direct_data_coverage: { intent: 'data_coverage',
    message: 'Are my stores connected?' },
  b_not_direct_when_causal: { intent: 'revenue_investigation',
    message: 'Why was my revenue down this month?' },
  c_explanation_single_domain: { intent: 'revenue_investigation',
    message: 'Explain why my revenue dropped last week.' },
  d_comparative: { intent: 'revenue_investigation',
    message: 'How did this month compare with last month?',
    hasComparison: true },
  d_comparative_beats_metric: { intent: 'revenue_investigation',
    message: 'How much did I earn versus last month?', hasComparison: true },
  e_investigation_default: { intent: 'checkout_investigation',
    message: 'What is going on with my checkouts this month?' },
  f_multi_domain_overview: { intent: 'store_overview',
    message: 'Give me the full picture of my store this month.' },
  f_multi_domain_by_domains: { intent: 'revenue_investigation',
    message: 'How are sales and refunds tracking this month?',
    domains: ['revenue', 'refunds'] },
  g_recommendation_finding: { intent: 'finding_investigation',
    message: 'What should I do about the dropped revenue?' },
  g_recommendation_priority: { intent: 'product_investigation',
    message: 'Which product should I fix first?', isPriorityQuestion: true },
  h_clarification_intent: { intent: 'clarify',
    message: 'Show me the numbers.' },
  h_clarification_understanding: { intent: 'revenue_investigation',
    message: 'Show me the numbers.',
    understanding: { intent: 'clarification_needed' } },
  degraded_depth_concise: { intent: 'revenue_investigation',
    message: 'How did this month compare with last month?',
    hasComparison: true, status: 'insufficient_data' },
  failed_depth_concise: { intent: 'store_overview',
    message: 'Give me the full picture of my store this month.',
    status: 'failed' },
  communication_explicit_on_insufficient: { intent: 'revenue_investigation',
    message: 'How did this month compare with last month?',
    hasComparison: true, claimCategories: ['insufficient'] },
  communication_inline_on_moderate: { intent: 'revenue_investigation',
    message: 'How did this month compare with last month?',
    hasComparison: true, claimCategories: ['moderate'] },
  communication_implicit_on_direct_high: { intent: 'revenue_investigation',
    message: 'How much did I earn this month?',
    claimCategories: ['high', 'high'] },
  communication_inline_on_comparative_high: { intent: 'revenue_investigation',
    message: 'How did this month compare with last month?',
    hasComparison: true, claimCategories: ['high'] },
  override_direct_detailed: { intent: 'general', message: 'Tell me more.',
    responseIntent: 'direct_factual', explanationDepth: 'detailed' },
};

const MIRROR_PROFILES = {};

test('A-H profile classification matches the Python keystone', () => {
  for (const [name, params] of Object.entries(PROFILE_CASES)) {
    const profile = classifyResponseProfile(params);
    MIRROR_PROFILES[name] = profile;
    assert.deepEqual(profile, golden.profiles[name],
      `profile parity failed for ${name}`);
  }
});

// ── ordered element selection ────────────────────────────────────────────────
const ELEMENT_CASES = {
  direct_minimal: ['b_direct_metric_query',
    { hasFacts: true, hasEvidence: true }],
  direct_evidence_only: ['b_direct_metric_query', { hasEvidence: true }],
  casual_empty: ['a_casual_greeting', { hasFacts: true, hasEvidence: true }],
  comparative_full: ['d_comparative',
    { hasComparison: true, hasEvidence: true, hasLimitations: true,
      hasRecommendations: true }],
  investigation_ordered_with_confidence: ['e_investigation_default',
    { hasFacts: true, hasEvidence: true, hasHypotheses: true,
      hasLimitations: true, hasRecommendations: true, hasFollowUps: true }],
  multi_domain_no_implication: ['f_multi_domain_overview',
    { hasFacts: true, hasEvidence: true, hasLimitations: true,
      hasRecommendations: true, hasFollowUps: true }],
  recommendation_leads_with_answer: ['g_recommendation_priority',
    { hasFacts: true, hasEvidence: true, hasLimitations: true,
      hasRecommendations: true, hasFollowUps: true }],
  clarification_with_next_step_degraded: ['h_clarification_understanding',
    { hasUnknowns: true,
      insufficientNextStep: 'Connect the store to see this.' }],
  degraded_lead_order_with_facts: ['d_comparative',
    { hasFacts: true, hasEvidence: true, hasLimitations: true,
      hasUnknowns: true, insufficientNextStep: 'Reconnect the data source.' }],
  recommendation_not_appropriate_omitted: ['b_direct_metric_query',
    { hasFacts: true, hasRecommendations: true }],
  explanation_full: ['c_explanation_single_domain',
    { hasFacts: true, hasEvidence: true, hasHypotheses: true,
      hasLimitations: true, hasRecommendations: true }],
};

test('ordered element selection matches the Python keystone', () => {
  for (const [name, [profileName, kwargs]] of Object.entries(ELEMENT_CASES)) {
    assert.deepEqual(
      selectElements(MIRROR_PROFILES[profileName], kwargs),
      golden.elements[name],
      `elements parity failed for ${name}`);
  }
});

// ── fail-closed boundary validation ──────────────────────────────────────────
const HIGHS_ITEM = ITEMS['ev-high'];
const GOOD_COVERAGE = coverageSummary([HIGHS_ITEM], { comparisonItems: [] });

function cleanClaim() {
  return {
    ...claim('verified_fact', ['ev-high']),
    confidence: { category: 'high', basis: [], limitations: [] },
  };
}

function cleanPayload() {
  return {
    evidence: { items: [HIGHS_ITEM], comparison_items: [] },
    claims: [cleanClaim()],
    response_profile: classifyResponseProfile({
      intent: 'revenue_investigation',
      message: 'How much did I earn this month?',
      claimCategories: ['high'],
    }),
    response: {
      confidence: {
        category: 'high',
        claims: { 'clm-1': { category: 'high', basis: [], limitations: [] } },
        coverage: GOOD_COVERAGE,
        communication: 'I’m confident in this: it comes from complete, current records for the period.',
      },
      sections: [
        { id: 'direct_answer', label: 'Answer',
          text: 'You earned NGN 1,000,000.00 in November 2026.' },
        { id: 'confidence', label: 'How confident am I',
          text: 'I’m confident in this: it comes from complete, current records for the period.' },
      ],
    },
  };
}

test('contract version and closed vocabularies are exported', () => {
  assert.equal(ADAPTATION_CONTRACT_VERSION, golden.contract_version);
  assert.deepEqual([...CONFIDENCE_CATEGORIES].sort(),
    ['high', 'insufficient', 'limited', 'moderate']);
});

test('a clean payload passes the boundary', () => {
  assert.deepEqual(validateResponseAdaptation(cleanPayload()), []);
});

test('a tampered claim confidence is rejected', () => {
  const payload = cleanPayload();
  payload.response.confidence.category = 'moderate';
  assert.ok(validateResponseAdaptation(payload)
    .includes('confidence_response_category_mismatch'));
});

test('a tampered per-claim category is rejected', () => {
  const payload = cleanPayload();
  payload.response.confidence.claims['clm-1'].category = 'moderate';
  const errors = validateResponseAdaptation(payload);
  assert.ok(errors.includes('confidence_claim_category_mismatch'),
    `expected category mismatch, got ${errors}`);
});

test('a fabricated numeric score is rejected', () => {
  const payload = cleanPayload();
  payload.response.confidence.score = 0.93;
  assert.ok(validateResponseAdaptation(payload)
    .includes('confidence_numeric_score'));
});

test('a percentage string is rejected', () => {
  const payload = cleanPayload();
  payload.response.confidence.communication = 'I am 93% confident in this.';
  assert.ok(validateResponseAdaptation(payload)
    .includes('confidence_communication_percentage'));
  const inClaim = cleanPayload();
  inClaim.claims[0].confidence.limitations =
    ['I am 80% sure about the sync.'];
  assert.ok(validateResponseAdaptation(inClaim)
    .includes('claim_confidence_percentage'));
  const inEntry = cleanPayload();
  inEntry.response.confidence.claims['clm-1'].limitations =
    ['I am 80% sure about the sync.'];
  assert.ok(validateResponseAdaptation(inEntry)
    .includes('confidence_communication_percentage'));
});

test('missing confidence or sections fail closed', () => {
  const noConfidence = cleanPayload();
  delete noConfidence.response.confidence;
  assert.ok(validateResponseAdaptation(noConfidence).includes('confidence_missing'));
  const noSections = cleanPayload();
  delete noSections.response.sections;
  assert.ok(validateResponseAdaptation(noSections).includes('sections_missing'));
});

test('a legacy response object without the contract is rejected', () => {
  const legacy = {
    evidence: { items: [HIGHS_ITEM], comparison_items: [] },
    claims: [],
    response: {
      confidence: { score: 0.8, basis: 'LLM self-report' },
    },
  };
  const errors = validateResponseAdaptation(legacy);
  assert.ok(errors.includes('confidence_numeric_score'), `got ${errors}`);
  assert.ok(errors.includes('sections_missing'), `got ${errors}`);
});

test('an unknown profile vocabulary is rejected', () => {
  const payload = cleanPayload();
  payload.response_profile.response_intent = 'persuasive';
  const errors = validateResponseAdaptation(payload);
  assert.ok(errors.includes('profile_response_intent'), `got ${errors}`);
});

test('empty or duplicate sections are rejected', () => {
  const empty = cleanPayload();
  empty.response.sections[0].text = '   ';
  assert.ok(validateResponseAdaptation(empty).includes('section_empty_text'));
  const dup = cleanPayload();
  dup.response.sections.push({ ...dup.response.sections[0] });
  assert.ok(validateResponseAdaptation(dup).includes('section_duplicate_element'));
  const unknown = cleanPayload();
  unknown.response.sections.push(
    { id: 'fluff', label: 'Fluff', text: 'padding' });
  assert.ok(validateResponseAdaptation(unknown)
    .includes('section_unknown_element'));
});

test('a tampered coverage verdict is rejected', () => {
  const payload = cleanPayload();
  payload.response.confidence.coverage = {
    ...GOOD_COVERAGE, coverage: 'complete', freshness: 'fresh',
  };
  // items contain ev-high (complete) — but claim a partial verdict:
  payload.response.confidence.coverage.coverage = 'partial';
  const errors = validateResponseAdaptation(payload);
  assert.ok(errors.includes('confidence_coverage_mismatch_coverage'),
    `got ${errors}`);
});

test('a claim citing missing evidence re-derives to insufficient', () => {
  const itemsById = { 'ev-high': HIGHS_ITEM };
  const derived = deriveClaimConfidence(
    claim('verified_fact', ['ev-gone']), itemsById);
  assert.equal(derived.category, 'insufficient');
  const payload = cleanPayload();
  payload.claims[0] = {
    ...claim('verified_fact', ['ev-gone']),
    confidence: derived,
  };
  payload.response.confidence = {
    category: derived.category,
    claims: { 'clm-1': derived },
    coverage: GOOD_COVERAGE,
    communication: 'I can’t determine this from the records I have.',
  };
  assert.deepEqual(validateResponseAdaptation(payload), []);
});

test('a restated claim is not re-derived against the current evidence', () => {
  const payload = {
    evidence: { items: [], comparison_items: [] },
    claims: [{
      ...claim('verified_fact', ['ev-prior-1']),
      restated: true,
      confidence: { category: 'high', basis: [], limitations: [] },
    }],
    response_profile: classifyResponseProfile({
      intent: 'general', message: 'Tell me more.',
      responseIntent: 'direct_factual',
    }),
    response: {
      confidence: {
        category: 'high',
        claims: { 'clm-1': { category: 'high', basis: [], limitations: [] } },
        coverage: coverageSummary([], { comparisonItems: [] }),
        communication: 'I’m confident in this: it comes from complete, current records for the period.',
      },
      sections: [
        { id: 'direct_answer', label: 'Answer',
          text: 'You earned NGN 1,000,000.00 in November 2026.' },
      ],
    },
  };
  assert.deepEqual(validateResponseAdaptation(payload), []);
});
