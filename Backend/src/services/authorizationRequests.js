'use strict';

/**
 * Capability authorization requests: the permission manager's durable memory.
 *
 * When a capability needs a Shopify scope the installation lacks, Revluma
 * records *why* (which capability, which scopes, what triggered it, what to
 * resume) before sending the merchant to Shopify. The OAuth callback resolves
 * the request from Shopify's verified answer, never from the redirect alone:
 *
 *   pending  → approved   all requested scopes are now granted
 *   pending  → declined   merchant cancelled, or Shopify returned without them
 *   pending  → expired    the merchant never completed the flow
 *   pending  → superseded the scope was granted some other way
 *
 * Invariants
 * - At most one pending request per store + capability (unique pending_key).
 * - A request is never created for a capability that is already granted,
 *   unsupported or plan-restricted: Revluma never asks for what it already
 *   has or for what Shopify cannot grant.
 * - Only read scopes are ever requested (permissionRegistry enforces this).
 */

const logger = require('../utils/logger');
const permissions = require('./permissionRegistry');

const REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TRIGGERS = Object.freeze(['merchant', 'rev_investigation', 'sync_engine', 'core_scope_missing']);
const MAX_RESUME_BYTES = 2048;

function defaultDb() {
  return require('../configs/database').prisma;
}

function pendingKey(storeId, capability) {
  return `${storeId}:${capability}`.slice(0, 160);
}

function safeResume(resume) {
  if (!resume || typeof resume !== 'object' || Array.isArray(resume)) return {};
  const allowed = {};
  if (typeof resume.surface === 'string' && ['rev', 'integrations'].includes(resume.surface)) allowed.surface = resume.surface;
  if (typeof resume.conversation_id === 'string' && /^[0-9a-f-]{36}$/i.test(resume.conversation_id)) {
    allowed.conversation_id = resume.conversation_id;
  }
  // The question is the merchant's own words, kept only to resume their own
  // investigation; bounded and never logged.
  if (typeof resume.question === 'string' && resume.question.trim()) allowed.question = resume.question.trim().slice(0, 1000);
  const json = JSON.stringify(allowed);
  return Buffer.byteLength(json) <= MAX_RESUME_BYTES ? allowed : {};
}

function publicRequest(row) {
  if (!row) return null;
  const capability = permissions.getCapability(row.capability);
  return {
    id: row.id,
    store_id: row.store_id,
    capability: row.capability,
    capability_label: capability?.label || row.capability,
    missing_scopes: row.missing_scopes || [],
    status: row.status,
    trigger: row.trigger,
    explanation: row.explanation,
    created_at: row.created_at,
    expires_at: row.expires_at,
    resolved_at: row.resolved_at,
    resolution_detail: row.resolution_detail,
    resume: row.resume && typeof row.resume === 'object'
      ? { surface: row.resume.surface || null, conversation_id: row.resume.conversation_id || null }
      : { surface: null, conversation_id: null },
  };
}

/**
 * Ensure a pending request exists for each capability that genuinely needs
 * one. Returns { requests, not_needed, refused } — `refused` carries the
 * honest reason (unsupported / plan_restricted / unknown_capability).
 */
async function ensureRequests({ db = defaultDb(), store, capabilities, trigger = 'merchant', requestedBy = null, resume = {}, now = new Date() }) {
  if (!store?.id || !store?.organization_id) throw new TypeError('ensureRequests requires a store');
  if (!TRIGGERS.includes(trigger)) throw new TypeError(`unknown authorization trigger: ${trigger}`);
  const requests = [];
  const notNeeded = [];
  const refused = [];
  for (const id of [...new Set(capabilities || [])].slice(0, 12)) {
    const evaluation = permissions.evaluateCapability(id, store.granted_scopes);
    if (!evaluation) { refused.push({ capability: id, reason: 'unknown_capability' }); continue; }
    if (evaluation.state === 'granted') { notNeeded.push(id); continue; }
    if (!evaluation.requestable) {
      refused.push({ capability: id, reason: evaluation.state, explanation: evaluation.unavailable_reason });
      continue;
    }
    const key = pendingKey(store.id, id);
    const data = {
      missing_scopes: evaluation.missing_scopes,
      trigger,
      explanation: evaluation.explanation,
      resume: safeResume(resume),
      requested_by: requestedBy,
      expires_at: new Date(now.getTime() + REQUEST_TTL_MS),
    };
    let row = await db.authorization_requests.findUnique({ where: { pending_key: key } });
    if (row) {
      row = await db.authorization_requests.update({ where: { id: row.id }, data });
    } else {
      try {
        row = await db.authorization_requests.create({
          data: {
            store_id: store.id, organization_id: store.organization_id, capability: id,
            status: 'pending', pending_key: key, created_at: now, ...data,
          },
        });
      } catch (error) {
        if (error?.code !== 'P2002') throw error;
        row = await db.authorization_requests.findUnique({ where: { pending_key: key } });
      }
    }
    requests.push(row);
  }
  if (requests.length) {
    logger.info('authorization_requests_ensured', {
      store_id: store.id, trigger, capabilities: requests.map(row => row.capability),
    });
  }
  return { requests, not_needed: notNeeded, refused };
}

