'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { failureAnnotation } = require('./lib/test-diagnostics');

function findTests(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...findTests(target));
    else if (entry.name.endsWith('.test.js')) files.push(target);
  }
  return files;
}

function testEnvironment(env = process.env) {
  return {
    ...env,
    JWT_SECRET: env.JWT_SECRET || 'backend-test-jwt-secret-with-sufficient-length',
    COOKIE_SECRET: env.COOKIE_SECRET || 'backend-test-cookie-secret',
    SHOPIFY_TOKEN_ENCRYPTION_KEY: env.SHOPIFY_TOKEN_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    SENDGRID_API_KEY: env.SENDGRID_API_KEY || 'SG.backend-test-key',
  };
}

function runTests({ root, tests, env = process.env, spawn = spawnSync,
  stdout = process.stdout, stderr = process.stderr }) {
  const childEnv = testEnvironment(env);
  const failures = [];
  for (const file of tests) {
    stdout.write(`\n=== ${path.relative(root, file)} ===\n`);
    const result = spawn(process.execPath, [file], {
      cwd: root, env: childEnv, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    });
    if (result.stdout) stdout.write(result.stdout);
    if (result.stderr) stderr.write(result.stderr);
    if (result.status !== 0 || result.error || result.signal) {
      failures.push(file);
      const output = [result.stdout, result.stderr,
        result.error ? `Test process error: ${result.error.message}` : '',
        result.signal ? `Test process signal: ${result.signal}` : ''].filter(Boolean).join('\n');
      if (env.GITHUB_ACTIONS === 'true') stdout.write(failureAnnotation(file, output, childEnv));
    }
  }
  stdout.write(`\nBackend test files: ${tests.length - failures.length} passed, ${failures.length} failed, ${tests.length} total\n`);
  for (const file of failures) stderr.write(`FAILED: ${path.relative(root, file)}\n`);
  return failures.length === 0 ? 0 : 1;
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  process.exitCode = runTests({ root, tests: findTests(path.join(root, 'src')).sort() });
}

module.exports = { findTests, runTests, testEnvironment };
