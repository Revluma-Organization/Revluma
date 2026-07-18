const assert = require('assert');
const { buildCookieOptions, isProductionLikeEnvironment } = require('../../utils/cookieOptions');

function run() {
  assert.strictEqual(isProductionLikeEnvironment({ NODE_ENV: 'production' }), true);
  assert.strictEqual(isProductionLikeEnvironment({ RENDER: 'true' }), true);
  assert.strictEqual(isProductionLikeEnvironment({ VERCEL: '1' }), true);
  assert.strictEqual(isProductionLikeEnvironment({ NODE_ENV: 'development' }), false);

  const options = buildCookieOptions({ headers: { 'x-forwarded-proto': 'https' } }, { path: '/' });
  assert.strictEqual(options.secure, true);
  assert.strictEqual(options.sameSite, 'none');
  assert.strictEqual(options.path, '/');

  const localOptions = buildCookieOptions({ headers: {} }, { path: '/' });
  assert.strictEqual(localOptions.secure, false);
  assert.strictEqual(localOptions.sameSite, 'lax');

  console.log('cookieOptions tests passed');
}

run();
