'use strict';

// Task 210 — independent Node boundary validation for the adaptive answer
// structure and the evidence-derived confidence contract.
//
// Python composes the response profile, selects the composable elements and
// derives every claim's confidence category from the recorded evidence
// (method D1 in python/src/intelligence/response_adaptation.py). Node never
// trusts any of it: the profile's closed vocabularies are checked, every
// claim confidence is RE-DERIVED from the payload's own claims + evidence
// items and compared, the separate coverage representation is re-derived the
// same way, and a fabricated numeric score or a percentage string is
// rejected. Fail-closed, same pattern as the Task 204/207 boundaries.

const {
  qualityOf,
  SUFFICIENCY, SUFFICIENT, PARTIAL, INSUFFICIENT, UNAVAILABLE,
  COVERAGE_PARTIAL, FRESH_STALE, FRESH_FAILED, FRESH_NEVER, FRESH_SYNCHRONIZING,
} = require('./revEvidenceQuality');

const ADAPTATION_CONTRACT_VERSION = 'rev-response-adaptation-v1';

const RESPONSE_INTENTS = Object.freeze([
  'casual_conversation', 'direct_factual', 'explanation', 'comparative',
  'investigation', 'multi_domain', 'recommendation', 'clarification',
]);
const COMPLEXITIES = Object.freeze(['simple', 'moderate', 'complex']);
const EXPLANATION_DEPTHS = Object.freeze(['concise', 'standard', 'detailed']);
const CONFIDENCE_COMMUNICATIONS = Object.freeze(['implicit', 'inline', 'explicit']);
const RESPONSE_ELEMENTS = Object.freeze([
  'direct_answer', 'situation', 'insight', 'period_comparison', 'evidence',
  'implication', 'confidence', 'limitations', 'alternatives', 'unknowns',
  'suggested_investigation', 'recommendation', 'follow_up',
]);

const CONFIDENCE_HIGH = 'high';
const CONFIDENCE_MODERATE = 'moderate';
const CONFIDENCE_LIMITED = 'limited';
const CONFIDENCE_INSUFFICIENT = 'insufficient';
const CONFIDENCE_CATEGORIES = Object.freeze([
  CONFIDENCE_HIGH, CONFIDENCE_MODERATE, CONFIDENCE_LIMITED, CONFIDENCE_INSUFFICIENT,
]);
const CONFIDENCE_RANK = {
  [CONFIDENCE_HIGH]: 4, [CONFIDENCE_MODERATE]: 3,
  [CONFIDENCE_LIMITED]: 2, [CONFIDENCE_INSUFFICIENT]: 1,
};
const SUFFICIENCY_RANK = {
  [SUFFICIENT]: 4, [PARTIAL]: 3, [INSUFFICIENT]: 2, [UNAVAILABLE]: 1,
};

const CLAIM_GRADES = Object.freeze([
  'verified_fact', 'calculated_observation', 'hypothesis', 'unknown',
]);
const ANSWER_GRADES = Object.freeze([
  'verified_fact', 'calculated_observation', 'hypothesis',
]);

const FRESHNESS_RANK = {
  fresh: 0, aging: 1, synchronizing: 2, unknown: 3,
  stale: 4, failed: 5, never_synchronized: 6,
};

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function worseCategory(a, b) {
  return (CONFIDENCE_RANK[a] ?? 0) <= (CONFIDENCE_RANK[b] ?? 0) ? a : b;
}

function worseSufficiency(a, b) {
  return (SUFFICIENCY_RANK[a] ?? 0) <= (SUFFICIENCY_RANK[b] ?? 0) ? a : b;
}

function sufficiencyOfItem(item) {
  const quality = object(item) && object(item.quality) ? item.quality : null;
  if (quality && SUFFICIENCY.includes(quality.sufficiency)) {
    return [String(quality.sufficiency),
      Array.isArray(quality.reasons) ? quality.reasons.map(String) : []];
  }
  const derived = qualityOf(item || {});
  return [derived.sufficiency, Array.from(derived.reasons || [])];
}

// ── method D1 (must stay byte-identical with Python) ────────────────────────

