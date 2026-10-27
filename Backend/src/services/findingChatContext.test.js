'use strict';
const assert = require('node:assert/strict');
const { validFindingId, buildFindingContext } = require('./findingChatContext');
const id = '11111111-1111-4111-8111-111111111111';
assert.equal(validFindingId(id), true);
assert.equal(validFindingId('not-a-uuid'), false);
assert.equal(validFindingId({ id }), false);
assert.equal(buildFindingContext('Why?', null), null);
assert.equal(buildFindingContext('Why?', { evidence: { verified: false } }), null);
const finding = {
  type: 'revenue_change', title: 'Verified revenue decreased 30%',
  description: 'Compared with the prior equal-length period.',
  evidence: { verified: true, currentRevenue: 700, previousRevenue: 1000, currency: 'USD' },
  detected_at: '2026-10-27T12:00:00.000Z',
};
const context = buildFindingContext('Why did revenue fall?', finding);
assert.match(context, /Merchant question: Why did revenue fall\?/);
assert.match(context, /Verified revenue decreased 30%/);
assert.match(context, /"currentRevenue":700/);
assert.match(context, /2026-10-27T12:00:00.000Z/);
assert.match(context, /never invent causes/);
assert.equal(context.includes('undefined'), false);
console.log('findingChatContext tests passed');
