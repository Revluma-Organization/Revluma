'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyConnectionBudget,
  PRISMA_CONNECTION_LIMIT,
  PRISMA_POOL_TIMEOUT_SECONDS,
} = require('../utils/dbConnectionBudget');

const DSN =
  'postgresql://postgres.jblpgqmbgdlzitprudgt:super-secret-password@aws-0-eu-west-1.pooler.supabase.com:6543/postgres';

function params(url) {
  return new URL(url).searchParams;
}

test('a DSN with no pool settings gets an explicit limit and timeout', () => {
  const result = applyConnectionBudget(DSN);

  assert.equal(result.applied, true);
  assert.equal(params(result.url).get('connection_limit'), String(PRISMA_CONNECTION_LIMIT));
  assert.equal(params(result.url).get('pool_timeout'), String(PRISMA_POOL_TIMEOUT_SECONDS));
  assert.equal(result.connectionLimit, PRISMA_CONNECTION_LIMIT);
  assert.equal(result.poolTimeoutSeconds, PRISMA_POOL_TIMEOUT_SECONDS);
});

test('credentials survive the rewrite', () => {
  const result = applyConnectionBudget(DSN);
  const parsed = new URL(result.url);

  // Losing the password here would break every production connection.
  assert.equal(parsed.password, 'super-secret-password');
  assert.equal(parsed.username, 'postgres.jblpgqmbgdlzitprudgt');
  assert.equal(parsed.hostname, 'aws-0-eu-west-1.pooler.supabase.com');
  assert.equal(parsed.port, '6543');
  assert.equal(parsed.pathname, '/postgres');
});

test('an operator-supplied connection_limit is never overwritten', () => {
  const result = applyConnectionBudget(`${DSN}?connection_limit=4`);
  const p = params(result.url);

  assert.equal(p.get('connection_limit'), '4');
  // The timeout is still missing, so the DSN is still adjusted.
  assert.equal(p.get('pool_timeout'), String(PRISMA_POOL_TIMEOUT_SECONDS));
  assert.equal(result.applied, true);
  assert.equal(result.connectionLimit, 4);
});

test('a fully configured DSN is returned byte-identical', () => {
  const configured = `${DSN}?connection_limit=4&pool_timeout=15`;
  const result = applyConnectionBudget(configured);

  assert.equal(result.applied, false);
  assert.equal(result.url, configured);
  assert.equal(result.connectionLimit, 4);
  assert.equal(result.poolTimeoutSeconds, 15);
});

test('unrelated DSN parameters are preserved', () => {
  const result = applyConnectionBudget(`${DSN}?sslmode=require&schema=public`);
  const p = params(result.url);

  assert.equal(p.get('sslmode'), 'require');
  assert.equal(p.get('schema'), 'public');
  assert.equal(p.get('connection_limit'), String(PRISMA_CONNECTION_LIMIT));
});

test('unparseable input is left untouched rather than rejected', () => {
  // Refusing to boot over pool tuning would be worse than using defaults.
  for (const candidate of ['not-a-url', '']) {
    const result = applyConnectionBudget(candidate);
    assert.equal(result.url, candidate, candidate);
    assert.equal(result.applied, false);
  }
});

test('non-Postgres DSNs are never given Postgres pool parameters', () => {
  // `connection_limit` on a SQLite file DSN would produce an invalid string.
  for (const candidate of [
    'file:./dev.db',
    'sqlite://local',
    'mysql://user:pass@localhost:3306/app',
    'mongodb://user:pass@localhost:27017/app',
  ]) {
    const result = applyConnectionBudget(candidate);
    assert.equal(result.url, candidate, candidate);
    assert.equal(result.applied, false, candidate);
  }
});

test('both Postgres scheme spellings are budgeted', () => {
  for (const scheme of ['postgres', 'postgresql']) {
    const result = applyConnectionBudget(`${scheme}://user:pass@host:5432/db`);
    assert.equal(result.applied, true, scheme);
    assert.equal(params(result.url).get('connection_limit'), String(PRISMA_CONNECTION_LIMIT));
  }
});

test('missing input is returned as-is', () => {
  for (const candidate of [undefined, null, '']) {
    const result = applyConnectionBudget(candidate);
    assert.equal(result.url, candidate);
    assert.equal(result.applied, false);
    assert.equal(result.connectionLimit, null);
  }
});

test('non-string input cannot throw', () => {
  assert.doesNotThrow(() => applyConnectionBudget(42));
  assert.doesNotThrow(() => applyConnectionBudget({}));
  assert.equal(applyConnectionBudget(42).applied, false);
});

test('the budget is sane against the verified database capacity', () => {
  // Supabase max_connections is 60 and the Python service holds 12.
  // Node must leave real headroom for replicas and Supabase internals.
  const PYTHON_POOL = 12;
  const SUPABASE_MAX = 60;

  assert.ok(PRISMA_CONNECTION_LIMIT >= 1, 'limit must be positive');
  assert.ok(
    PRISMA_CONNECTION_LIMIT + PYTHON_POOL <= SUPABASE_MAX - 10,
    'Node plus Python must leave at least 10 connections of headroom'
  );
  assert.ok(PRISMA_POOL_TIMEOUT_SECONDS >= 1, 'timeout is expressed in seconds');
});