function deriveClaimConfidence(claim, itemsById) {
  claim = object(claim) ? claim : {};
  let grade = claim.classification;
  if (!CLAIM_GRADES.includes(grade)) grade = 'unknown';

  if (grade === 'unknown') {
    return {
      category: CONFIDENCE_INSUFFICIENT,
      basis: ['no_evidence_to_determine'],
      limitations: ['The records I have do not include what this would take.'],
    };
  }

  const basis = new Set();
  const cited = [];
  for (const id of (claim.evidence_ids || [])) {
    if (id) cited.push(String(id));
  }
  const calculation = object(claim.calculation) ? claim.calculation : null;
  if (calculation && Array.isArray(calculation.inputs)) {
    for (const entry of calculation.inputs) {
      const id = object(entry) ? entry.evidence_id : null;
      if (id) cited.push(String(id));
    }
  }
  const uniqueCited = [...new Set(cited)];

  let worst = SUFFICIENT;
  if (uniqueCited.length > 0) {
    for (const id of uniqueCited) {
      const item = (itemsById || {})[id];
      if (item === undefined || item === null) {
        worst = worseSufficiency(worst, UNAVAILABLE);
        basis.add('evidence_reference_missing');
        continue;
      }
      const [suff, reasons] = sufficiencyOfItem(item);
      worst = worseSufficiency(worst, suff);
      for (const reason of reasons) basis.add(reason);
    }
  } else if (grade !== 'hypothesis') {
    worst = UNAVAILABLE;
    basis.add('evidence_reference_missing');
  }

  if (grade === 'hypothesis') basis.add('hypothesis_unverified');

  if (basis.has('conflicting_evidence')) basis.add('conflicting_penalty');
  for (const reason of basis) {
    if (reason.endsWith('_for_current_claim')) basis.add('staleness_penalty');
  }
  if (basis.has('partial_coverage') || basis.has('coverage_unknown')) {
    basis.add('coverage_penalty');
  }
  if (basis.has('mixed_currencies_not_comparable')) basis.add('currency_penalty');

  const base = {
    [SUFFICIENT]: CONFIDENCE_HIGH, [PARTIAL]: CONFIDENCE_MODERATE,
    [INSUFFICIENT]: CONFIDENCE_LIMITED, [UNAVAILABLE]: CONFIDENCE_INSUFFICIENT,
  }[worst];
  let category = base;
  if (grade === 'hypothesis') category = worseCategory(category, CONFIDENCE_LIMITED);
  if (basis.has('conflicting_penalty')) category = worseCategory(category, CONFIDENCE_LIMITED);
  if (basis.has('staleness_penalty')) category = worseCategory(category, CONFIDENCE_LIMITED);
  if (basis.has('coverage_penalty')) category = worseCategory(category, CONFIDENCE_MODERATE);
  if (basis.has('currency_penalty')) category = worseCategory(category, CONFIDENCE_INSUFFICIENT);

  return {
    category,
    basis: [...basis].sort(),
    limitations: limitationPhrases([...basis].sort()),
  };
}

const LIMITATION_PHRASES = {
  conflicting_evidence: 'The sources disagree on this figure.',
  mixed_currencies_not_comparable:
    'The values are recorded in different currencies that were not converted, so they cannot be compared directly.',
  stale_for_current_claim: 'This data is from the last successful sync and may be behind.',
  failed_for_current_claim: 'The last sync for this source failed, so the figure may be outdated.',
  never_synchronized_for_current_claim: 'This source has never synced, so the figure comes from a fallback.',
  synchronizing_for_current_claim: 'Data is still syncing, so this may be incomplete.',
  unknown_for_current_claim: 'I could not verify how current this data is.',
  partial_coverage: 'Some records for this period are missing from the source.',
  coverage_unknown: 'I cannot confirm how complete the source data is for this period.',
  value_missing: 'The source did not return a value for this.',
  value_unknown: 'The source did not return a value for this.',
  evidence_reference_missing: 'A source for this figure is no longer in the current evidence set.',
  hypothesis_unverified: 'This is a possible cause, not an established one.',
  no_evidence_to_determine: 'The records I have do not include what this would take.',
  source_unavailable: 'The source did not answer for this period.',
  source_not_synchronized: 'The source has not synchronized yet.',
  source_unauthorized: 'The source is not authorized to be read.',
  source_retrieval_failed: 'The source could not be reached.',
  source_consent_unavailable: 'Consent is not available for this source.',
  currency_unknown: 'The currency for this figure could not be verified.',
};

