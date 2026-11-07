'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { prisma } = require('../configs/database');
const { _persistFindingContext } = require('../controller/revController');

const CONVERSATION = '123e4567-e89b-42d3-a456-426614174020';
const ORG = '123e4567-e89b-42d3-a456-426614174021';
const FINDING = '123e4567-e89b-42d3-a456-426614174000';

test('Node-owned persistence atomically retains only a bounded authorized selection reference', async () => {
  const original = prisma.$executeRaw;
  const calls = [];
  prisma.$executeRaw = async (strings, ...values) => { calls.push({ sql: strings.join('?'), values }); return 1; };
  try {
    await _persistFindingContext(CONVERSATION, ORG, {
      selected_finding: { finding_id: FINDING, selection_source: 'explicit_selection', selected_at: '2026-11-07T12:00:00Z', evidence: { secret: 'not persisted' } },
      recommendations: Array.from({ length: 8 }, (_, index) => ({
        recommendation_id: `rec-${index}`, finding_id: FINDING,
        lifecycle_state: 'presented', title: `Recommendation ${index}`, secret: 'not persisted',
      })),
    });
    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /jsonb_set/);
    assert.match(calls[0].sql, /organization_id = \?::uuid/);
    const selected = JSON.parse(calls[0].values[0]);
    const recommendations = JSON.parse(calls[0].values[1]);
    assert.deepEqual(selected, { finding_id: FINDING, selection_source: 'explicit_selection', selected_at: '2026-11-07T12:00:00Z' });
    assert.equal(recommendations.length, 3);
    assert.equal(JSON.stringify(recommendations).includes('secret'), false);
    assert.ok(calls[0].values.includes(CONVERSATION) && calls[0].values.includes(ORG));

    await _persistFindingContext(CONVERSATION, ORG, { selected_finding: null, recommendations: [] });
    assert.equal(JSON.parse(calls[1].values[0]), null);
    assert.deepEqual(JSON.parse(calls[1].values[1]), []);

    await _persistFindingContext(CONVERSATION, ORG, { response_type: 'chat' });
    assert.equal(calls.length, 2, 'non-investigation responses do not erase selection');
  } finally {
    prisma.$executeRaw = original;
  }
});
