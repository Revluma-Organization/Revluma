'use strict';

/**
 * Regressions for scheduler configuration parsing.
 *
 * A malformed environment variable used to become NaN, which fails silently in
 * two ways that both disable the scheduler: `setInterval(fn, NaN)` fires every
 * millisecond, and a NaN lock TTL serialises to `null` in the Redis
 * `SET key val EX ttl NX` command, so the lock is never acquired and the
 * Business State rebuild is skipped forever without recording why.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { intSetting } = require('../utils/intSetting');

const NAME = 'REV_TEST_INT_SETTING';

function withEnv(value, fn) {
  const previous = process.env[NAME];
  if (value === undefined) delete process.env[NAME];
  else process.env[NAME] = value;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env[NAME];
    else process.env[NAME] = previous;
  }
}

test('uses the documented default when the variable is unset', () => {
  withEnv(undefined, () => {
    assert.equal(intSetting(NAME, '60000', 5000), 60000);
  });
});

test('parses a valid value', () => {
  withEnv('120000', () => {
    assert.equal(intSetting(NAME, '60000', 5000), 120000);
  });
});

test('tolerates surrounding whitespace', () => {
  withEnv('  90000  ', () => {
    assert.equal(intSetting(NAME, '60000', 5000), 90000);
  });
});

test('never returns NaN for unparsable input', () => {
  for (const bad of ['ten minutes', 'abc', '60s and then some', '{}', 'null', 'NaN']) {
    withEnv(bad, () => {
      const value = intSetting(NAME, '600', 60);
      assert.ok(Number.isInteger(value), `${bad} must not produce NaN`);
      assert.equal(value, 600, `${bad} must fall back to the default`);
    });
  }
});

test('an empty string is treated as unset, not as zero', () => {
  withEnv('', () => {
    assert.equal(intSetting(NAME, '60000', 5000), 60000);
  });
});

test('a value below the minimum is raised to the default', () => {
  // A 1ms scheduler interval would be a busy loop against Python and Postgres.
  withEnv('1', () => {
    assert.equal(intSetting(NAME, '60000', 5000), 60000);
  });
});

test('a negative value is rejected', () => {
  withEnv('-5000', () => {
    assert.equal(intSetting(NAME, '60000', 5000), 60000);
  });
});

test('zero is rejected when the minimum is above zero', () => {
  withEnv('0', () => {
    assert.equal(intSetting(NAME, '300', 30), 300);
  });
});

test('a fractional value is rejected rather than truncated into range', () => {
  withEnv('60.5', () => {
    // parseInt would yield 60; the minimum is 60 so that would sneak through as
    // a value nobody configured. Requiring an integer keeps it honest.
    assert.equal(intSetting(NAME, '600', 60), 600);
  });
});

test('the exact minimum is accepted', () => {
  withEnv('5000', () => {
    assert.equal(intSetting(NAME, '60000', 5000), 5000);
  });
});

test('a numeric fallback is honoured as well as a string one', () => {
  withEnv(undefined, () => {
    assert.equal(intSetting(NAME, 15 * 60 * 1000, 5000), 900000);
  });
});

test('an unusable fallback still yields a safe value', () => {
  withEnv('garbage', () => {
    const value = intSetting(NAME, 'also-garbage', 30);
    assert.ok(Number.isInteger(value));
    assert.ok(value >= 30);
  });
});

test('the lock TTL that broke production can never be NaN again', () => {
  // The exact production shape: BUSINESS_STATE_LOCK_TTL_SECONDS feeding a Redis
  // SET ... EX argument. NaN there silently disabled every rebuild.
  withEnv('ten minutes', () => {
    const ttl = intSetting(NAME, '600', 60);
    assert.equal(ttl, 600);
    assert.ok(Number.isInteger(ttl), 'a Redis EX argument must be an integer');
  });
});
