'use strict';

/**
 * Founding Merchants application: answer catalogue, normalisation, per-step
 * validation, resume-token helpers and the public view returned to the page.
 *
 * Pure functions only (no database, no request objects), so the same rules are
 * unit-tested directly and enforced identically by every endpoint. The option
 * keys here are the contract with Frontend/Landing/src/waitlist/schema.ts.
 */

const crypto = require('node:crypto');

const STATUSES = Object.freeze(['in_progress', 'submitted', 'reviewed', 'accepted', 'rejected']);

// Step numbers: 1-3 are the question steps, 4 is the review screen.
const REVIEW_STEP = 4;

const OPTIONS = Object.freeze({
  store_age: ['lt_3m', '3_6m', '6_12m', '1_3y', '3y_plus'],
  monthly_orders: ['0_20', '21_100', '101_500', '501_2000', '2000_plus'],
  challenges: [
    'browse_no_purchase',
    'cart_abandonment',
    'declining_sales',
    'operational_inefficiency',
    'inventory_availability',
    'unclear_whats_wrong',
    'prioritization',
    'other',
  ],
  problem_discovery: ['shopify_analytics', 'other_analytics', 'tools_spreadsheets', 'manual', 'after_sales_affected', 'no_process'],
  price_willingness: ['free', 'usd_19', 'usd_29', 'usd_49', 'usd_79', 'usd_99', 'usd_149', 'usd_199', 'usd_299', 'usd_500_plus'],
  capabilities: [
    'revenue_leaks',
    'why_not_purchasing',
    'checkout_cart',
    'unusual_changes',
    'inventory_risks',
    'prioritized_recommendations',
    'monitoring_improvement',
  ],
  founding_interest: ['yes', 'maybe', 'not_now'],
});

const MAX_CAPABILITIES = 3;

const RESUME_COOKIE = 'rv_wl_session';
const RESUME_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, renewed on every visit
const START_REPLAY_WINDOW_MS = 15 * 60 * 1000; // a lost "start" response can be replayed for 15 minutes
const RESUME_CODE_TTL_MS = 15 * 60 * 1000;
const RESUME_CODE_MAX_ATTEMPTS = 5;
const RESUME_CODE_RESEND_MS = 60 * 1000;

// ── Normalisers ─────────────────────────────────────────────────────────────

const UNSAFE_TEXT = /[<>\u0000-\u001f\u007f]/;

function cleanText(value, { min = 1, max = 120 } = {}) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length < min || text.length > max) return null;
  if (UNSAFE_TEXT.test(text)) return null;
  return text;
}

function normaliseEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254) return null;
  // One @, a non-empty local part, and a dotted domain with an alphabetic TLD.
  if (!/^[^\s@<>()[\]\\,;:"]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,63}$/.test(email)) return null;
  if (email.split('@')[0].length > 64) return null;
  return email;
}

/**
 * Phone / WhatsApp in any common international format: "+234 801 234 5678",
 * "00 44 20 7946 0958", "(415) 555-0100". Kept as digits with a leading "+"
 * when the number was international (a "+" or "00" prefix). 7-15 digits (E.164).
 */
function normalisePhone(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return undefined;
  const raw = value.trim();
  if (!raw) return null;
  if (!/^[+\d\s().\-/]+$/.test(raw)) return undefined;
  const international = raw.startsWith('+') || /^00/.test(raw.replace(/[^\d+]/g, ''));
  let digits = raw.replace(/\D/g, '');
  if (!raw.startsWith('+') && digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length < 7 || digits.length > 15) return undefined;
  return international ? `+${digits}` : digits;
}

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Shopify store address, without OAuth. Accepts a myshopify.com address, the
 * store handle on its own ("acme" -> acme.myshopify.com), a Shopify admin URL
 * (admin.shopify.com/store/acme) or the store's custom domain. Returns
 * "https://host" with no path, query, port or "www.", or null.
 */
function normaliseShopifyUrl(value) {
  if (typeof value !== 'string') return null;
  let input = value.trim().toLowerCase();
  if (!input || input.length > 300) return null;
  input = input.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');

  const admin = input.match(/^admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)/);
  if (admin) input = `${admin[1]}.myshopify.com`;

  let host = input.replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/\.$/, '');
  if (host.includes('@')) return null;
  if (host.startsWith('www.')) host = host.slice(4);
  if (!host.includes('.')) {
    if (!/^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$/.test(host)) return null;
    host = `${host}.myshopify.com`;
  }
  if (host.length > 253) return null;
  const labels = host.split('.');
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return null;
  if (!/^[a-z]{2,63}$/.test(labels[labels.length - 1])) return null;
  if (host.endsWith('.myshopify.com') && labels.length !== 3) return null;
  if (host.includes('myshopify.com') && !host.endsWith('.myshopify.com')) return null;
  if (host === 'myshopify.com' || host === 'shopify.com' || host.endsWith('.shopify.com')) return null;
  return `https://${host}`;
}

