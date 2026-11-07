'use strict';

/**
 * Task 203 - Node mirror of the unified evidence-quality model
 * (python/src/intelligence/evidence_quality.py).
 *
 * One coherent model, six INDEPENDENT dimensions (availability, coverage,
 * freshness, value_state, consistency, currency_integrity) plus the
 * deterministic capability helpers: currency-safe aggregation/comparison,
 * zero-vs-missing classification, safe ratios, source-specific freshness,
 * and contradiction detection with defensible resolution only.
 *
 * Output shapes are byte-for-byte the same as the Python module so that
 * quality metadata survives the Python<->Node service boundary unchanged.
 * Money math is integer (BigInt) scaled - never binary float.
 */

const contract = require('./revEvidenceContract');

const QUALITY_SCHEMA_VERSION = 'rev-evidence-quality-v1';

// --- A. Availability ------------------------------------------------------
const AVAILABILITY_AVAILABLE = 'available';
const AVAILABILITY_PARTIAL = 'partially_available';
const AVAILABILITY_UNAVAILABLE = 'unavailable';
const AVAILABILITY_UNAUTHORIZED = 'unauthorized';
const AVAILABILITY_UNSUPPORTED = 'unsupported';
const AVAILABILITY_NOT_SYNCED = 'not_synchronized';
const AVAILABILITY_RETRIEVAL_FAILED = 'retrieval_failed';
const AVAILABILITY = Object.freeze([
  AVAILABILITY_AVAILABLE, AVAILABILITY_PARTIAL, AVAILABILITY_UNAVAILABLE,
  AVAILABILITY_UNAUTHORIZED, AVAILABILITY_UNSUPPORTED,
  AVAILABILITY_NOT_SYNCED, AVAILABILITY_RETRIEVAL_FAILED,
]);

// --- B. Coverage ----------------------------------------------------------
const COVERAGE_COMPLETE = 'complete';
const COVERAGE_PARTIAL = 'partial';
const COVERAGE_UNKNOWN = 'unknown';
const COVERAGE_NOT_APPLICABLE = 'not_applicable';
const COVERAGE = Object.freeze([COVERAGE_COMPLETE, COVERAGE_PARTIAL, COVERAGE_UNKNOWN, COVERAGE_NOT_APPLICABLE]);

// --- C. Freshness ---------------------------------------------------------
const FRESH_FRESH = 'fresh';
const FRESH_AGING = 'aging';
const FRESH_STALE = 'stale';
const FRESH_UNKNOWN = 'unknown';
const FRESH_SYNCHRONIZING = 'synchronizing';
const FRESH_FAILED = 'failed';
const FRESH_NEVER = 'never_synchronized';
const FRESHNESS = Object.freeze([
  FRESH_FRESH, FRESH_AGING, FRESH_STALE, FRESH_UNKNOWN,
  FRESH_SYNCHRONIZING, FRESH_FAILED, FRESH_NEVER,
]);

// --- D. Value state -------------------------------------------------------
const VALUE_OBSERVED_NONZERO = 'observed_nonzero';
const VALUE_VERIFIED_ZERO = 'verified_zero';
const VALUE_NULL = 'null';
const VALUE_MISSING = 'missing';
const VALUE_NOT_APPLICABLE = 'not_applicable';
const VALUE_UNKNOWN = 'unknown';
const VALUE_STATE = Object.freeze([
  VALUE_OBSERVED_NONZERO, VALUE_VERIFIED_ZERO, VALUE_NULL, VALUE_MISSING,
  VALUE_NOT_APPLICABLE, VALUE_UNKNOWN,
]);

// --- E. Consistency -------------------------------------------------------
const CONSISTENT = 'consistent';
const CONFLICTING = 'conflicting';
const UNVERIFIED = 'unverified';
const CONSISTENCY = Object.freeze([CONSISTENT, CONFLICTING, UNVERIFIED]);

// --- F. Currency integrity ------------------------------------------------
const CURRENCY_SINGLE = 'single_verified_currency';
const CURRENCY_COMPATIBLE = 'compatible';
const CURRENCY_CONVERTED = 'explicitly_converted';
const CURRENCY_MIXED = 'mixed_not_comparable';
const CURRENCY_UNKNOWN = 'unknown_currency';
const CURRENCY_NOT_APPLICABLE = 'not_applicable';
const CURRENCY_INTEGRITY = Object.freeze([
  CURRENCY_SINGLE, CURRENCY_COMPATIBLE, CURRENCY_CONVERTED, CURRENCY_MIXED,
  CURRENCY_UNKNOWN, CURRENCY_NOT_APPLICABLE,
]);

