const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Task 222 (original 295-299) — conversation-lifecycle contract.
//
// The controller cannot be required directly (heavy boot-time deps), so — the
// same way revPersistence.contract.test.js does it — the real shipped source is
// sliced and evaluated/inspected in a sandbox. The test fails if a guard is
// removed or renamed. The frontend bound is read across the repo boundary so a
// silent drift between the client cap and the server cap (which would reintroduce
// silent truncation / UI-DB inconsistency) is caught here.
const source = fs.readFileSync(path.join(__dirname, '..', 'revController.js'), 'utf8');
const feSource = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', '..', 'Frontend', 'Dashboard', 'src', 'pages', 'RevIntell.tsx'),
  'utf8',
);

function sliceFunction(name) {
  const start = source.indexOf(name);
  assert.ok(start > 0, `${name} must exist in revController`);
  // The first column-0 `}` after the declaration is the function's own close.
  const end = source.indexOf('\n}', start) + 2;
  assert.ok(end > start + 2, `${name} could not be sliced`);
  return source.slice(start, end);
}

// ── 1. Question-length bound: server caps at 2000, client enforces the same ──
const sanitiseSource = sliceFunction('function sanitiseMessage');
const boundMatch = sanitiseSource.match(/\.slice\(0,\s*(\d+)\)/);
assert.ok(boundMatch, 'sanitiseMessage must cap message length with slice(0, N)');
const backendBound = Number(boundMatch[1]);
assert.equal(backendBound, 2000, 'the authoritative question-length bound is 2000');

// Evaluate the real function: it trims, strips NUL bytes, and hard-caps at 2000.
const ctx = {};
vm.createContext(ctx);
const sanitiseMessage = vm.runInContext(`${sanitiseSource}; sanitiseMessage;`, ctx);
assert.equal(sanitiseMessage('  hello  '), 'hello', 'trims surrounding whitespace');
assert.equal(sanitiseMessage('a\0b'), 'ab', 'strips NUL bytes from untrusted input');
assert.equal(sanitiseMessage('x'.repeat(2500)).length, 2000, 'caps an over-length message at the bound');
assert.equal(sanitiseMessage('x'.repeat(2000)).length, 2000, 'keeps a message exactly at the bound (no loss)');
assert.equal(sanitiseMessage(null), null, 'rejects a non-string message');

// The client enforces the SAME bound so nothing is ever submitted that the
// server would silently truncate. (This is the fix for the oversized-input gap.)
const feBoundMatch = feSource.match(/const MAX_QUESTION_LENGTH = (\d+);/);
assert.ok(feBoundMatch, 'frontend MAX_QUESTION_LENGTH must exist');
assert.equal(
  Number(feBoundMatch[1]),
  backendBound,
  'client and server question-length bounds must match (no silent truncation)',
);
assert.match(
  feSource,
  /maxLength=\{maxLength\}/,
  'the question field must declare maxLength so an over-length question cannot be typed',
);

// ── 2. Titles: a later message never clobbers an established title ──────────
const touchSource = sliceFunction('async function _touchConversation');
assert.match(
  touchSource,
  /title = COALESCE\(title,\s*\$\{titleHint\}\)/,
  'title must be set only when NULL (COALESCE) so a later turn cannot replace an established title',
);

// ── 3. Tenant isolation: unknown id -> 404, cross-tenant -> 403 (logged) ────
const ownershipSource = sliceFunction('async function verifyConversationOwnership');
assert.match(ownershipSource, /statusCode = 404/, 'an unknown conversation id is a 404 (no existence leak beyond the 404)');
assert.match(ownershipSource, /statusCode = 403/, 'a conversation owned by another organisation is a 403');
assert.match(
  ownershipSource,
  /rev_cross_tenant_attempt/,
  'cross-tenant attempts are logged with ids only (privacy-safe, no content)',
);

// A streamed retry reuses the already-accepted user turn. It must authorize
// the requested conversation ID before reading its history or writing the
// assistant result; an undefined/wrong-scope identifier would lose recovery.
const streamStart = source.indexOf('exports.chatStream = async');
const streamEnd = source.indexOf('// ── GET /api/v1/rev/tools', streamStart);
assert.ok(streamStart > 0 && streamEnd > streamStart, 'chatStream handler must exist');
const streamHandler = source.slice(streamStart, streamEnd);
assert.match(
  streamHandler,
  /verifyConversationOwnership\(requestedConversationId, org\.id\)/,
  'stream retries must authorize the supplied conversation ID under the authenticated organization',
);
assert.doesNotMatch(
  streamHandler,
  /verifyConversationOwnership\(conversationId, org\.id\)/,
  'stream retries must not reference a stale or undefined conversationId variable',
);

// ── 4. History restoration: do not present orphan empty rows as resumable ───
const historySource = sliceFunction('exports.getConversations');
assert.equal(
  (historySource.match(/SELECT COUNT\(\*\)::int FROM conversation_messages cm_count/g) || []).length,
  2,
  'history list and search must report actual persisted message counts, not stale denormalized counts',
);
assert.match(
  historySource,
  /EXISTS \(\s*SELECT 1 FROM conversation_messages cm_any[\s\S]*?cm_any\.conversation_id = c\.id[\s\S]*?cm_any\.organization_id = c\.organization_id/,
  'history search must exclude active conversation rows with no persisted messages',
);
assert.match(
  historySource,
  /EXISTS \(\s*SELECT 1 FROM conversation_messages cm[\s\S]*?cm\.conversation_id = c\.id[\s\S]*?cm\.organization_id = c\.organization_id/,
  'ordinary history must also exclude empty conversations without crossing tenants',
);

console.log('revConversation contract test passed');
