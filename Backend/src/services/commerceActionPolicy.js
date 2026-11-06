'use strict';

const crypto = require('crypto');

const ACTION_PRODUCT_DESCRIPTION = 'product_update_description';
const PREVIEW_TTL_MS = 10 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRODUCT_GID_RE = /^gid:\/\/shopify\/Product\/[1-9][0-9]*$/;
const KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;
const MAX_DESCRIPTION_LENGTH = 100000;

class CommerceActionError extends Error {
  constructor(code, message, httpStatus = 409) {
    super(message);
    this.name = 'CommerceActionError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function assertActionInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new CommerceActionError('INVALID_ACTION_REQUEST', 'A JSON action request is required.', 400);
  if (body.action_type !== ACTION_PRODUCT_DESCRIPTION) throw new CommerceActionError('UNSUPPORTED_ACTION_TYPE', 'Only product_update_description is supported.', 400);
  if (!UUID_RE.test(String(body.store_id || ''))) throw new CommerceActionError('INVALID_STORE_ID', 'store_id must be a UUID.', 400);
  if (!PRODUCT_GID_RE.test(String(body.product_id || ''))) throw new CommerceActionError('INVALID_PRODUCT_ID', 'product_id must be a Shopify Product GID.', 400);
  if (typeof body.description !== 'string' || body.description.length > MAX_DESCRIPTION_LENGTH || body.description.includes('\u0000')) {
    throw new CommerceActionError('INVALID_DESCRIPTION', `description must be text of at most ${MAX_DESCRIPTION_LENGTH} characters without null bytes.`, 400);
  }
  if (!KEY_RE.test(String(body.idempotency_key || ''))) throw new CommerceActionError('INVALID_IDEMPOTENCY_KEY', 'idempotency_key must be 8–128 URL-safe characters.', 400);
  return { storeId: body.store_id, productId: body.product_id, description: body.description, idempotencyKey: body.idempotency_key };
}

function actionRequestHash(input) {
  return crypto.createHash('sha256').update(JSON.stringify({
    action_type: ACTION_PRODUCT_DESCRIPTION,
    store_id: input.storeId,
    product_id: input.productId,
    description: input.description,
  })).digest('hex');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function assertConfirmation(row, confirmationHash) {
  if (!row) throw new CommerceActionError('ACTION_NOT_FOUND', 'Commerce action not found.', 404);
  if (!safeEqual(confirmationHash, row.request_hash)) throw new CommerceActionError('CONFIRMATION_HASH_MISMATCH', 'The confirmation does not match the exact preview.', 400);
  if (row.status !== 'awaiting_confirmation') throw new CommerceActionError('ACTION_NOT_CONFIRMATION_READY', `Action status ${row.status} cannot be confirmed.`);
  if (!row.confirmation_expires_at || new Date(row.confirmation_expires_at).getTime() <= Date.now()) {
    throw new CommerceActionError('CONFIRMATION_EXPIRED', 'This preview expired. Create a fresh preview before continuing.');
  }
}

function assertCurrentDescription(product, expected, code = 'PRODUCT_CHANGED_SINCE_PREVIEW') {
  if (!product || String(product.description || '') !== String(expected || '')) {
    throw new CommerceActionError(code, 'The product changed after the action was prepared. Create a fresh preview; no mutation was attempted.');
  }
}

function publicAction(row) {
  if (!row) return null;
  return {
    id: row.id,
    store_id: row.store_id,
    action_type: row.action_type,
    resource_id: row.resource_id,
    idempotency_key: row.idempotency_key,
    confirmation_hash: row.request_hash,
    preview: row.preview_json,
    rollback_available: row.status === 'executed',
    status: row.status,
    confirmation_expires_at: row.confirmation_expires_at,
    confirmed_at: row.confirmed_at,
    executed_at: row.executed_at,
    rolled_back_at: row.rolled_back_at,
    error_code: row.error_code,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

module.exports = {
  ACTION_PRODUCT_DESCRIPTION, PREVIEW_TTL_MS, MAX_DESCRIPTION_LENGTH,
  CommerceActionError, assertActionInput, actionRequestHash,
  assertConfirmation, assertCurrentDescription, publicAction, safeEqual,
};
