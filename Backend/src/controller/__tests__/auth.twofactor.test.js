const assert = require('assert');
const path = require('path');
const speakeasy = require('speakeasy');

try {
  const controller = require(path.join(__dirname, '..', 'authController'));
  assert.strictEqual(controller.normalizeTotpCode(' 012345 '), '012345');
  assert.strictEqual(controller.normalizeTotpCode('123456'), '123456');
  assert.strictEqual(controller.normalizeTotpCode('123 456'), '123456');
  assert.strictEqual(controller.normalizeTotpCode(123456), '123456');

  const secret = 'JBSWY3DPEHPK3PXP';
  const token = speakeasy.totp({ secret, encoding: 'base32', digits: 6 });
  assert.strictEqual(controller.verifyTotpCode(secret, token), true);

  console.log('auth.twofactor.test.js: all assertions passed');
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