// Public share codes look like "RV-4F8A2B" (see waitlistController).
function normaliseReferralCode(value) {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z0-9-]{4,20}$/.test(code) ? code : null;
}

// ── Step validation ─────────────────────────────────────────────────────────

function oneOf(list, value) {
  return typeof value === 'string' && list.includes(value) ? value : null;
}

function manyOf(list, value, { min = 1, max = list.length } = {}) {
  if (!Array.isArray(value)) return null;
  const picked = [];
  for (const item of value) {
    if (typeof item !== 'string' || !list.includes(item)) return null;
    if (!picked.includes(item)) picked.push(item);
  }
  if (picked.length < min || picked.length > max) return null;
  // Stored in catalogue order, so the same choices always read the same.
  return list.filter((item) => picked.includes(item));
}

function result(errors, data) {
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, data };
}

/** Step 1 — About your store. Body uses the page's field names. */
function validateStep1(body = {}) {
  const errors = {};
  const full_name = cleanText(body.full_name, { min: 2, max: 120 });
  if (!full_name) errors.full_name = 'Enter your full name.';
  const work_email = normaliseEmail(body.work_email);
  if (!work_email) errors.work_email = 'Enter a valid work email, like you@yourstore.com.';
  const store_name = cleanText(body.store_name, { min: 1, max: 120 });
  if (!store_name) errors.store_name = 'Enter your brand or store name.';
  const store_url = normaliseShopifyUrl(body.store_url);
  if (!store_url) errors.store_url = 'Enter your Shopify store address, like yourstore.myshopify.com.';
  const phone = normalisePhone(body.phone);
  if (phone === undefined) errors.phone = 'Enter a phone or WhatsApp number with 7 to 15 digits, or leave it empty.';
  const store_age = oneOf(OPTIONS.store_age, body.store_age);
  if (!store_age) errors.store_age = 'Choose how long your store has been running.';
  const monthly_orders = oneOf(OPTIONS.monthly_orders, body.monthly_orders);
  if (!monthly_orders) errors.monthly_orders = 'Choose your typical monthly orders.';
  return result(errors, { full_name, work_email, store_name, store_url, phone: phone || null, store_age, monthly_orders });
}

/** Step 2 — Your challenges. */
function validateStep2(body = {}) {
  const errors = {};
  const challenges = manyOf(OPTIONS.challenges, body.challenges);
  if (!challenges) errors.challenges = 'Choose at least one challenge.';
  let challenge_other = null;
  if (challenges && challenges.includes('other') && body.challenge_other !== undefined && body.challenge_other !== null && body.challenge_other !== '') {
    challenge_other = cleanText(body.challenge_other, { min: 1, max: 300 });
    if (!challenge_other) errors.challenge_other = 'Keep it under 300 characters, without < or >.';
  }
  const problem_discovery = oneOf(OPTIONS.problem_discovery, body.problem_discovery);
  if (!problem_discovery) errors.problem_discovery = 'Choose how you usually find problems.';
  return result(errors, { challenges, challenge_other, problem_discovery });
}

/** Step 3 — Pricing, priorities and Founding Merchant interest. */
function validateStep3(body = {}) {
  const errors = {};
  const price_willingness = oneOf(OPTIONS.price_willingness, body.price_willingness);
  if (!price_willingness) errors.price_willingness = 'Choose what you would pay each month.';
  let capabilities = null;
  if (Array.isArray(body.capabilities) && new Set(body.capabilities).size > MAX_CAPABILITIES) {
    errors.capabilities = `Choose up to ${MAX_CAPABILITIES}.`;
  } else {
    capabilities = manyOf(OPTIONS.capabilities, body.capabilities, { min: 1, max: MAX_CAPABILITIES });
    if (!capabilities) errors.capabilities = `Choose between 1 and ${MAX_CAPABILITIES} capabilities.`;
  }
  const founding_interest = oneOf(OPTIONS.founding_interest, body.founding_interest);
  if (!founding_interest) errors.founding_interest = 'Let us know if you would like to take part.';
  return result(errors, { price_willingness, capabilities, founding_interest });
}