function limitationPhrases(reasons, limit = 4) {
  const phrases = [];
  for (const reason of reasons) {
    let phrase = LIMITATION_PHRASES[reason];
    if (phrase === undefined && reason.endsWith('_for_current_claim')) {
      phrase = 'This data may not reflect the current state.';
    }
    if (phrase && !phrases.includes(phrase)) phrases.push(phrase);
  }
  return phrases.slice(0, limit);
}

function responseConfidenceCategory(claims, itemsById) {
  const categories = [];
  for (const claim of claims || []) {
    if (!object(claim) || !ANSWER_GRADES.includes(claim.classification)) continue;
    if (!object(claim.confidence)) continue;
    const category = claim.confidence.category;
    if (CONFIDENCE_CATEGORIES.includes(category)) categories.push(category);
  }
  if (categories.length > 0) {
    let category = categories[0];
    for (const other of categories.slice(1)) category = worseCategory(category, other);
    return category;
  }
  if (itemsById) {
    let worst = SUFFICIENT;
    for (const item of Object.values(itemsById)) {
      const [suff] = sufficiencyOfItem(item);
      worst = worseSufficiency(worst, suff);
    }
    return {
      [SUFFICIENT]: CONFIDENCE_HIGH, [PARTIAL]: CONFIDENCE_MODERATE,
      [INSUFFICIENT]: CONFIDENCE_LIMITED, [UNAVAILABLE]: CONFIDENCE_INSUFFICIENT,
    }[worst];
  }
  return CONFIDENCE_INSUFFICIENT;
}

// ── response-intent / complexity classification (mirror) ──────────────────
//
// The deterministic A–H classifier. Python is the runtime authority (it runs
// inside the investigation); this mirror exists so the boundary can prove the
// recorded profile matches the deterministic rule, pinned by the golden set.

const CONVERSATIONAL_INTENTS = new Set([
  'greeting', 'social', 'identity', 'capability', 'knowledge', 'general',
  'read_only_boundary', 'unsupported_question',
]);
const SINGLE_DOMAIN_INTENTS = new Set([
  'revenue_investigation', 'checkout_investigation', 'customer_retention',
  'refund_investigation', 'product_investigation', 'traffic_investigation',
  'data_coverage',
]);
const MULTI_DOMAIN_INTENTS = new Set(['store_overview', 'finding_investigation']);
const RECOMMENDATION_INTENTS = new Set(['finding_investigation']);

const METRIC_QUERY_RE = /\b(?:how (?:much|many)|show me|count|total|what (?:is|was|are|were) (?:my|our|the)|how (?:is|are) (?:my|our))\b/i;
const CAUSAL_RE = /\b(?:why|cause|reason|explain|what (?:is|was) (?:going on|happening)|what (?:do i|should i) need to know)\b/i;
const EXPLANATION_RE = /\b(?:why|explain|how (?:does|did)|what (?:does|does this) .* mean|walk me through)\b/i;

function profileReason(responseIntent, hasComparison, domainCount, clarificationRequired) {
  if (responseIntent === 'casual_conversation') return 'the question needs no store investigation';
  if (clarificationRequired) return 'the question needs clarification before any figure can be given';
  if (responseIntent === 'direct_factual') return 'a single recorded metric answers the question directly';
  if (hasComparison) return 'the answer compares recorded periods';
  if (responseIntent === 'multi_domain') return 'the answer combines findings from several store domains';
  if (responseIntent === 'recommendation') return 'the merchant asked what to do, so the answer leads with the step';
  if (responseIntent === 'explanation') return 'the merchant asked for the reasoning behind the figures';
  return 'the answer combines several store checks';
}

