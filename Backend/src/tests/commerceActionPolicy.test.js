'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ACTION_PRODUCT_DESCRIPTION, CommerceActionError, assertActionInput,
  actionRequestHash, assertConfirmation, assertCurrentDescription, publicAction,
} = require('../services/commerceActionPolicy');

const valid = {
  action_type: ACTION_PRODUCT_DESCRIPTION,
  store_id: '22222222-2222-4222-8222-222222222222',
  product_id: 'gid://shopify/Product/123',
  description: '<p>New description</p>',
  idempotency_key: 'merchant-request-0001',
};

test('action policy accepts only the fixed product description action', () => {
  assert.deepEqual(assertActionInput(valid), { storeId: valid.store_id, productId: valid.product_id, description: valid.description, idempotencyKey: valid.idempotency_key });
  for (const patch of [
    { action_type: 'productDelete' }, { store_id: 'other-store' }, { product_id: '123' },
    { description: 42 }, { description: 'x\u0000y' }, { idempotency_key: 'short' },
  ]) assert.throws(() => assertActionInput({ ...valid, ...patch }), CommerceActionError);
  assert.throws(() => assertActionInput({ ...valid, description: 'x'.repeat(100001) }), /description/);
});

test('request hash covers exact intended mutation and is deterministic', () => {
  const input = assertActionInput(valid);
  const hash = actionRequestHash(input);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(actionRequestHash(input), hash);
  assert.notEqual(actionRequestHash({ ...input, description: `${input.description} ` }), hash);
});

test('confirmation requires exact hash, live status, and unexpired preview', () => {
  const row = { request_hash: 'a'.repeat(64), status: 'awaiting_confirmation', confirmation_expires_at: new Date(Date.now() + 10000) };
  assert.doesNotThrow(() => assertConfirmation(row, row.request_hash));
  assert.throws(() => assertConfirmation(row, 'b'.repeat(64)), /does not match/);
  assert.throws(() => assertConfirmation({ ...row, status: 'executing' }, row.request_hash), /cannot be confirmed/);
  assert.throws(() => assertConfirmation({ ...row, confirmation_expires_at: new Date(Date.now() - 1) }, row.request_hash), /expired/);
});

test('current-state guard rejects concurrent product edits', () => {
  assert.doesNotThrow(() => assertCurrentDescription({ description: '' }, ''));
  assert.throws(() => assertCurrentDescription({ description: 'merchant edit' }, 'preview'), error => error.code === 'PRODUCT_CHANGED_SINCE_PREVIEW');
});

test('public action omits internal requested user, provider payload, and rollback internals', () => {
  const result = publicAction({ id: 'id', organization_id: 'secret-tenant', requested_by_user_id: 'user', provider_result: { secret: true }, rollback_json: { description: 'old' }, input_json: { description: 'new' }, request_hash: 'hash', status: 'executed' });
  assert.equal(result.confirmation_hash, 'hash');
  assert.equal(result.rollback_available, false);
  assert.equal(result.organization_id, undefined);
  assert.equal(result.requested_by_user_id, undefined);
  assert.equal(result.provider_result, undefined);
  assert.equal(result.rollback_json, undefined);
  assert.equal(result.input_json, undefined);
});