const STEP_VALIDATORS = { 1: validateStep1, 2: validateStep2, 3: validateStep3 };

// Database columns for each step's validated answers.
function stepColumns(step, data) {
  if (step === 1) {
    return {
      full_name: data.full_name,
      work_email: data.work_email,
      company_name: data.store_name,
      store_url: data.store_url,
      phone_number: data.phone,
      store_age: data.store_age,
      monthly_order_volume: data.monthly_orders,
    };
  }
  if (step === 2) {
    return { challenges: data.challenges, challenge_other: data.challenge_other, problem_discovery: data.problem_discovery };
  }
  return {
    price_willingness: data.price_willingness,
    valuable_capabilities: data.capabilities,
    founding_interest: data.founding_interest,
    // Kept in step with the legacy beta flag read by the lead dashboard.
    interested_in_beta: data.founding_interest !== 'not_now',
  };
}

// The page's view of a stored row (field names match the form).
function answersOf(row) {
  return {
    full_name: row.full_name || '',
    work_email: row.work_email || '',
    store_name: row.company_name || '',
    store_url: row.store_url || '',
    phone: row.phone_number || '',
    store_age: row.store_age || null,
    monthly_orders: row.monthly_order_volume || null,
    challenges: Array.isArray(row.challenges) ? row.challenges : [],
    challenge_other: row.challenge_other || '',
    problem_discovery: row.problem_discovery || null,
    price_willingness: row.price_willingness || null,
    capabilities: Array.isArray(row.valuable_capabilities) ? row.valuable_capabilities : [],
    founding_interest: row.founding_interest || null,
  };
}

/** First step whose stored answers do not validate, or null when complete. */
function firstIncompleteStep(row) {
  const answers = answersOf(row);
  for (const step of [1, 2, 3]) {
    if (!STEP_VALIDATORS[step](answers).ok) return step;
  }
  return null;
}

/** What the page may see. No ids, token hashes, IPs or internal scores. */
function publicView(row) {
  const submitted = row.status !== 'in_progress';
  return {
    status: row.status,
    current_step: submitted ? REVIEW_STEP : Math.min(Math.max(Number(row.current_step) || 1, 1), REVIEW_STEP),
    submitted_at: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    referred: Boolean(row.referred_by_code),
    queue_position: submitted && row.waitlist_position ? row.waitlist_position : null,
    referral_code: submitted && row.referral_code ? row.referral_code : null,
    answers: answersOf(row),
  };
}

// ── Tokens ──────────────────────────────────────────────────────────────────

function newResumeToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * The first session token for a start request carrying an Idempotency-Key is
 * derived from that key with a server secret, so every retry or duplicate of
 * the same first save hands back the same cookie (no race between duplicate
 * responses). It is replaced by a random token on the next visit (resume).
 */
function startToken(keyHash, secret = process.env.COOKIE_SECRET || process.env.JWT_SECRET || '') {
  return crypto.createHmac('sha256', `waitlist-start:${secret}`).update(String(keyHash)).digest('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function isWellFormedToken(token) {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
}

function isWellFormedIdempotencyKey(key) {
  return typeof key === 'string' && /^[A-Za-z0-9-]{16,64}$/.test(key);
}

function newResumeCode() {
  return String(crypto.randomInt(100000, 1000000));
}

// Six digits are short, so the stored form is keyed by a server secret and
// bound to the application: a leaked row cannot be reversed offline.
function hashResumeCode(code, applicationId, secret = process.env.COOKIE_SECRET || process.env.JWT_SECRET || '') {
  return crypto.createHmac('sha256', String(secret)).update(`${applicationId}:${code}`).digest('hex');
}

function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

module.exports = {
  STATUSES,
  REVIEW_STEP,
  OPTIONS,
  MAX_CAPABILITIES,
  RESUME_COOKIE,
  RESUME_TTL_MS,
  START_REPLAY_WINDOW_MS,
  RESUME_CODE_TTL_MS,
  RESUME_CODE_MAX_ATTEMPTS,
  RESUME_CODE_RESEND_MS,
  cleanText,
  normaliseEmail,
  normalisePhone,
  normaliseShopifyUrl,
  normaliseReferralCode,
  validateStep1,
  validateStep2,
  validateStep3,
  STEP_VALIDATORS,
  stepColumns,
  answersOf,
  firstIncompleteStep,
  publicView,
  newResumeToken,
  startToken,
  hashToken,
  isWellFormedToken,
  isWellFormedIdempotencyKey,
  newResumeCode,
  hashResumeCode,
  safeEqualHex,
};