function classifyResponseProfile({
  intent,
  understanding = null,
  status = null,
  hasComparison = false,
  domains = null,
  clarificationRequired = false,
  isPriorityQuestion = false,
  message = '',
  claimCategories = null,
  responseIntent: intentOverride = null,
  explanationDepth: depthOverride = null,
}) {
  understanding = understanding || {};
  domains = domains || [];
  message = message || '';
  const clarification = Boolean(
    clarificationRequired || intent === 'clarify'
    || understanding.intent === 'clarification_needed');
  if (intentOverride !== null && intentOverride !== undefined
      && !RESPONSE_INTENTS.includes(intentOverride)) {
    throw new Error(`Unknown response intent: ${intentOverride}`);
  }
  if (depthOverride !== null && depthOverride !== undefined
      && !EXPLANATION_DEPTHS.includes(depthOverride)) {
    throw new Error(`Unknown explanation depth: ${depthOverride}`);
  }

  let responseIntent = intentOverride;
  if (responseIntent === null || responseIntent === undefined) {
    if (CONVERSATIONAL_INTENTS.has(intent)) {
      responseIntent = 'casual_conversation';
    } else if (clarification) {
      responseIntent = 'clarification';
    } else if (isPriorityQuestion || RECOMMENDATION_INTENTS.has(intent)) {
      responseIntent = 'recommendation';
    } else if (hasComparison) {
      responseIntent = 'comparative';
    } else if (MULTI_DOMAIN_INTENTS.has(intent) || domains.length >= 2) {
      responseIntent = 'multi_domain';
    } else if (intent === 'data_coverage' && !CAUSAL_RE.test(message)) {
      responseIntent = 'direct_factual';
    } else if (METRIC_QUERY_RE.test(message) && !CAUSAL_RE.test(message)
        && !hasComparison) {
      responseIntent = 'direct_factual';
    } else if (EXPLANATION_RE.test(message) && SINGLE_DOMAIN_INTENTS.has(intent)
        && !hasComparison) {
      responseIntent = 'explanation';
    } else {
      responseIntent = 'investigation';
    }
  }

  let complexity;
  if (['casual_conversation', 'clarification', 'direct_factual'].includes(responseIntent)) {
    complexity = 'simple';
  } else if (['explanation', 'comparative', 'recommendation', 'investigation'].includes(responseIntent)) {
    complexity = domains.length >= 2 ? 'complex' : 'moderate';
  } else {
    complexity = 'complex';
  }

  let depth = { simple: 'concise', moderate: 'standard', complex: 'detailed' }[complexity];
  if (status === 'insufficient_data' || status === 'failed') depth = 'concise';
  if (depthOverride !== null && depthOverride !== undefined) depth = depthOverride;

  let communication;
  if (responseIntent === 'casual_conversation') {
    communication = 'implicit';
  } else {
    const categories = claimCategories || [];
    if (categories.includes('insufficient')) {
      communication = 'explicit';
    } else if (categories.some(c => c === 'moderate' || c === 'limited')) {
      communication = 'inline';
    } else if (categories.length > 0) {
      communication = responseIntent === 'direct_factual' ? 'implicit' : 'inline';
    } else {
      communication = responseIntent === 'direct_factual' ? 'implicit' : 'inline';
    }
  }

  return {
    contract_version: ADAPTATION_CONTRACT_VERSION,
    response_intent: responseIntent,
    complexity,
    explanation_depth: depth,
    recommendation_appropriate: [
      'recommendation', 'multi_domain', 'investigation', 'comparative',
    ].includes(responseIntent),
    clarification_required: clarification,
    confidence_communication: communication,
    reason: profileReason(responseIntent, hasComparison, domains.length, clarification),
  };
}

// ── ordered element selection (mirror) ─────────────────────────────────────
const ELEMENTS_BY_INTENT = {
  casual_conversation: [],
  direct_factual: ['direct_answer', 'evidence'],
  explanation: ['direct_answer', 'situation', 'insight', 'evidence',
    'limitations', 'recommendation'],
  comparative: ['direct_answer', 'period_comparison', 'evidence', 'insight',
    'limitations', 'recommendation'],
  investigation: ['situation', 'insight', 'implication', 'evidence',
    'confidence', 'limitations', 'recommendation', 'follow_up'],
  multi_domain: ['situation', 'insight', 'evidence', 'confidence',
    'limitations', 'recommendation', 'follow_up'],
  recommendation: ['direct_answer', 'recommendation', 'evidence',
    'confidence', 'limitations', 'follow_up'],
  clarification: ['direct_answer', 'limitations', 'unknowns',
    'suggested_investigation'],
};

