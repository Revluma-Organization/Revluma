'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { _validateOrchestrateRequest: validateRequest, _validateOrchestrateResponse: validateResponse } = require('../services/mlService');
const validRequest = () => ({
  organizationId: 'org-1', userId: 'user-1', message: 'How are sales?',
  triggerType: 'conversation', triggerPriority: 'normal', contextPayload: {},
});
const validResponse = () => ({
  response_type: 'analysis', conversation_id: 'conv-1', message_id: 'msg-1',
  situation: 'Orders declined.', insight: 'Seven compared with ten.',
  implication: 'Investigate the change.', recommendation: 'Review order coverage.',
  actions: [],
});
test('orchestrator rejects malformed merchant identity', () => {
  for (const key of ['organizationId', 'userId']) {
    for (const value of [null, {}, [], ' ', 7]) {
      const request = validRequest(); request[key] = value;
      assert.equal(validateRequest(request).valid, false, key + ':' + String(value));
    }
  }
  assert.equal(validateRequest(validRequest()).valid, true);
});
test('orchestrator rejects invalid analysis content and response IDs', () => {
  assert.equal(validateResponse(validResponse()), true);
  for (const key of ['conversation_id', 'message_id', 'situation', 'insight', 'implication', 'recommendation']) {
    for (const value of [null, '', ' ', 123, {}]) {
      const response = validResponse(); response[key] = value;
      assert.equal(validateResponse(response), false, key);
    }
  }
  const response = validResponse(); response.actions = Array(21).fill({});
  assert.equal(validateResponse(response), false);
  assert.equal(validateResponse({ ...validResponse(), success: false }), false);
});
