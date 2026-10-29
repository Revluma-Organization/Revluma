'use strict';
const assert = require('node:assert/strict');
const { validFindingId, buildFindingContext } = require('./findingChatContext');
const { TRUSTED_SOURCE } = require('./intelligenceOrderCoverage');
const id = '11111111-1111-4111-8111-111111111111';
assert.equal(validFindingId(id), true);
assert.equal(validFindingId('not-a-uuid'), false);
assert.equal(validFindingId({ id }), false);
assert.equal(buildFindingContext('Why?', null), null);
assert.equal(buildFindingContext('Why?', { evidence: { verified: false } }), null);
const finding = {
  store_id: 'store-a', type: 'revenue_change', title: 'Verified revenue decreased 30%',
  description: 'Compared with the prior equal-length period.',
  evidence: { verified: true, complete: true, coverage_source: TRUSTED_SOURCE, coverage_run_id: 'sync-123',
    previousStart: '2026-10-13T00:00:00.000Z', previousEnd: '2026-10-20T00:00:00.000Z',
    currentStart: '2026-10-20T00:00:00.000Z', currentEnd: '2026-10-27T00:00:00.000Z',
    previousCount: 10, currentCount: 7, currentRevenue: 700, previousRevenue: 1000, currency: 'USD' },
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