async function closeRequest(db, row, status, detail, now) {
  const result = await db.authorization_requests.updateMany({
    where: { id: row.id, status: 'pending' },
    data: { status, pending_key: null, resolved_at: now, resolution_detail: detail ? String(detail).slice(0, 120) : null },
  });
  return result.count === 1;
}

/**
 * Resolve every pending request for a store against Shopify's verified
 * granted scopes (from the OAuth callback or a live scope check).
 * Returns { approved: [...], declined: [...] } of public requests.
 */
async function resolveWithGrantedScopes({ db = defaultDb(), storeId, grantedScopes, viaOAuth = false, now = new Date() }) {
  const pending = await db.authorization_requests.findMany({ where: { store_id: storeId, status: 'pending' } });
  const approved = [];
  const declined = [];
  for (const row of pending) {
    const missing = (row.missing_scopes || []).filter(scope => !permissions.scopeSatisfied(permissions.parseScopes(grantedScopes), scope));
    if (missing.length === 0) {
      if (await closeRequest(db, row, viaOAuth ? 'approved' : 'superseded', viaOAuth ? 'scopes_granted' : 'granted_outside_request', now)) {
        approved.push(publicRequest({ ...row, status: viaOAuth ? 'approved' : 'superseded', resolved_at: now }));
      }
    } else if (viaOAuth) {
      // The merchant completed OAuth but Shopify did not grant the scope
      // (e.g. the app configuration does not allow it). Never loop back to
      // Shopify automatically; record it so it is not re-requested blindly.
      if (await closeRequest(db, row, 'declined', `not_granted:${missing.join(',')}`, now)) {
        declined.push(publicRequest({ ...row, status: 'declined', resolved_at: now }));
      }
    }
  }
  if (approved.length || declined.length) {
    logger.info('authorization_requests_resolved', {
      store_id: storeId, approved: approved.map(r => r.capability), declined: declined.map(r => r.capability),
    });
  }
  return { approved, declined };
}

/** The merchant cancelled on Shopify's consent screen. */
async function declinePending({ db = defaultDb(), storeId, reason = 'merchant_cancelled', now = new Date() }) {
  const pending = await db.authorization_requests.findMany({ where: { store_id: storeId, status: 'pending' } });
  let count = 0;
  for (const row of pending) {
    if (await closeRequest(db, row, 'declined', reason, now)) count += 1;
  }
  return count;
}

async function expireStaleRequests({ db = defaultDb(), now = new Date() } = {}) {
  const result = await db.authorization_requests.updateMany({
    where: { status: 'pending', expires_at: { lt: now } },
    data: { status: 'expired', pending_key: null, resolved_at: now, resolution_detail: 'not_completed' },
  });
  return result.count;
}

async function listForStore({ db = defaultDb(), storeId, limit = 20 }) {
  const rows = await db.authorization_requests.findMany({
    where: { store_id: storeId }, orderBy: { created_at: 'desc' }, take: Math.min(Math.max(1, limit), 50),
  });
  return rows.map(publicRequest);
}

async function pendingForStores({ db = defaultDb(), storeIds }) {
  if (!Array.isArray(storeIds) || storeIds.length === 0 || !db.authorization_requests?.findMany) return [];
  const rows = await db.authorization_requests.findMany({
    where: { store_id: { in: storeIds }, status: 'pending' }, orderBy: { created_at: 'desc' }, take: 100,
  });
  return rows.map(publicRequest);
}

module.exports = {
  REQUEST_TTL_MS,
  TRIGGERS,
  pendingKey,
  safeResume,
  publicRequest,
  ensureRequests,
  resolveWithGrantedScopes,
  declinePending,
  expireStaleRequests,
  listForStore,
  pendingForStores,
};
