'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { _validateInvestigationResponse } = require('../mlService');

function validResult() {
  return {
    contract_version: 'rev-investigation-v1',
    success: true,
    read_only: true,
    response_type: 'analysis',
    text: '## What I can verify\n- USD 30.31 across 3 orders',
    investigation: {
      id: 'investigation-1',
      intent: 'revenue_investigation',
      status: 'complete',
      period: { start: '2026-10-25T12:00:00Z', end: '2026-11-01T12:00:00Z' },
      steps: [],
    },
    evidence: {
      items: [{
        id: 'ev-abc123', metric: 'recorded_order_value', value: '30.31',
        currency: 'USD', unit: 'currency', status: 'available',
      }],
    },
    facts: [],
    hypotheses: [],
    unknowns: [],
    recommendations: [{ label: 'Compare periods', executed: false }],
  };
}

test('valid investigation contract is accepted', () => {
  assert.equal(_validateInvestigationResponse(validResult()), true);
});

test('investigation contract rejects missing read-only guarantee', () => {
  const result = validResult();
  result.read_only = false;
  assert.equal(_validateInvestigationResponse(result), false);
  result.read_only = undefined;
  assert.equal(_validateInvestigationResponse(result), false);
});

test('investigation contract rejects unauthorised execution claims', () => {
  const result = validResult();
  result.recommendations = [{ label: 'Change price', executed: true }];
  assert.equal(_validateInvestigationResponse(result), false);
});

test('investigation contract rejects monetary evidence without a currency', () => {
  for (const currency of [undefined, null, '', 'usd', 'US', 'USDT']) {
    const result = validResult();
    result.evidence.items[0].currency = currency;
    assert.equal(_validateInvestigationResponse(result), false, String(currency));
  }
  const zero = validResult();
  zero.evidence.items[0].value = null;
  assert.equal(_validateInvestigationResponse(zero), false);
});

test('investigation contract rejects invalid evidence statuses and ids', () => {
  const result = validResult();
  result.evidence.items[0].status = 'probably';
  assert.equal(_validateInvestigationResponse(result), false);
  const badId = validResult();
  badId.evidence.items[0].id = 'evidence-1';
  assert.equal(_validateInvestigationResponse(badId), false);
});

test('investigation contract rejects a non-array evidence payload', () => {
  const result = validResult();
  result.evidence.items = {};
  assert.equal(_validateInvestigationResponse(result), false);
  assert.equal(_validateInvestigationResponse(null), false);
  assert.equal(_validateInvestigationResponse({ success: false }), false);
});

test('controller source enforces streaming, search, retry and read-only guards', () => {
  const file = path.join(__dirname, '..', '..', 'controller', 'revController.js');
  const source = fs.readFileSync(file, 'utf8');
  assert.ok(source.includes('exports.chatStream'), 'streaming endpoint must exist');
  assert.ok(source.includes("code: 'READ_ONLY'"), 'read-only guard must exist');
  assert.ok(source.includes('reuse_user_message'), 'retry must reuse the user turn');
  assert.ok(source.includes('exports.retryConversation'), 'retry endpoint must exist');
  assert.ok(source.includes('rawSearch'), 'conversation search must exist');
  assert.ok(source.includes('cm.organization_id = ${org.id}::uuid'),
    'conversation search must be organization-scoped');
  assert.ok(source.includes('mlService.streamInvestigation'), 'stream must use the gateway');
  assert.ok(!source.includes('require(\'axios\').post'), 'controllers must not call providers directly');

  const route = fs.readFileSync(
    path.join(__dirname, '..', '..', 'route', 'revRoute.js'), 'utf8');
  assert.ok(route.includes("router.post('/stream'"), 'stream route must be mounted');
  assert.ok(route.includes("router.post('/conversation/:id/retry'"), 'retry route must be mounted');
  assert.ok(route.includes("router.get('/tools'"), 'tool catalog route must be mounted');
  assert.ok(route.includes('authenticateToken, chatLimiter'), 'stream must be rate limited');
});
