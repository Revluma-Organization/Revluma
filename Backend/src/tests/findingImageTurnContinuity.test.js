'use strict';

/**
 * Phase 5B parity: image turns run the legacy /orchestrate path, whose result
 * carries no selected_finding echo. The chat controller must re-attach the
 * Node-authorized request reference so finding continuity matches the
 * text-turn path — without ever overwriting an explicit echo, an explicit
 * clear (null), or persisting a malformed reference.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { attachRequestedFindingReference } = require('../services/findingChatContext');

const ID = '123e4567-e89b-42d3-a456-426614174000';
function requested() {
  return { finding_id: ID, selection_source: 'explicit_selection' };
}
function orchestrateResult() {
  return {
    success: true, response_type: 'analysis', conversation_id: 'conv-1', message_id: 'msg-1',
    situation: 'Situation.', insight: 'Insight.', implication: 'Implication.',
    recommendation: 'Recommendation.',
  };
}

test('attaches the authorized request reference when the result omits the key', () => {
  const data = attachRequestedFindingReference(orchestrateResult(), requested());
  assert.deepEqual(data.selected_finding, requested());
  assert.equal(data.conversation_id, 'conv-1');
});

test('never overwrites an explicit echo from Python', () => {
  const echo = { finding_id: ID, selection_source: 'explicit_selection', confirmed: true };
  const data = attachRequestedFindingReference({ ...orchestrateResult(), selected_finding: echo }, requested());
  assert.equal(data.selected_finding, echo);
});

test('never overwrites an explicit null clear (topic change)', () => {
  const data = attachRequestedFindingReference(
    { ...orchestrateResult(), selected_finding: null }, requested());
  assert.equal('selected_finding' in data, true);
  assert.equal(data.selected_finding, null);
});

test('never persists a malformed request reference', () => {
  for (const bad of [null, undefined, {}, { finding_id: 'not-a-uuid' }, { finding_id: '' }, 'x']) {
    const data = attachRequestedFindingReference(orchestrateResult(), bad);
    assert.equal('selected_finding' in data, false);
  }
});

test('returns non-object results untouched', () => {
  assert.equal(attachRequestedFindingReference(null, requested()), null);
  assert.equal(attachRequestedFindingReference('ok', requested()), 'ok');
  const list = [];
  assert.equal(attachRequestedFindingReference(list, requested()), list);
});

test('chat re-attaches inside the image gate before finding persistence', () => {
  const source = fs.readFileSync(path.join(__dirname, '../controller/revController.js'), 'utf8');
  const gate = source.indexOf('if (imageBase64 && mlResult.data) {');
  const attach = source.indexOf('mlResult.data = attachRequestedFindingReference(mlResult.data, selectedFinding);');
  const persist = source.indexOf('await _persistFindingContext(activeConvId, org.id, mlResult.data);');
  assert.notEqual(gate, -1);
  assert.notEqual(attach, -1);
  assert.notEqual(persist, -1);
  assert.ok(gate < attach && attach < persist,
    'attach must run in the image gate before chat finding persistence');
  assert.equal(
    (source.match(/attachRequestedFindingReference\(mlResult\.data, selectedFinding\)/g) || []).length,
    1);
});
