const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// GREET-001 / MODE-PERSIST-001: the streamed+persisted Rev payload must carry
// response_mode and mode_reason, and must bound evidence lists. The controller
// cannot be required directly (heavy boot-time deps), so the real shipped
// source of the persistence mapper is evaluated in a sandbox — the test fails
// if the function is renamed or the fields are dropped again.
const source = fs.readFileSync(path.join(__dirname, '..', 'revController.js'), 'utf8');
const constMatch = source.match(/const MAX_PERSISTED_EVIDENCE_ITEMS = (\d+);/);
assert.ok(constMatch, 'MAX_PERSISTED_EVIDENCE_ITEMS constant must exist');
const start = source.indexOf('function _boundedResultForPersistence');
const end = source.indexOf('async function _insertRevMessage');
assert.ok(start > 0 && end > start, 'persistence mapper must exist in revController');
const fnSource = source.slice(start, end);
const context = { MAX_PERSISTED_EVIDENCE_ITEMS: Number(constMatch[1]), exports: {} };
vm.createContext(context);
const bounded = vm.runInContext(`${fnSource}; _boundedResultForPersistence;`, context);

// A conversational turn keeps its mode all the way to the browser and the DB.
const conversational = bounded({
  response_type: 'chat',
  response_mode: 'conversational',
  mode_reason: 'the question needs no store investigation',
  text: 'Hey Chief, good to see you.',
  investigation: { steps: [], tools_used: [] },
  evidence: { items: [], limitations: [] },
});
assert.equal(conversational.response_mode, 'conversational');
assert.equal(conversational.mode_reason, 'the question needs no store investigation');
assert.equal(conversational.text, 'Hey Chief, good to see you.');

// Understanding/gate metadata travels with the payload (contract §16).
const withUnderstanding = bounded({
  response_mode: 'conversational',
  understanding: { intent: 'greeting', gate: 'conversational', source: 'fast_path' },
});
assert.deepEqual(withUnderstanding.understanding, {
  intent: 'greeting', gate: 'conversational', source: 'fast_path',
});
assert.equal(bounded({ text: 'x' }).understanding, null);

// A verified answer keeps its mode too.
const verified = bounded({ response_mode: 'quick_verification', text: 'Yes — connected.' });
assert.equal(verified.response_mode, 'quick_verification');

// Missing mode degrades to null, never to a guessed string.
assert.equal(bounded({ text: 'x' }).response_mode, null);

// Evidence lists stay bounded on their way into the database.
const many = Array.from({ length: 200 }, (_, i) => ({ id: `ev-${i}` }));
const capped = bounded({ evidence: { items: many, comparison_items: many } });
assert.ok(capped.evidence.items.length <= 60);
assert.ok(capped.evidence.comparison_items.length <= 60);

console.log('revPersistence contract test passed');
