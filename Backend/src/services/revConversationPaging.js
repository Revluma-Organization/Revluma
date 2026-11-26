'use strict';

/**
 * C2 tuple-cursor paging for GET /rev/conversation/:id.
 *
 * The legacy `?before=<int>` cursor keeps its exact semantics (older pages
 * addressed by sequence, never by shifting offsets) and gains deterministic
 * tie-break ordering. The optional `before_id` uuid selects the tuple
 * predicate over the total order (sequence_number, id), so a page boundary
 * can never split an unnamed tie group: every row is addressable, duplicates
 * self-heal client-side by id, and skips become impossible. The tuple cursor
 * stays permanently, even after the C2 repair + unique backstop make ties
 * impossible, because it is cheap and robust to any future tie source.
 */

const CURSOR_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cursorError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = 'VALIDATION_ERROR';
  return error;
}

function parsePageCursor(query) {
  const beforeRaw = parseInt(query?.before, 10);
  const before = Number.isInteger(beforeRaw) && beforeRaw >= 0 ? beforeRaw : null;
  // before_id is ignored unless before is present; a malformed id with a
  // present before is a 400 (the client named a row that cannot exist).
  if (before === null) return { before, beforeId: null };
  const raw = typeof query?.before_id === 'string' ? query.before_id.trim().toLowerCase() : '';
  if (!raw) return { before, beforeId: null };
  if (!CURSOR_ID_PATTERN.test(raw)) throw cursorError('before_id must be a valid UUID.');
  return { before, beforeId: raw };
}

// The wire format is ascending, so the oldest row of a full page is the
// cursor for the next older page. A short page means no older rows remain.
function nextPageCursor(messages, limit) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length < limit) {
    return { next_before: null, next_before_id: null };
  }
  const oldest = messages[0];
  return { next_before: oldest.sequence_number, next_before_id: oldest.id };
}

module.exports = {
  CURSOR_ID_PATTERN,
  parsePageCursor,
  nextPageCursor,
};
