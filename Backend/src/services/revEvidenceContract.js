'use strict';

const crypto = require('crypto');
const Joi = require('joi');

const EVIDENCE_SCHEMA_VERSION = 'rev-evidence-v2';
const CLASSIFICATIONS = Object.freeze([
  'verified_fact', 'deterministic_calculation', 'analytical_finding', 'hypothesis', 'unknown',
]);
const STATUSES = Object.freeze([
  'available', 'verified_zero', 'partial', 'not_synchronized', 'stale', 'unauthorized',
  'unsupported', 'consent_unavailable', 'pending', 'retrieval_failed', 'storage_failure',
  'invalid', 'contradictory', 'period_unavailable', 'unavailable',
]);
const COVERAGE_STATUSES = Object.freeze([
  'complete', 'partial', 'not_synchronized', 'synchronizing', 'unsupported',
  'missing_authorization', 'consent_unavailable', 'retrieval_failed', 'unknown',
  'invalid', 'contradictory', 'period_unavailable',
]);
const FRESHNESS_STATES = Object.freeze([
  'fresh', 'aging', 'stale', 'never_synchronized', 'synchronizing', 'unknown',
]);
const UNITS = Object.freeze(['currency', 'count', 'ratio', 'record', 'reference']);
const NUMERIC_STATUSES = new Set(['available', 'verified_zero', 'partial', 'stale']);

