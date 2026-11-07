'use strict';

const RECOMMENDATION_CONTRACT = 'rev-recommendation-v1';
const SELECTED_FINDING_CONTRACT = 'rev-selected-finding-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATES = new Set(['proposed', 'presented', 'acknowledged', 'dismissed', 'superseded', 'invalidated', 'resolved']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function validateRecommendationBoundary(selected, recommendations, { organizationId, evidenceIds = new Set() } = {}) {
  const errors = [];
  if (selected !== null && selected !== undefined) {
    if (!object(selected) || selected.contract_version !== SELECTED_FINDING_CONTRACT) errors.push('selected_finding_contract');
    if (!UUID.test(selected?.finding_id || '') || selected?.tenant?.organization_id !== organizationId ||
        !Array.isArray(selected?.tenant?.store_ids) || !selected.tenant.store_ids.length) errors.push('selected_finding_tenant');
    if (!Array.isArray(selected?.evidence_references) || !selected.evidence_references.length ||
        selected.evidence_references.some(ref => !evidenceIds.has(ref))) errors.push('selected_finding_evidence_reference');
  }
  if (!Array.isArray(recommendations)) return [...errors, 'recommendations_not_array'];
  const ids = new Set();
  for (const rec of recommendations) {
    if (!object(rec) || rec.contract_version !== RECOMMENDATION_CONTRACT || !UUID.test(rec.recommendation_id || '')) errors.push('recommendation_contract');
    if (ids.has(rec.recommendation_id)) errors.push('recommendation_duplicate');
    ids.add(rec.recommendation_id);
    if (rec.tenant?.organization_id !== organizationId || !Array.isArray(rec.tenant?.store_ids)) errors.push('recommendation_tenant');
    if (!STATES.has(rec.lifecycle_state) || rec.executed !== false || rec.read_only !== true ||
        rec.execution_status !== undefined && rec.execution_status !== 'not_requested') errors.push('recommendation_lifecycle');
    if (typeof rec.step !== 'string' || !rec.step.trim() || typeof rec.why_it_matters !== 'string' ||
        !rec.why_it_matters.trim() || typeof rec.validation_method !== 'string' || !rec.validation_method.trim() ||
        /^(?:improve|optimize) (?:your )?(?:store|conversion rate|inventory|marketing)\.?$|^increase customer retention\.?$|^monitor your revenue\.?$/i.test(rec.step.trim())) errors.push('recommendation_quality');
    if (!Array.isArray(rec.evidence_references) || !rec.evidence_references.length ||
        rec.evidence_references.some(ref => !evidenceIds.has(ref))) errors.push('recommendation_evidence_reference');
    if (rec.finding_id && (!selected || rec.finding_id !== selected.finding_id)) errors.push('recommendation_finding_reference');
  }
  return [...new Set(errors)].sort();
}

module.exports = { RECOMMENDATION_CONTRACT, SELECTED_FINDING_CONTRACT, validateRecommendationBoundary };
