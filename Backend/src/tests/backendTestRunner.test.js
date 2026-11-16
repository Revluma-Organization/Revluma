'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { runTests } = require('../../scripts/run-tests');
const { failureAnnotation, redactDiagnostics, MAX_DIAGNOSTIC_CHARS } = require('../../scripts/lib/test-diagnostics');

const root = path.resolve(__dirname, '..', '..');
const fixtures = ['first.test.js', 'second.test.js', 'third.test.js'].map((name) => path.join(root, 'src', name));

function runWith(results, env = {}) {
  const calls = [];
  let output = '';
  let errors = '';
  const status = runTests({ root, tests: fixtures.slice(0, results.length), env,
    spawn: (command, args, options) => {
      calls.push({ command, args, options });
      return results[calls.length - 1];
    },
    stdout: { write: (text) => { output += text; } },
    stderr: { write: (text) => { errors += text; } },
  });
  return { status, calls, output, errors };
}

test('complete Backend runner executes later files after both plain and TAP failures', () => {
  const result = runWith([
    { status: 1, stderr: 'AssertionError: expected authorized scope\n    at first.test.js:12:3' },
    { status: 0, stdout: 'all assertions passed\n' },
    { status: 1, stdout: 'not ok 1 - rejects foreign scope\nerror: assertion\n' },
  ], { GITHUB_ACTIONS: 'true' });
  assert.equal(result.calls.length, 3);
  assert.equal(result.status, 1);
  assert.match(result.output, /1 passed, 2 failed, 3 total/);
  assert.match(result.output, /::error title=Backend test failed - first.test.js::AssertionError/);
  assert.match(result.output, /at first.test.js:12:3/);
  assert.match(result.output, /::error title=Backend test failed - third.test.js::not ok/);
  assert.match(result.errors, /FAILED: src\/first.test.js/);
});

test('runner reports success only when every file succeeds and keeps the original test command', () => {
  const result = runWith([{ status: 0 }, { status: 0 }]);
  assert.equal(result.status, 0);
  assert.match(result.output, /2 passed, 0 failed, 2 total/);
  assert.doesNotMatch(result.output, /::error/);
  assert.deepEqual(result.calls.map((call) => call.args), fixtures.slice(0, 2).map((file) => [file]));
  assert.equal(result.calls[0].command, process.execPath);
  assert.equal(result.calls[0].options.cwd, root);
});

test('process startup errors and signals fail the suite without skipping the remaining file', () => {
  const result = runWith([{ status: null, error: new Error('spawn failed') },
    { status: null, signal: 'SIGTERM' }, { status: 0 }], { GITHUB_ACTIONS: 'true' });
  assert.equal(result.status, 1);
  assert.equal(result.calls.length, 3);
  assert.match(result.output, /spawn failed/);
  assert.match(result.output, /SIGTERM/);
});

test('check diagnostics redact environment secrets, connection URLs and credential fields', () => {
  const text = 'AssertionError: actual=private-api-token expected=authorized\n'
    + 'postgresql://alice:pass@db.example/test?password=other\n'
    + 'Authorization: Bearer unknown-token\naccess_token="unknown-secret" password: "unknown-password"';
  const result = redactDiagnostics(text, { GEMINI_API_KEY: 'private-api-token' });
  assert.match(result, /AssertionError: actual=\[REDACTED\] expected=authorized/);
  for (const secret of ['private-api-token', 'alice:pass', 'unknown-token', 'unknown-secret', 'unknown-password']) {
    assert.ok(!result.includes(secret), `must not expose ${secret}`);
  }
});

test('long test logs retain the final assertion and stack below the Actions API truncation limit', () => {
  const stack = 'AssertionError: expected complete, got unknown\n    at verifyPersistedStore (test.js:270:10)';
  const result = failureAnnotation('callback.test.js', 'verbose logs\n'.repeat(1000) + stack, {});
  assert.ok(result.length < 4096);
  assert.match(result, /AssertionError: expected complete, got unknown%0A    at verifyPersistedStore/);
});

test('annotations are bounded and cannot inject workflow commands through newlines or percent escapes', () => {
  const result = failureAnnotation('unsafe,name.test.js', 'x'.repeat(MAX_DIAGNOSTIC_CHARS * 2)
    + '\n::warning::not a command\r\n100% done', {});
  assert.equal(result.split('\n').length, 2);
  assert.match(result, /Earlier output omitted/);
  assert.match(result, /%0A::warning::not a command%0D%0A100%25 done/);
  assert.match(result, /unsafe_name.test.js/);
  assert.ok(result.length < MAX_DIAGNOSTIC_CHARS + 300);
});