// --- Sufficiency ----------------------------------------------------------
const SUFFICIENT = 'sufficient';
const PARTIAL = 'partial';
const INSUFFICIENT = 'insufficient';
const UNAVAILABLE = 'unavailable';
const SUFFICIENCY = Object.freeze([SUFFICIENT, PARTIAL, INSUFFICIENT, UNAVAILABLE]);

const USABLE_STATUSES = new Set(['available', 'verified_zero', 'stale', 'contradictory']);
const UNAVAILABLE_STATUSES = new Set(['unavailable', 'period_unavailable', 'invalid']);
const UNAUTHORIZED_STATUSES = new Set(['unauthorized', 'consent_unavailable']);
const UNSUPPORTED_STATUSES = new Set(['unsupported']);
const NOT_SYNCED_STATUSES = new Set(['not_synchronized']);
const RETRIEVAL_FAILED_STATUSES = new Set(['retrieval_failed', 'storage_failure']);
const PARTIAL_STATUSES = new Set(['partial', 'pending']);

const ZERO_DENOMINATOR_NOTE =
  'The denominator is zero or non-positive, so no ratio or percentage is ' +
  'computed; an invented denominator would be a fabricated value.';

// ---------------------------------------------------------------------------
// Decimal engine (BigInt-scaled; mirrors Python decimal with ROUND_HALF_UP).
// ---------------------------------------------------------------------------

const DEC_RE = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

function parseDecimal(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  let s;
  if (typeof value === 'bigint') s = value.toString();
  else if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    s = String(value);
  } else if (typeof value === 'string') s = value.trim();
  else return null;
  const m = DEC_RE.exec(s);
  if (!m) return null;
  let digits = m[2] + (m[3] || '');
  let exp = -((m[3] || '').length);
  if (m[4] !== undefined) exp += parseInt(m[4], 10);
  digits = digits.replace(/^0+(?=\d)/, '');
  if (digits === '') digits = '0';
  const sign = digits === '0' ? 1 : (m[1] === '-' ? -1 : 1);
  return { sign, digits, exp };
}

const toDecimal = parseDecimal;
const _numeric = parseDecimal;

function formatDecimal(d) {
  if (!d) return null;
  if (d.digits === '0') {
    // Match Python decimal: quantized zero keeps its scale ("0.00").
    return d.exp < 0 ? '0' + '.' + '0'.repeat(-d.exp) : '0';
  }
  const sign = d.sign === -1 ? '-' : '';
  if (d.exp >= 0) return sign + d.digits + '0'.repeat(d.exp);
  const fracLen = -d.exp;
  const padded = d.digits.padStart(fracLen, '0');
  const whole = padded.slice(0, padded.length - fracLen) || '0';
  const frac = padded.slice(padded.length - fracLen);
  return sign + whole + '.' + frac;
}

function scaledTo(d, e) {
  if (d.digits === '0') return { sign: 1, digits: '0', exp: e };
  if (e === d.exp) return d;
  const factor = 10n ** BigInt(d.exp - e);
  return { sign: d.sign, digits: (BigInt(d.digits) * factor).toString(), exp: e };
}

function addDecimals(a, b) {
  if (!a) return b;
  if (!b) return a;
  const e = Math.min(a.exp, b.exp);
  const A = scaledTo(a, e);
  const B = scaledTo(b, e);
  const total = (A.sign === -1 ? -BigInt(A.digits) : BigInt(A.digits)) +
                (B.sign === -1 ? -BigInt(B.digits) : BigInt(B.digits));
  if (total === 0n) return { sign: 1, digits: '0', exp: 0 };
  return { sign: total < 0n ? -1 : 1, digits: (total < 0n ? -total : total).toString(), exp: e };
}

function subDecimals(a, b) {
  return addDecimals(a, { sign: b.sign === 0 ? 1 : -b.sign, digits: b.digits, exp: b.exp });
}