const isoDate = Joi.string().custom((value, helpers) => (
  /T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))
    ? value : helpers.error('any.invalid')
), 'explicit ISO timestamp');
const identity = Joi.string().trim().min(1).max(64);
const sourceReferenceSchema = Joi.object({
  source_id: Joi.string().trim().min(1).max(2048).required(),
  resource: Joi.string().trim().min(1).max(120).required(),
  sync_run_id: Joi.string().trim().max(100).allow(null).default(null),
}).unknown(false);
const periodSchema = Joi.object({
  start: isoDate.required(),
  end: isoDate.required(),
  timezone: Joi.string().trim().min(1).max(80).custom((value, helpers) => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return value; } catch { return helpers.error('any.invalid'); }
  }, 'IANA timezone').required(),
  semantics: Joi.string().valid('[start, end)').required(),
  label: Joi.string().max(160).optional(),
}).unknown(true).custom((value, helpers) => {
  const start = Date.parse(value.start);
  const end = Date.parse(value.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return helpers.error('any.invalid');
  return value;
}, 'half-open reporting period');
const coverageSchema = Joi.object({
  status: Joi.string().valid(...COVERAGE_STATUSES).required(),
  period_status: Joi.string().valid('covered', 'partial', 'current_snapshot', 'unavailable', 'not_applicable').required(),
  complete: Joi.boolean().required(),
  source: Joi.string().trim().min(1).max(160).required(),
  certified_store_count: Joi.number().integer().min(0).optional(),
  store_count: Joi.number().integer().min(0).optional(),
  note: Joi.string().max(1000).required(),
}).unknown(true);
const freshnessSchema = Joi.object({
  state: Joi.string().valid(...FRESHNESS_STATES).required(),
  as_of: isoDate.allow(null).required(),
  age_seconds: Joi.number().min(0).allow(null).required(),
  policy: Joi.string().trim().min(1).max(100).required(),
  note: Joi.string().max(600).required(),
}).unknown(false);
const provenanceSchema = Joi.object({
  retrieval: Joi.string().valid('direct', 'snapshot', 'aggregate', 'calculation', 'analytical_logic', 'none').required(),
  transformation: Joi.string().trim().min(1).max(1000).required(),
  calculation_version: Joi.string().trim().max(120).allow(null).required(),
  lineage: Joi.array().items(Joi.string().trim().min(1).max(300)).max(40).required(),
  reproducible: Joi.boolean().required(),
}).unknown(false);
const measurementSchema = Joi.object({
  amount: Joi.string().pattern(/^-?\d+(?:\.\d+)?$/).allow(null).required(),
  currency: Joi.string().pattern(/^[A-Z]{3}$/).allow(null).required(),
  interpretation: Joi.string().valid('gross', 'net', 'affected', 'estimated_opportunity', 'recoverable', 'not_applicable').required(),
  tax: Joi.string().valid('included', 'excluded', 'unknown', 'not_applicable').required(),
  shipping: Joi.string().valid('included', 'excluded', 'unknown', 'not_applicable').required(),
  discounts: Joi.string().valid('included', 'excluded', 'deducted', 'unknown', 'not_applicable').required(),
  refunds: Joi.string().valid('included', 'excluded', 'deducted', 'unknown', 'not_applicable').required(),
  cancellations: Joi.string().valid('included', 'excluded', 'unknown', 'not_applicable').required(),
  numerator: Joi.string().max(500).allow(null).required(),
  denominator: Joi.string().max(500).allow(null).required(),
  formula: Joi.string().max(1000).allow(null).required(),
}).unknown(false);

const evidenceSchema = Joi.object({
  id: Joi.string().pattern(/^ev-[a-f0-9]{24}$/).required(),
  schema_version: Joi.string().valid(EVIDENCE_SCHEMA_VERSION).required(),
  organization_id: identity.required(),
  store_id: identity.allow(null).required(),
  store_ids: Joi.array().items(identity).min(1).max(100).unique().required(),
  evidence_type: Joi.string().trim().min(1).max(80).required(),
  domain: Joi.string().trim().min(1).max(80).required(),
  classification: Joi.string().valid(...CLASSIFICATIONS).required(),
  status: Joi.string().valid(...STATUSES).required(),
  metric: Joi.string().trim().min(1).max(160).required(),
  label: Joi.string().trim().min(1).max(300).required(),
  value: Joi.any().required(),
  unit: Joi.string().valid(...UNITS).required(),
  currency: Joi.string().pattern(/^[A-Z]{3}$/).allow(null).required(),
  definition: Joi.string().trim().min(1).max(1600).required(),
  period: periodSchema.required(),
  source: Joi.object({
    system: Joi.string().trim().min(1).max(80).required(),
    resource: Joi.string().trim().min(1).max(120).required(),
    references: Joi.array().items(sourceReferenceSchema).max(100).required(),
  }).unknown(false).required(),
  retrieved_at: isoDate.required(),
  computed_at: isoDate.allow(null).required(),
  coverage: coverageSchema.required(),
  freshness: freshnessSchema.required(),
  provenance: provenanceSchema.required(),
  measurement: measurementSchema.allow(null).required(),
  confidence: Joi.object({
    level: Joi.string().valid('high', 'medium', 'low', 'none').required(),
    score: Joi.number().min(0).max(1).required(),
    basis: Joi.string().trim().min(1).max(800).required(),
  }).unknown(false).required(),
  store_scope: Joi.string().valid('store', 'organization').required(),
  limitations: Joi.array().items(Joi.string().max(800)).max(30).required(),
}).unknown(true).custom((item, helpers) => {
  if (item.store_id && item.store_ids.length !== 1) return helpers.error('any.invalid');
  if (item.store_id && item.store_ids[0] !== item.store_id) return helpers.error('any.invalid');
  if (item.classification === 'unknown' && item.value !== null) return helpers.error('any.invalid');
  if (item.classification === 'hypothesis' && item.status === 'available') return helpers.error('any.invalid');
  if (item.unit === 'currency' && NUMERIC_STATUSES.has(item.status)) {
    if (!item.currency || typeof item.value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(item.value)) return helpers.error('any.invalid');
    if (!item.measurement || item.measurement.currency !== item.currency || item.measurement.amount !== item.value) return helpers.error('any.invalid');
    if (item.status === 'available' && Number(item.value) === 0 && (!item.coverage.complete || item.coverage.status !== 'complete')) return helpers.error('any.invalid');
  }
  if (item.status === 'verified_zero' && (item.value !== 0 || !item.coverage.complete || item.coverage.status !== 'complete')) return helpers.error('any.invalid');
  if (item.status === 'available' && item.value === 0 && (!item.coverage.complete || item.coverage.status !== 'complete')) return helpers.error('any.invalid');
  return item;
}, 'evidence semantic invariants');

function validateEvidence(value) {
  const result = evidenceSchema.validate(value, { abortEarly: false, allowUnknown: true });
  return {
    valid: !result.error,
    value: result.value,
    errors: (result.error?.details || []).map(detail => detail.message),
  };
}

function assertEvidence(value) {
  const result = validateEvidence(value);
  if (!result.valid) {
    const error = new Error(`Invalid Rev evidence: ${result.errors.join('; ')}`);
    error.code = 'EVIDENCE_CONTRACT_INVALID';
    error.details = result.errors;
    throw error;
  }
  return result.value;
}

function validateEvidenceCollection(items, { organizationId, storeIds } = {}) {
  const errors = [];
  const seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const result = validateEvidence(item);
    if (!result.valid) errors.push(...result.errors);
    if (seen.has(item?.id)) errors.push('duplicate_evidence_id');
    seen.add(item?.id);
    if (organizationId && item?.organization_id !== organizationId) errors.push('cross_tenant_evidence');
    if (storeIds && !(item?.store_ids || []).every(id => storeIds.includes(id))) errors.push('cross_store_evidence');
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

function stableEvidenceId(parts) {
  return 'ev-' + crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24);
}

function createEvidence(input) {
  const id = stableEvidenceId([
    EVIDENCE_SCHEMA_VERSION, input.organization_id, input.store_ids, input.metric,
    input.period, input.source, input.provenance, input.value, input.status,
  ]);
  return assertEvidence({ ...input, id, schema_version: EVIDENCE_SCHEMA_VERSION });
}

module.exports = {
  EVIDENCE_SCHEMA_VERSION, CLASSIFICATIONS, STATUSES, COVERAGE_STATUSES,
  FRESHNESS_STATES, UNITS, evidenceSchema, periodSchema, coverageSchema,
  freshnessSchema, provenanceSchema, measurementSchema, validateEvidence,
  validateEvidenceCollection, assertEvidence, createEvidence, stableEvidenceId,
};
