const assert = require('node:assert/strict');
const { test } = require('node:test');
const { _validateOrchestrateResponse: validate } = require('../src/services/mlService');

const base = {
  success: true,
  conversation_id: 'conversation-123',
  message_id: 'message-456',
  response_type: 'direct_answer',
  text: 'Shopify: connected in Revluma.',
};

test('store-connection direct_answer satisfies Node to Python response contract', () => {
  assert.equal(validate(base), true);
});

test('direct_answer without conversation and message IDs is rejected', () => {
  assert.equal(validate({ ...base, message_id: null }), false);
  assert.equal(validate({ ...base, conversation_id: null }), false);
});

test('unrecognized response types remain rejected', () => {
  assert.equal(validate({ ...base, response_type: 'unknown' }), false);
});