function selectElements(profile, {
  hasFacts = false, hasComparison = false, hasEvidence = false,
  hasHypotheses = false, hasRecommendations = false, hasUnknowns = false,
  hasLimitations = false, hasFollowUps = false,
  insufficientNextStep = null, recommendationAppropriate = null,
} = {}) {
  profile = object(profile) ? profile : {};
  const responseIntent = profile.response_intent || 'investigation';
  const communication = profile.confidence_communication || 'inline';
  let appropriate = recommendationAppropriate;
  if (appropriate === null || appropriate === undefined) {
    appropriate = Boolean(profile.recommendation_appropriate);
  }

  const present = {
    direct_answer: Boolean(
      hasFacts || hasComparison || responseIntent === 'clarification'),
    situation: Boolean(hasFacts),
    insight: Boolean(hasFacts || hasComparison),
    period_comparison: Boolean(hasComparison),
    evidence: Boolean(hasEvidence),
    implication: Boolean(hasHypotheses),
    confidence: false,
    limitations: Boolean(hasLimitations),
    alternatives: Boolean(hasHypotheses),
    unknowns: Boolean(hasUnknowns),
    suggested_investigation: Boolean(insufficientNextStep),
    recommendation: Boolean(hasRecommendations && appropriate),
    follow_up: Boolean(hasFollowUps),
  };

  if (insufficientNextStep) {
    const elements = [];
    if (present.direct_answer) elements.push('direct_answer');
    if (present.limitations) elements.push('limitations');
    elements.push('confidence');
    if (present.unknowns) elements.push('unknowns');
    elements.push('suggested_investigation');
    return elements;
  }

  const elements = (ELEMENTS_BY_INTENT[responseIntent] || [])
    .filter(e => present[e]);

  if (!elements.includes('confidence')
      && communication !== 'implicit'
      && responseIntent !== 'casual_conversation') {
    const tail = ['limitations', 'unknowns', 'recommendation', 'follow_up'];
    const anchor = elements.findIndex(e => tail.includes(e));
    if (anchor === -1) elements.push('confidence');
    else elements.splice(anchor, 0, 'confidence');
  }
  return elements;
}

// ── coverage representation (must stay identical with Python) ──────────────

function coverageSummary(items, { window: win = null, comparisonItems = null } = {}) {
  const all = [
    ...(Array.isArray(items) ? items : []).filter(object),
    ...(Array.isArray(comparisonItems) ? comparisonItems : []).filter(object),
  ];
  win = win || {};
  let coverageState = null;
  let fresh = null;
  let currencyMixed = false;
  let currencyUnknown = false;
  let certified = false;
  const coverages = [];
  for (const item of all) {
    const quality = object(item.quality) ? item.quality : qualityOf(item);
    coverages.push(quality.coverage);
    const state = quality.freshness;
    if (FRESHNESS_RANK[state] !== undefined) {
      if (fresh === null || FRESHNESS_RANK[state] > FRESHNESS_RANK[fresh]) fresh = state;
    }
    if (quality.currency_integrity === 'mixed_not_comparable') currencyMixed = true;
    if (quality.currency_integrity === 'unknown_currency') currencyUnknown = true;
    if (item.metric === 'certified_store_count'
        && (item.value === 1 || item.value === '1')) certified = true;
  }
  if (coverages.length === 0) {
    coverageState = 'no_data';
  } else if (coverages.includes(COVERAGE_PARTIAL)) {
    coverageState = 'partial';
  } else if (coverages.every(c => c === 'complete' || c === 'not_applicable' || c === undefined || c === null)) {
    coverageState = 'complete';
  } else {
    coverageState = 'unknown';
  }
  const limits = [];
  if (coverageState === 'partial') limits.push('Some records for this period are missing from the source.');
  else if (coverageState === 'unknown') limits.push('I cannot confirm how complete the source data is for this period.');
  if (fresh === FRESH_STALE || fresh === FRESH_FAILED || fresh === FRESH_NEVER) {
    limits.push('The data may not reflect the current state.');
  } else if (fresh === FRESH_SYNCHRONIZING) {
    limits.push('Data is still syncing, so this may be incomplete.');
  }
  if (currencyMixed) limits.push('Values are recorded in currencies that were not converted.');
  if (currencyUnknown) limits.push('A currency could not be verified.');
  return {
    window: {
      label: win.label ?? null, start: win.start ?? null,
      end: win.end ?? null, timezone: win.timezone ?? null,
    },
    coverage: coverageState,
    freshness: fresh || 'unknown',
    currency_comparable: !(currencyMixed || currencyUnknown),
    certified,
    limits: limits.slice(0, 3),
  };
}

// ── boundary validation (fail-closed) ───────────────────────────────────────

function hasPercentage(text) {
  return typeof text === 'string' && /\d+(\.\d+)?\s*%/.test(text);
}

function isNumericScore(value) {
  return (typeof value === 'number' && !Number.isNaN(value))
    || (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value)));
}