function compareDecimals(a, b) {
  if (!a || !b) return 0;
  const e = Math.min(a.exp, b.exp);
  const A = scaledTo(a, e);
  const B = scaledTo(b, e);
  const va = (A.sign === -1 ? -1n : 1n) * BigInt(A.digits);
  const vb = (B.sign === -1 ? -1n : 1n) * BigInt(B.digits);
  return va < vb ? -1 : va > vb ? 1 : 0;
}

function multiplyInt(d, n) {
  if (!d || d.digits === '0' || n === 0) return { sign: 1, digits: '0', exp: d ? d.exp : 0 };
  const factor = BigInt(Math.abs(n));
  const total = BigInt(d.digits) * factor;
  return { sign: d.sign * Math.sign(n), digits: total.toString(), exp: d.exp };
}

// Round to `targetExp` fractional digits, ties away from zero (HALF_UP).
function quantize(d, targetExp) {
  if (!d || d.digits === '0') return { sign: 1, digits: '0', exp: targetExp };
  if (d.exp >= targetExp) {
    const factor = 10n ** BigInt(d.exp - targetExp);
    return { sign: d.sign, digits: (BigInt(d.digits) * factor).toString(), exp: targetExp };
  }
  const drop = targetExp - d.exp;
  const divisor = 10n ** BigInt(drop);
  const total = BigInt(d.digits);
  const q = total / divisor;
  const r = total % divisor;
  const half = divisor / 2n;
  const rounded = r > half || r === half ? q + 1n : q;
  return { sign: d.sign, digits: rounded.toString(), exp: targetExp };
}

// Division truncated toward zero at `precision` fractional digits.
function divideTo(a, b, precision = 12) {
  if (!a || !b || b.digits === '0') return null;
  const sign = (a.sign === -1) !== (b.sign === -1) ? -1 : 1;
  let N = BigInt(a.digits);
  let D = BigInt(b.digits);
  const shift = precision + a.exp - b.exp;
  if (shift >= 0) N = N * 10n ** BigInt(shift);
  else D = D * 10n ** BigInt(-shift);
  const q = N / D;
  if (q === 0n) return { sign: 1, digits: '0', exp: -precision };
  return { sign, digits: q.toString(), exp: -precision };
}

function normalizeCurrency(code) {
  if (typeof code !== 'string') return null;
  const candidate = code.trim().toUpperCase();
  if (candidate.length !== 3 || !/^[A-Z]+$/.test(candidate)) return null;
  return candidate;
}

function toMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const t = Date.parse(value);
    if (!Number.isFinite(t)) throw new Error('invalid timestamp: ' + value);
    return t;
  }
  throw new Error('unsupported timestamp value');
}

function isoZ(value) {
  return new Date(toMs(value)).toISOString().replace(/\.000Z$/, 'Z');
}

// ---------------------------------------------------------------------------
// Dimension derivation (mirrors Python availability_of/coverage_of/...)
// ---------------------------------------------------------------------------

function availabilityOf(item) {
  const status = item.status;
  if (USABLE_STATUSES.has(status)) return AVAILABILITY_AVAILABLE;
  if (PARTIAL_STATUSES.has(status)) return AVAILABILITY_PARTIAL;
  if (UNAUTHORIZED_STATUSES.has(status)) return AVAILABILITY_UNAUTHORIZED;
  if (UNSUPPORTED_STATUSES.has(status)) return AVAILABILITY_UNSUPPORTED;
  if (NOT_SYNCED_STATUSES.has(status)) return AVAILABILITY_NOT_SYNCED;
  if (RETRIEVAL_FAILED_STATUSES.has(status)) return AVAILABILITY_RETRIEVAL_FAILED;
  return AVAILABILITY_UNAVAILABLE;
}

function coverageOf(item) {
  const coverage = item.coverage || {};
  const status = coverage.status;
  const periodStatus = coverage.period_status;
  if (periodStatus === 'not_applicable') return COVERAGE_NOT_APPLICABLE;
  if (status === 'complete' && coverage.complete === true) return COVERAGE_COMPLETE;
  if (status === 'partial') return COVERAGE_PARTIAL;
  return COVERAGE_UNKNOWN;
}

function freshnessOf(item) {
  const freshness = item.freshness || {};
  const state = freshness.state;
  const status = item.status;
  if (RETRIEVAL_FAILED_STATUSES.has(status)) return FRESH_FAILED;
  if (FRESHNESS.includes(state)) return state;
  if (NOT_SYNCED_STATUSES.has(status)) return FRESH_NEVER;
  return FRESH_UNKNOWN;
}

