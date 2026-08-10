const assert = require('assert');
const path = require('path');

try {
  const controller = require(path.join(__dirname, '..', 'authController'));
  assert.strictEqual(controller.normalizeTotpCode(' 012345 '), '012345');
  assert.strictEqual(controller.normalizeTotpCode('123456'), '123456');
  assert.strictEqual(controller.normalizeTotpCode('123 456'), '123456');
  assert.strictEqual(controller.normalizeTotpCode(123456), '123456');
  console.log('auth.twofactor.test.js: all assertions passed');
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