function validateResponseProfile(profile) {
  const errors = [];
  if (!object(profile)) return ['profile_not_object'];
  if (profile.contract_version !== ADAPTATION_CONTRACT_VERSION) errors.push('profile_contract_version');
  if (!RESPONSE_INTENTS.includes(profile.response_intent)) errors.push('profile_response_intent');
  if (!COMPLEXITIES.includes(profile.complexity)) errors.push('profile_complexity');
  if (!EXPLANATION_DEPTHS.includes(profile.explanation_depth)) errors.push('profile_explanation_depth');
  if (typeof profile.recommendation_appropriate !== 'boolean') errors.push('profile_recommendation_appropriate');
  if (typeof profile.clarification_required !== 'boolean') errors.push('profile_clarification_required');
  if (!CONFIDENCE_COMMUNICATIONS.includes(profile.confidence_communication)) {
    errors.push('profile_confidence_communication');
  }
  if (typeof profile.reason !== 'string' || !profile.reason.trim()) errors.push('profile_reason');
  return [...new Set(errors)].sort();
}

function validateResponseConfidence(confidence, claims, itemsById, items = null, comparisonItems = null) {
  const errors = [];
  if (!object(confidence)) return ['confidence_not_object'];
  // A fabricated numeric score (or a numeric-looking "basis") is rejected:
  // this contract communicates categories and prose only.
  if (Object.prototype.hasOwnProperty.call(confidence, 'score')
      && isNumericScore(confidence.score)) {
    errors.push('confidence_numeric_score');
  }
  if (!CONFIDENCE_CATEGORIES.includes(confidence.category)) errors.push('confidence_category');

  // per-claim map: ids must resolve to recorded claims and the recorded
  // category must equal the independent re-derivation.
  if (!object(confidence.claims)) {
    errors.push('confidence_claims_not_object');
  } else {
    const recorded = new Map((claims || []).map(c => [c && c.claim_id, c])
      .filter(([id]) => typeof id === 'string'));
    for (const [id, entry] of Object.entries(confidence.claims)) {
      const claim = recorded.get(id);
      if (!object(claim)) {
        errors.push('confidence_claim_unknown');
        continue;
      }
      if (!object(entry)) {
        errors.push('confidence_claim_entry');
        continue;
      }
      if (!CONFIDENCE_CATEGORIES.includes(entry.category)) {
        errors.push('confidence_claim_category');
        continue;
      }
      // A restated claim (meta follow-up) cites a previous investigation's
      // evidence, which is not in this payload — validated under the
      // restatement rules like the epistemic contract, not re-derived.
      if (claim.restated === true) continue;
      const derived = deriveClaimConfidence(claim, itemsById);
      if (entry.category !== derived.category) errors.push('confidence_claim_category_mismatch');
      if (entry.basis !== undefined && JSON.stringify([...entry.basis].sort())
          !== JSON.stringify(derived.basis)) {
        errors.push('confidence_claim_basis_mismatch');
      }
    }
    for (const claim of (claims || [])) {
      if (!object(claim)) continue;
      if (!object(claim.confidence)) continue;
      if (!Object.prototype.hasOwnProperty.call(confidence.claims, claim.claim_id)) {
        errors.push('confidence_claim_missing_from_map');
      }
    }
  }

  // the response category is the worst load-bearing claim (or the evidence
  // fallback for claim-less direct answers).
  if (CONFIDENCE_CATEGORIES.includes(confidence.category)) {
    const expected = responseConfidenceCategory(claims || [], itemsById);
    if (confidence.category !== expected) errors.push('confidence_response_category_mismatch');
  }

  // coverage: separate representation, re-derived, never a category or a number.
  if (!object(confidence.coverage)) {
    errors.push('confidence_coverage_not_object');
  } else {
    const cov = confidence.coverage;
    for (const key of ['window', 'coverage', 'freshness', 'currency_comparable',
      'certified', 'limits']) {
      if (!Object.prototype.hasOwnProperty.call(cov, key)) {
        errors.push(`confidence_coverage_missing_${key}`);
      }
    }
    if (typeof cov.currency_comparable !== 'boolean') errors.push('confidence_coverage_comparable_type');
    if (typeof cov.certified !== 'boolean') errors.push('confidence_coverage_certified_type');
    if (!Array.isArray(cov.limits) || cov.limits.some(l => typeof l !== 'string')) {
      errors.push('confidence_coverage_limits');
    }
    if (isNumericScore(cov.coverage) || (typeof cov.coverage === 'number')) {
      errors.push('confidence_coverage_not_category_free');
    }
    // The coverage verdict must equal the independent re-derivation from the
    // payload's own evidence items (coverage is data, not a claim of certainty).
    if (Array.isArray(items)) {
      const rederived = coverageSummary(items, { comparisonItems: comparisonItems || [] });
      for (const key of ['coverage', 'freshness', 'currency_comparable', 'certified']) {
        if (cov[key] !== rederived[key]) errors.push(`confidence_coverage_mismatch_${key}`);
      }
    }
  }

  // communication: one natural-language sentence, no percentages, no filler.
  if (typeof confidence.communication !== 'string' || !confidence.communication.trim()) {
    errors.push('confidence_communication');
  } else if (hasPercentage(confidence.communication)) {
    errors.push('confidence_communication_percentage');
  }
  return [...new Set(errors)].sort();
}

