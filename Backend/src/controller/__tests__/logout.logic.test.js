/**
 * Lightweight unit checks for logout controller invariants.
 * Run with: node --test Backend/src/controller/__tests__/logout.logic.test.js
 * (or: node Backend/src/controller/__tests__/logout.logic.test.js)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const controllerPath = path.join(__dirname, '..', 'authController.js');
const source = fs.readFileSync(controllerPath, 'utf8');

// Count exports.logout assignments — duplicate definitions silently overwrite.
const logoutExports = source.match(/exports\.logout\s*=/g) || [];
assert.strictEqual(
  logoutExports.length,
  1,
  `Expected exactly one exports.logout definition, found ${logoutExports.length}`,
);

assert.ok(
  source.includes('clearCookie("refresh_token"'),
  'logout must clear the refresh_token cookie',
);

assert.ok(
  source.includes('readRefreshTokenFromRequest'),
  'logout must read refresh token from body or cookie',
);

assert.ok(
  source.includes('rawRefresh'),
  'login must set cookie from rawRefresh (not undefined refreshToken)',
);

assert.ok(
  !/res\.cookie\(\s*"refresh_token"\s*,\s*refreshToken\s*,/.test(source),
  'login must not set cookie with undefined variable refreshToken',
);

console.log('logout.logic.test.js: all assertions passed');
