const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePageCursor, nextPageCursor } = require('../revConversationPaging');

const UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// ── C2: cursor parsing (legacy before + optional before_id) ─────────────────

test('no cursor parses to the first page', () => {
  assert.deepEqual(parsePageCursor({}), { before: null, beforeId: null });
  assert.deepEqual(parsePageCursor(undefined), { before: null, beforeId: null });
});

test('a legacy before cursor keeps its integer semantics', () => {
  assert.deepEqual(parsePageCursor({ before: '7' }), { before: 7, beforeId: null });
  assert.deepEqual(parsePageCursor({ before: '0' }), { before: 0, beforeId: null });
});

test('an invalid before falls back to the first page', () => {
  assert.deepEqual(parsePageCursor({ before: 'newest' }), { before: null, beforeId: null });
  assert.deepEqual(parsePageCursor({ before: '-3' }), { before: null, beforeId: null });
});

test('before_id without before is ignored, even when malformed', () => {
  assert.deepEqual(parsePageCursor({ before_id: UUID }), { before: null, beforeId: null });
  assert.deepEqual(parsePageCursor({ before_id: 'not-a-uuid' }), { before: null, beforeId: null });
  assert.deepEqual(parsePageCursor({ before: 'nope', before_id: 'not-a-uuid' }), { before: null, beforeId: null });
});

test('before with a valid before_id selects the tuple cursor', () => {
  assert.deepEqual(parsePageCursor({ before: '7', before_id: UUID }), { before: 7, beforeId: UUID });
});

test('before_id is trimmed and lowercased', () => {
  assert.deepEqual(
    parsePageCursor({ before: '7', before_id: `  ${UUID.toUpperCase()} ` }),
    { before: 7, beforeId: UUID },
  );
});

test('before with a malformed before_id is a 400, never a silent first page', () => {
  assert.throws(
    () => parsePageCursor({ before: '7', before_id: 'not-a-uuid' }),
    (error) => error.code === 'VALIDATION_ERROR' && error.statusCode === 400,
  );
});

// ── C2: next-page cursor ─────────────────────────────────────────────────────

const row = (sequence_number, id) => ({ id, sequence_number });

test('a short page has no older page', () => {
  assert.deepEqual(nextPageCursor([], 50), { next_before: null, next_before_id: null });
  assert.deepEqual(
    nextPageCursor([row(2, 'b'), row(3, 'c')], 50),
    { next_before: null, next_before_id: null },
  );
});

test('a full page cursors from its oldest (first on the wire) row', () => {
  assert.deepEqual(
    nextPageCursor([row(5, 'oldest'), row(6, 'mid'), row(7, 'newest')], 3),
    { next_before: 5, next_before_id: 'oldest' },
  );
});