function validateSections(sections) {
  const errors = [];
  if (!Array.isArray(sections)) return ['sections_not_array'];
  const seen = new Set();
  for (const section of sections) {
    if (!object(section)) {
      errors.push('section_not_object');
      continue;
    }
    if (!RESPONSE_ELEMENTS.includes(section.id)) errors.push('section_unknown_element');
    if (seen.has(section.id)) errors.push('section_duplicate_element');
    seen.add(section.id);
    if (typeof section.label !== 'string' || !section.label.trim()) errors.push('section_label');
    // no section may render empty
    if (typeof section.text !== 'string' || !section.text.trim()) errors.push('section_empty_text');
  }
  return [...new Set(errors)].sort();
}

function validateResponseAdaptation(data) {
  const errors = [];
  if (!object(data)) return ['adaptation_payload_not_object'];

  const itemsById = {};
  const evidence = object(data.evidence) ? data.evidence : {};
  for (const item of [
    ...(Array.isArray(evidence.items) ? evidence.items : []),
    ...(Array.isArray(evidence.comparison_items) ? evidence.comparison_items : []),
  ]) {
    if (object(item) && typeof item.id === 'string' && item.id) itemsById[item.id] = item;
  }
  const claims = Array.isArray(data.claims) ? data.claims : [];

  if (data.response_profile !== undefined) {
    errors.push(...validateResponseProfile(data.response_profile));
  }
  if (object(data.response)) {
    if (data.response.confidence !== undefined) {
      errors.push(...validateResponseConfidence(
        data.response.confidence, claims, itemsById,
        Array.isArray(evidence.items) ? evidence.items : [],
        Array.isArray(evidence.comparison_items) ? evidence.comparison_items : []));
    }
    if (data.response.sections !== undefined) {
      errors.push(...validateSections(data.response.sections));
    }
    // A live investigation response must carry the adaptation contract.
    if (data.response.confidence === undefined) {
      errors.push('confidence_missing');
    }
    if (data.response.sections === undefined) {
      errors.push('sections_missing');
    }
  }
  // no percentage anywhere in the confidence contract — not in the
  // communication, not in any per-claim entry or limitation phrase.
  if (object(data.response) && object(data.response.confidence)
      && hasPercentage(JSON.stringify(data.response.confidence))) {
    errors.push('confidence_communication_percentage');
  }

  // every recorded claim with a confidence must re-derive at the boundary
  // (restated claims are shape-checked only — see the restatement rule).
  for (const claim of claims) {
    if (!object(claim) || !object(claim.confidence)) continue;
    if (!CONFIDENCE_CATEGORIES.includes(claim.confidence.category)) {
      errors.push('claim_confidence_category');
    }
    if (claim.restated !== true) {
      const derived = deriveClaimConfidence(claim, itemsById);
      if (claim.confidence.category !== derived.category) {
        errors.push('claim_confidence_mismatch');
      }
    }
    if (hasPercentage(JSON.stringify(claim.confidence))) {
      errors.push('claim_confidence_percentage');
    }
  }
  return [...new Set(errors)].sort();
}

module.exports = {
  ADAPTATION_CONTRACT_VERSION,
  RESPONSE_INTENTS,
  COMPLEXITIES,
  EXPLANATION_DEPTHS,
  CONFIDENCE_COMMUNICATIONS,
  RESPONSE_ELEMENTS,
  CONFIDENCE_CATEGORIES,
  deriveClaimConfidence,
  responseConfidenceCategory,
  classifyResponseProfile,
  selectElements,
  coverageSummary,
  validateResponseProfile,
  validateResponseConfidence,
  validateSections,
  validateResponseAdaptation,
};
