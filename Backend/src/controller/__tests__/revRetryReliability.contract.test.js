const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Phase 5D — conversation-reliability contract.
//
// The controller cannot be required directly (heavy boot-time deps), so — the
// same way revConversation.contract.test.js does it — the real shipped
// eligibility helper is sliced and evaluated with the REAL retryability
// classifier, and the retry/cursor wiring is pinned by source guards that
// fail if a guard is removed or renamed. Cross-boundary assertions keep the
// browser retry client and the server retry endpoint from drifting apart.
const source = fs.readFileSync(path.join(__dirname, '..', 'revController.js'), 'utf8');
const routeSource = fs.readFileSync(path.join(__dirname, '..', '..', 'route', 'revRoute.js'), 'utf8');
const submissionSource = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'revSubmission.js'), 'utf8');
const outcomesSource = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'revInvestigationOutcomes.js'), 'utf8');
const failurePolicySource = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'revFailureContract.js'), 'utf8');
const pagingSource = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'revConversationPaging.js'), 'utf8');
const feSource = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', '..', 'Frontend', 'Dashboard', 'src', 'pages', 'RevIntell.tsx'),
  'utf8',
);
const { retryabilityForError } = require('../../services/revInvestigationOutcomes');

function sliceFunction(name) {
  const start = source.indexOf(name);
  assert.ok(start > 0, `${name} must exist in revController`);
  // The first column-0 `}` after the declaration is the function's own close.
  const end = source.indexOf('\n}', start) + 2;
  assert.ok(end > start + 2, `${name} could not be sliced`);
  return source.slice(start, end);
}

// ── 1. Eligibility matrix: the real helper + the real retryability classifier ──
const ctx = { retryabilityForError };
vm.createContext(ctx);
const eligibilitySource = sliceFunction('function _retryEligibility');
const retryEligibility = vm.runInContext(`${eligibilitySource}; _retryEligibility;`, ctx);

assert.equal(retryEligibility({ userText: null, userImageAssisted: null, latestRev: null, expectedMessage: null }),
  'NOTHING_TO_RETRY', 'no persisted user question means nothing to retry');
assert.equal(retryEligibility({ userText: '', userImageAssisted: false, latestRev: null, expectedMessage: '' }),
  'NOTHING_TO_RETRY', 'an empty persisted question means nothing to retry');

// An image-assisted question must never be re-run imageless: the bytes are
// not persisted, so the retry would answer a different question.
assert.equal(retryEligibility({ userText: 'q', userImageAssisted: true, latestRev: null, expectedMessage: 'q' }),
  'RETRY_IMAGE_REQUIRED', 'image-assisted questions require re-attaching the image');
assert.equal(retryEligibility({ userText: 'q', userImageAssisted: true,
  latestRev: { has_error: true, error_code: 'INTELLIGENCE_UNAVAILABLE' }, expectedMessage: 'other' }),
  'RETRY_IMAGE_REQUIRED', 'the image guard wins over staleness and failure state');

// A stale client must not re-run a newer turn: the caller's question has to
// be the latest persisted user text (compared trimmed — persistence trims).
assert.equal(retryEligibility({ userText: 'latest question', userImageAssisted: false, latestRev: null, expectedMessage: 'older question' }),
  'RETRY_NOT_ELIGIBLE', 'a superseded question is not eligible');
assert.equal(retryEligibility({ userText: 'latest question', userImageAssisted: false, latestRev: null, expectedMessage: '  latest question  ' }),
  null, 'surrounding whitespace does not make a current question look stale');
assert.equal(retryEligibility({ userText: 'latest question', userImageAssisted: false, latestRev: null, expectedMessage: null }),
  null, 'callers that predate the guard stay eligible (backward compatible)');

// A completed turn is never re-run; a cancelled turn that persisted nothing
// after the user message is exactly what retry exists for.
assert.equal(retryEligibility({ userText: 'q', userImageAssisted: false,
  latestRev: { has_error: false, error_code: null }, expectedMessage: 'q' }),
  'RETRY_ALREADY_COMPLETED', 'a successful latest turn is never re-run');
assert.equal(retryEligibility({ userText: 'q', userImageAssisted: false, latestRev: null, expectedMessage: 'q' }),
  null, 'a user question with no Rev turn after it (cancelled/interrupted) is eligible');