function valueStateOf(item) {
  const unit = item.unit;
  if (unit === 'record' || unit === 'reference') return VALUE_NOT_APPLICABLE;
  const value = item.value;
  const status = item.status;
  const coverage = item.coverage || {};
  const parsed = parseDecimal(value);
  const isZero = parsed !== null && compareDecimals(parsed, parseDecimal(0)) === 0;

  if (status === 'verified_zero' ||
      (isZero && coverage.complete === true && coverage.status === 'complete')) {
    return VALUE_VERIFIED_ZERO;
  }
  if (value === null || value === undefined) {
    if (['unauthorized', 'consent_unavailable', 'not_synchronized',
         'retrieval_failed', 'storage_failure', 'pending', 'unsupported'].includes(status)) {
      return VALUE_MISSING;
    }
    return USABLE_STATUSES.has(status) ? VALUE_NULL : VALUE_UNKNOWN;
  }
  if (isZero) return VALUE_UNKNOWN;
  return VALUE_OBSERVED_NONZERO;
}

function consistencyOf(item) {
  const status = item.status;
  if (status === 'contradictory') return CONFLICTING;
  if (USABLE_STATUSES.has(status)) return CONSISTENT;
  return UNVERIFIED;
}

function currencyIntegrityOf(item) {
  if (item.unit !== 'currency') return CURRENCY_NOT_APPLICABLE;
  const currency = normalizeCurrency(item.currency);
  if (currency === null) return CURRENCY_UNKNOWN;
  return CURRENCY_SINGLE;
}

function sufficiency(dimensions, { currentClaim = true } = {}) {
  const reasons = [];
  const { availability, coverage, freshness, value_state: value, consistency, currency_integrity: currency } = dimensions;

  if ([AVAILABILITY_UNAVAILABLE, AVAILABILITY_UNAUTHORIZED, AVAILABILITY_UNSUPPORTED,
       AVAILABILITY_NOT_SYNCED, AVAILABILITY_RETRIEVAL_FAILED].includes(availability)) {
    return [UNAVAILABLE, [`source_${availability}`]];
  }
  if (value === VALUE_MISSING) reasons.push('value_missing');
  if (value === VALUE_UNKNOWN) reasons.push('value_unknown');
  if (coverage === COVERAGE_PARTIAL) reasons.push('partial_coverage');
  else if (coverage === COVERAGE_UNKNOWN) reasons.push('coverage_unknown');
  if (consistency === CONFLICTING) reasons.push('conflicting_evidence');
  if (currency === CURRENCY_MIXED) reasons.push('mixed_currencies_not_comparable');
  else if (currency === CURRENCY_UNKNOWN) reasons.push('currency_unknown');

  if (currentClaim) {
    if ([FRESH_STALE, FRESH_FAILED, FRESH_NEVER].includes(freshness)) {
      reasons.push(`${freshness}_for_current_claim`);
    } else if (freshness === FRESH_SYNCHRONIZING) {
      reasons.push('synchronizing_for_current_claim');
    }
  }

  if (reasons.length === 0) return [SUFFICIENT, []];
  if ((value === VALUE_MISSING || value === VALUE_UNKNOWN) && coverage !== COVERAGE_COMPLETE) {
    return [INSUFFICIENT, reasons];
  }
  if (availability === AVAILABILITY_PARTIAL) return [INSUFFICIENT, reasons];
  return [PARTIAL, reasons];
}