// Only transient transport failures may be retried as the same investigation
// (the real classifier decides — only INTELLIGENCE_TIMEOUT/UNAVAILABLE).
for (const code of ['INTELLIGENCE_TIMEOUT', 'INTELLIGENCE_UNAVAILABLE']) {
  assert.equal(retryEligibility({ userText: 'q', userImageAssisted: false,
    latestRev: { has_error: true, error_code: code }, expectedMessage: 'q' }),
    null, `${code} is transient and stays eligible`);
}
for (const code of ['INTELLIGENCE_AUTH_FAILED', 'INTELLIGENCE_INVALID_REQUEST', 'INTELLIGENCE_INVALID_RESPONSE',
  'INTELLIGENCE_NOT_CONFIGURED', 'VALIDATION_ERROR', 'BOGUS_CODE', null, undefined]) {
  assert.equal(retryEligibility({ userText: 'q', userImageAssisted: false,
    latestRev: { has_error: true, error_code: code }, expectedMessage: 'q' }),
    'RETRY_NOT_ELIGIBLE', `${String(code)} is permanent and not eligible`);
}

// ── 2. Retry wiring guards: ownership, dedupe, reuse ──
assert.match(routeSource, /router\.post\('\/conversation\/:id\/retry'/,
  'POST /rev/conversation/:id/retry must stay registered');
const retryStart = source.indexOf('exports.retryConversation');
assert.ok(retryStart > 0, 'retryConversation must exist in revController');
const retryEnd = source.indexOf('\n};', retryStart);
const retrySource = source.slice(retryStart, retryEnd > retryStart ? retryEnd + 3 : retryStart + 4000);
assert.match(retrySource, /verifyConversationOwnership\(id, org\.id\)/,
  'retry must verify conversation ownership before reading history');
assert.match(retrySource, /_retryEligibility\(\{/,
  'retry must decide through the tested eligibility helper');
assert.match(retrySource, /DELETE FROM conversation_messages[\s\S]*?has_error = true/,
  'retry must delete failed Rev attempts so no duplicate error turns survive');
assert.match(retrySource, /reuse_user_message: true/,
  'retry must forward with reuse_user_message so no duplicate user row is written');
assert.match(retrySource, /return exports\.chat\(req, res, next\)/,
  'retry must reuse the JSON chat handler (the client renders one JSON final, never fake streaming)');

// The image marker is persisted at acceptance (both chat and stream share the
// helper) and the chat path flags image turns, so the eligibility guard above
// can refuse to re-run an image question imageless.
assert.match(submissionSource, /image_assisted: true/,
  'acceptSubmission must persist the image-assisted marker on the user row');
assert.match(source, /imageAssisted: Boolean\(imageBase64\)/,
  'the chat acceptance must flag image turns for the retry guard');

// ── 3. Newest-first cursor paging guards ──
assert.match(source, /parsePageCursor\(req\.query\)/,
  'getConversation must page through the tested cursor parser');
assert.match(pagingSource, /query\?\.before/,
  'the cursor parser must support the `before` sequence cursor');
assert.match(pagingSource, /query\.before_id/,
  'the cursor parser must support the C2 `before_id` tuple cursor');
assert.match(source, /nextPageCursor\(safeMessages, limit\)/,
  'getConversation must return the next-page tuple cursor');
assert.match(source, /cm\.sequence_number < \$\{before\}/,
  'older pages must be addressed by sequence, never by shifting offsets');
assert.match(source, /ORDER BY cm\.sequence_number DESC[\s\S]*?ORDER BY sequence_number ASC/,
  'pages must select newest-first and return ascending on the wire');

// ── 4. Cross-boundary: browser retry client vs server endpoint ──
assert.match(feSource, /\/rev\/conversation\/\$\{encodeURIComponent\(convId\)\}\/retry/,
  'the browser retry must call the registered server retry route');
assert.match(feSource, /\{ message: question \}/,
  'the browser retry must send the question it intends to retry for the staleness guard');
assert.match(feSource, /timeoutMs: RETRY_REQUEST_TIMEOUT_MS/,
  'the browser retry must carry its own long timeout, not the 30s default');
const clientTimeout = feSource.match(/const RETRY_REQUEST_TIMEOUT_MS = ([\d_]+);/);
assert.ok(clientTimeout, 'RETRY_REQUEST_TIMEOUT_MS must exist in RevIntell');
const serverBudget = failurePolicySource.match(/overallInvestigation: (\d+)/);
assert.ok(serverBudget, 'overallInvestigation must exist in revFailureContract');
assert.ok(Number(clientTimeout[1].replace(/_/g, '')) > Number(serverBudget[1]),
  `client retry timeout (${clientTimeout[1]}) must exceed the server investigation budget (${serverBudget[1]}) so honest long retries are not aborted`);
assert.match(feSource, /before=\$\{before\}/,
  'the browser must page older history with the `before` cursor');
assert.match(outcomesSource, /return \['INTELLIGENCE_TIMEOUT', 'INTELLIGENCE_UNAVAILABLE'\]\.includes\(code\)/,
  'retryabilityForError must keep its closed transient-only set');

console.log('revRetryReliability contract test passed');