function qualityOf(item, { currentClaim = true } = {}) {
  const dimensions = {
    availability: availabilityOf(item),
    coverage: coverageOf(item),
    freshness: freshnessOf(item),
    value_state: valueStateOf(item),
    consistency: consistencyOf(item),
    currency_integrity: currencyIntegrityOf(item),
  };
  const [verdict, reasons] = sufficiency(dimensions, { currentClaim });
  return {
    schema_version: QUALITY_SCHEMA_VERSION,
    ...dimensions,
    sufficiency: verdict,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// A. Currency safety (Task 207)
// ---------------------------------------------------------------------------

function aggregateCurrency(values) {
  const buckets = new Map();
  const unknown = [];
  const malformed = [];
  for (const entry of values || []) {
    const currency = normalizeCurrency(entry.currency);
    const amount = parseDecimal(entry.amount);
    if (currency === null) {
      unknown.push({ amount: amount === null ? null : formatDecimal(amount), source: entry.source ?? null });
      continue;
    }
    if (amount === null) {
      malformed.push({ currency, source: entry.source ?? null });
      continue;
    }
    let bucket = buckets.get(currency);
    if (!bucket) { bucket = { total: parseDecimal(0), count: 0 }; buckets.set(currency, bucket); }
    bucket.total = addDecimals(bucket.total, amount);
    bucket.count += 1;
  }

  const currencies = {};
  for (const code of [...buckets.keys()].sort()) {
    const bucket = buckets.get(code);
    currencies[code] = { total: formatDecimal(quantize(bucket.total, -2)), count: bucket.count };
  }
  const mixed = Object.keys(currencies).length > 1;
  let combined = null;
  if (Object.keys(currencies).length === 1 && unknown.length === 0 && malformed.length === 0) {
    combined = Object.values(currencies)[0].total;
  }
  let reason;
  if (malformed.length > 0) reason = 'one or more amounts are not numeric; the total is not reliable';
  else if (mixed) reason = 'amounts span multiple currencies and must not be combined';
  else if (unknown.length > 0) reason = 'one or more amounts have an unknown or invalid currency';
  else if (Object.keys(currencies).length === 0) reason = 'no currency-attributed amounts were provided';
  else reason = 'single verified currency';

  return {
    currencies,
    unknown_currency_amounts: unknown,
    malformed_amounts: malformed,
    mixed,
    combined,
    usable: combined !== null,
    reason,
  };
}

function compareCurrency(a, b, conversion = null) {
  const currencyA = normalizeCurrency(a.currency);
  const currencyB = normalizeCurrency(b.currency);
  const amountA = parseDecimal(a.amount);
  const amountB = parseDecimal(b.amount);
  const base = {
    a: { amount: amountA === null ? null : formatDecimal(amountA), currency: currencyA },
    b: { amount: amountB === null ? null : formatDecimal(amountB), currency: currencyB },
  };
  if (amountA === null || amountB === null) {
    return { ...base, comparable: false, reason: 'one or both amounts are not numeric' };
  }
  if (currencyA === null || currencyB === null) {
    return { ...base, comparable: false, reason: 'unknown or invalid currency code' };
  }
  if (currencyA === currencyB) {
    const difference = subDecimals(amountA, amountB);
    return {
      ...base, comparable: true, basis: 'same_currency',
      difference: formatDecimal(quantize(difference, -2)),
      higher: compareDecimals(amountA, amountB) > 0 ? 'a'
        : compareDecimals(amountA, amountB) < 0 ? 'b' : 'equal',
    };
  }
  if (conversion === null) {
    return { ...base, comparable: false,
      reason: 'different currencies with no documented conversion; amounts are not directly comparable' };
  }
  const fromCode = normalizeCurrency(conversion.from_currency);
  const toCode = normalizeCurrency(conversion.to_currency);
  const rate = parseDecimal(conversion.rate);
  if (rate === null || compareDecimals(rate, parseDecimal(0)) <= 0 ||
      conversion.documented !== true || !conversion.source) {
    return { ...base, comparable: false, reason: 'conversion is not documented or lacks a positive rate' };
  }
  const pair = [fromCode, toCode].sort().join('|');
  const wanted = [currencyA, currencyB].sort().join('|');
  if (pair !== wanted) {
    return { ...base, comparable: false, reason: 'conversion does not cover the compared currency pair' };
  }
  // Rate convention: one unit of from_currency == `rate` units of to_currency.
  const comparableB = (toCode === currencyA && fromCode === currencyB)
    ? multiplyRate(amountB, rate)
    : divideByRate(amountB, rate);
  return {
    ...base, comparable: true, basis: 'explicit_conversion',
    conversion: {
      source: conversion.source,
      rate: formatDecimal(rate),
      from_currency: fromCode, to_currency: toCode,
      rate_at: conversion.rate_at ?? null,
    },
    difference: formatDecimal(quantize(subDecimals(amountA, comparableB), -2)),
    higher: compareDecimals(amountA, comparableB) > 0 ? 'a'
      : compareDecimals(amountA, comparableB) < 0 ? 'b' : 'equal',
  };
}

// Multiply a decimal by another decimal rate (exact, via string scaling).
function multiplyRate(amount, rate) {
  // value = a.digits*10^a.exp * r.digits*10^r.exp
  const total = BigInt(amount.digits) * BigInt(rate.digits);
  return { sign: amount.sign * rate.sign, digits: total.toString(), exp: amount.exp + rate.exp };
}

function divideByRate(amount, rate) {
  return divideTo(amount, rate, 12);
}

// ---------------------------------------------------------------------------
// B. Zero vs missing (Task 208)
// ---------------------------------------------------------------------------

function classifyZeroValue(context = {}) {
  const value = context.value;
  const amount = parseDecimal(value);
  const kind = context.kind || 'amount';
  const coverageComplete = context.coverage_complete === true;
  const authorized = context.authorized === true;
  const syncState = context.sync_state;
  const queried = context.queried;
  const recordsFound = context.records_found;

  if (!authorized) {
    return { state: 'unauthorized_or_unavailable', verified_zero: false,
      explanation: 'The source is not authorized, so no population was queried; zero must not be claimed.' };
  }
  if (syncState === 'failed' || queried === false) {
    return { state: 'failed_or_incomplete_sync', verified_zero: false,
      explanation: 'The source failed to synchronize or was not queried; the absence of rows is not evidence of zero.' };
  }
  if (syncState === 'never') {
    return { state: 'failed_or_incomplete_sync', verified_zero: false,
      explanation: 'The source has never synchronized; its population is unknown.' };
  }
  if (context.value_is_null_field || (amount === null && recordsFound)) {
    return { state: 'null_field', verified_zero: false,
      explanation: 'Records exist but the value field is unpopulated; a null is not a zero.' };
  }
  if (amount === null) {
    return { state: 'missing_record', verified_zero: false,
      explanation: 'No value could be read from the source.' };
  }
  if (compareDecimals(amount, parseDecimal(0)) !== 0) {
    return { state: 'observed_nonzero', verified_zero: false,
      explanation: 'A non-zero value was observed.' };
  }
  if (!coverageComplete) {
    return { state: 'incomplete_coverage', verified_zero: false,
      explanation: 'The observed zero is over an incomplete population, so it cannot be certified as a true zero.' };
  }
  if (kind === 'count' && !recordsFound) {
    return { state: 'no_match_verified_population', verified_zero: true,
      explanation: 'The fully-queried population contains no matching records; this is a verified zero count.' };
  }
  return { state: 'verified_zero', verified_zero: true,
    explanation: 'The value is zero over a certified complete population; the zero is genuine.' };
}

function safeRatio(numerator, denominator) {
  const num = parseDecimal(numerator);
  const den = parseDecimal(denominator);
  if (num === null || den === null) return { ok: false, value: null, reason: 'missing_numerics' };
  if (compareDecimals(den, parseDecimal(0)) === 0) {
    return { ok: false, value: null, reason: 'zero_denominator', note: ZERO_DENOMINATOR_NOTE };
  }
  const value = divideTo(num, den, 12);
  return { ok: true, value: Number(formatDecimal(quantize(value, -6))), reason: null };
}

function safePercentChange(current, previous) {
  const cur = parseDecimal(current);
  const prev = parseDecimal(previous);
  if (cur === null || prev === null) return { ok: false, percent: null, reason: 'missing_values' };
  if (compareDecimals(prev, parseDecimal(0)) <= 0) {
    return { ok: false, percent: null, reason: 'zero_or_nonpositive_baseline', note: ZERO_DENOMINATOR_NOTE };
  }
  const change = divideTo(subDecimals(cur, prev), prev, 12);
  const percent = quantize(multiplyInt(change, 100), -1);
  return { ok: true, percent: formatDecimal(percent), reason: null };
}

// ---------------------------------------------------------------------------
// C. Source-specific freshness (Task 210)
// ---------------------------------------------------------------------------

function evaluateFreshness({
  asOf = null, lastSuccessfulSync = null, now, policySeconds,
  syncState = null, question = 'current', period = null,
}) {
  const nowMs = toMs(now);
  const policy = Math.max(0, Number(policySeconds));

  if (syncState === 'synchronizing') {
    return { state: FRESH_SYNCHRONIZING, age_seconds: null, supports_current_claim: false,
      supports_historical_claim: false, reason: 'synchronization is in progress' };
  }
  if (syncState === 'failed') {
    return { state: FRESH_FAILED, age_seconds: null, supports_current_claim: false,
      supports_historical_claim: false, reason: "the source's latest synchronization failed" };
  }
  if (asOf === null && lastSuccessfulSync === null) {
    return { state: FRESH_NEVER, age_seconds: null, supports_current_claim: false,
      supports_historical_claim: false, reason: 'the source has never synchronized' };
  }

  const reference = asOf !== null ? asOf : lastSuccessfulSync;
  const ageSeconds = Math.max(0, (nowMs - toMs(reference)) / 1000);
  let state;
  if (policy === 0) state = FRESH_FRESH;
  else if (ageSeconds <= policy) state = FRESH_FRESH;
  else if (ageSeconds <= policy * 2) state = FRESH_AGING;
  else state = FRESH_STALE;

  const supportsCurrent = (state === FRESH_FRESH || state === FRESH_AGING) && syncState !== 'failed';
  let supportsHistorical = false;
  if (question === 'historical' && period && period.start) {
    supportsHistorical = toMs(reference) >= toMs(period.start) && state !== FRESH_FAILED;
  }

  let reason;
  if (state === FRESH_STALE) {
    reason = `latest observation is ${Math.trunc(ageSeconds)}s old (policy ${Math.trunc(policy)}s); ` +
      'too old to support a current-state claim';
  } else if (state === FRESH_AGING) {
    reason = `evidence is aging (${Math.trunc(ageSeconds)}s old, policy ${Math.trunc(policy)}s)`;
  } else {
    reason = `evidence is fresh (${Math.trunc(ageSeconds)}s old, policy ${Math.trunc(policy)}s)`;
  }
  return {
    state, age_seconds: ageSeconds,
    as_of: isoZ(reference),
    policy_seconds: policy,
    supports_current_claim: supportsCurrent,
    supports_historical_claim: supportsHistorical,
    reason,
  };
}

// ---------------------------------------------------------------------------
// D. Contradiction detection and resolution (Task 211)
// ---------------------------------------------------------------------------

function detectContradictions(items, sourceOfTruth = null) {
  const list = Array.isArray(items) ? items : [];
  const groups = new Map();
  for (const item of list) {
    if (item.unit !== 'currency' && item.unit !== 'count' && item.unit !== 'ratio') continue;
    const value = _numeric(item.value);
    if (value === null) continue;
    const period = item.period || {};
    const currency = item.unit === 'currency' ? normalizeCurrency(item.currency) : null;
    const key = [
      item.metric, period.start, period.end, currency, item.unit,
      [...(item.store_ids || [])].sort().join('\u0000'),
    ].join('\u0001');
    if (!groups.has(key)) groups.set(key, { parts: [item.metric, period.start, period.end, currency, item.unit], items: [] });
    groups.get(key).items.push(item);
  }

  const conflicts = [];
  for (const group of groups.values()) {
    const distinctValues = new Set(group.items.map((i) => formatDecimal(_numeric(i.value))));
    if (group.items.length < 2 || distinctValues.size < 2) continue;

    const metric = group.parts[0];
    let resolution = null;
    let winner = null;
    let winnerValue = null;
    let reason = null;
    let resolved = false;

    const authority = (sourceOfTruth || {})[metric];
    if (authority) {
      winner = group.items.find((i) =>
        (i.source && i.source.resource === authority) || i.domain === authority) || null;
    }
    if (winner === null) {
      const fresh = group.items.filter((i) => [FRESH_FRESH, FRESH_AGING].includes(freshnessOf(i)));
      const stale = group.items.filter((i) => freshnessOf(i) === FRESH_STALE);
      if (fresh.length === 1 && stale.length >= 1) winner = fresh[0];
    }
    if (winner !== null) {
      resolved = true;
      winnerValue = _numeric(winner.value);
      resolution = authority ? 'source_of_truth' : 'recency_supersession';
      reason = authority
        ? `resolved to the authoritative record for '${metric}'`
        : 'the fresh current record supersedes the stale one';
    } else {
      resolution = 'unresolved';
      reason = 'no documented source-of-truth and no unambiguous supersedence; ' +
        'the conflict is preserved and the conclusion must stay uncertain';
    }

    const values = [...distinctValues]
      .map((s) => parseDecimal(s))
      .sort((x, y) => compareDecimals(x, y))
      .map((d) => formatDecimal(d));

    conflicts.push({
      metric,
      period: { start: group.parts[1], end: group.parts[2] },
      currency: group.parts[3],
      unit: group.parts[4],
      values,
      resolved,
      resolution,
      winner_id: winner ? winner.id : null,
      winner_value: winnerValue === null ? null : formatDecimal(winnerValue),
      reason,
      confidence_impact: resolved ? 'none' : 'reduce',
      contradictory: true,
    });
  }
  return conflicts;
}

// ---------------------------------------------------------------------------
// Collection-level rollup
// ---------------------------------------------------------------------------

function currencyIntegrityOfCollection(items, { conversion = null } = {}) {
  const currencies = new Set();
  for (const item of items || []) {
    if (item.unit !== 'currency') continue;
    const currency = normalizeCurrency(item.currency);
    if (currency === null) return CURRENCY_UNKNOWN;
    currencies.add(currency);
  }
  if (currencies.size === 0) return CURRENCY_NOT_APPLICABLE;
  if (currencies.size === 1) return CURRENCY_COMPATIBLE;
  if (conversion !== null && conversion.documented) return CURRENCY_CONVERTED;
  return CURRENCY_MIXED;
}

function qualityOfCollection(items, { currentClaim = true } = {}) {
  const list = Array.isArray(items) ? items : [];
  const perItem = [];
  const worstRank = { [SUFFICIENT]: 0, [PARTIAL]: 1, [INSUFFICIENT]: 2, [UNAVAILABLE]: 3 };
  let worst = SUFFICIENT;
  const reasons = new Set();
  for (const item of list) {
    const quality = qualityOf(item, { currentClaim });
    perItem.push({ id: item.id, ...quality });
    if (worstRank[quality.sufficiency] > worstRank[worst]) worst = quality.sufficiency;
    for (const r of quality.reasons) reasons.add(r);
  }
  return {
    schema_version: QUALITY_SCHEMA_VERSION,
    item_count: list.length,
    currency_integrity: currencyIntegrityOfCollection(items),
    overall_sufficiency: worst,
    reasons: [...reasons].sort(),
    items: perItem,
  };
}

module.exports = {
  QUALITY_SCHEMA_VERSION,
  AVAILABILITY, AVAILABILITY_AVAILABLE, AVAILABILITY_PARTIAL, AVAILABILITY_UNAVAILABLE,
  AVAILABILITY_UNAUTHORIZED, AVAILABILITY_UNSUPPORTED, AVAILABILITY_NOT_SYNCED,
  AVAILABILITY_RETRIEVAL_FAILED,
  COVERAGE, COVERAGE_COMPLETE, COVERAGE_PARTIAL, COVERAGE_UNKNOWN, COVERAGE_NOT_APPLICABLE,
  FRESHNESS, FRESH_FRESH, FRESH_AGING, FRESH_STALE, FRESH_UNKNOWN,
  FRESH_SYNCHRONIZING, FRESH_FAILED, FRESH_NEVER,
  VALUE_STATE, VALUE_OBSERVED_NONZERO, VALUE_VERIFIED_ZERO, VALUE_NULL, VALUE_MISSING,
  VALUE_NOT_APPLICABLE, VALUE_UNKNOWN,
  CONSISTENCY, CONSISTENT, CONFLICTING, UNVERIFIED,
  CURRENCY_INTEGRITY, CURRENCY_SINGLE, CURRENCY_COMPATIBLE, CURRENCY_CONVERTED,
  CURRENCY_MIXED, CURRENCY_UNKNOWN, CURRENCY_NOT_APPLICABLE,
  SUFFICIENCY, SUFFICIENT, PARTIAL, INSUFFICIENT, UNAVAILABLE,
  availabilityOf, coverageOf, freshnessOf, valueStateOf, consistencyOf,
  currencyIntegrityOf, sufficiency, qualityOf, qualityOfCollection,
  currencyIntegrityOfCollection,
  aggregateCurrency, compareCurrency, classifyZeroValue,
  safeRatio, safePercentChange, evaluateFreshness, detectContradictions,
  // exposed for tests / parity tooling:
  _parseDecimal: parseDecimal, _formatDecimal: formatDecimal,
};
