const assert = require('assert');
const jwt = require('jsonwebtoken');
const shopifyController = require('../shopifyController');
const { authenticateToken, JWT_ISSUER, JWT_AUDIENCE, ALLOWED_ALGORITHMS } = require('../../middlewares/authMiddleware');
const {
  generateState,
  decodeState,
  getStateContext,
  isStateAccepted,
  getShopifyApiVersion,
  verifyHmac,
} = require('../../utils/shopify');

process.env.SHOPIFY_API_KEY ||= 'test-shopify-client-id';
process.env.SHOPIFY_API_SECRET ||= 'test-shopify-client-secret';
process.env.SHOPIFY_REDIRECT_URI ||= 'https://api.example.test/api/v1/shopify/callback';
process.env.BACKEND_URL ||= 'https://api.example.test';
process.env.FRONTEND_URL ||= 'https://app.example.test';
const currentDate = new Date();
const currentReleaseMonth = Math.floor(currentDate.getUTCMonth() / 3) * 3 + 1;
process.env.SHOPIFY_API_VERSION =
  `${currentDate.getUTCFullYear()}-${String(currentReleaseMonth).padStart(2, '0')}`;

const createAccessToken = (userId) => jwt.sign({
  iss: JWT_ISSUER,
  aud: JWT_AUDIENCE,
  sub: userId,
  email: 'tester@example.com',
  type: 'access',
  jti: 'test-jti',
  sid: 'test-session',
  iat: Math.floor(Date.now() / 1000),
  nbf: Math.floor(Date.now() / 1000),
}, process.env.JWT_SECRET, { algorithm: ALLOWED_ALGORITHMS[0], expiresIn: '15m' });

(async () => {
  const req = {
    query: { shop: 'revluma-test-store.myshopify.com' },
    signedCookies: {},
    headers: {},
    user: { id: 'user-123' },
  };

  const cookies = [];
  let response = null;

  const res = {
    cookie(name, value, options) {
      cookies.push({ name, value, options });
    },
    status(code) {
      return {
        json(payload) {
          response = { code, payload };
          return { code, payload };
        },
      };
    },
  };

  await shopifyController.installShopify(req, res, (err) => {
    throw err;
  });

  assert.ok(response, 'expected installShopify to return a JSON response');
  assert.strictEqual(response.code, 200);
  assert.ok(response.payload.redirectUrl, 'expected installShopify to return a redirectUrl');
  assert.ok(
    response.payload.redirectUrl.includes(encodeURIComponent(process.env.SHOPIFY_REDIRECT_URI)),
    'install URL must use the configured callback URL'
  );

  const callbackQuery = {
    code: 'test-code',
    shop: 'revluma-test-store.myshopify.com',
    state: 'test-state',
    timestamp: '1234567890',
  };
  const callbackMessage = Object.keys(callbackQuery)
    .sort()
    .map((key) => `${key}=${callbackQuery[key]}`)
    .join('&');
  callbackQuery.hmac = require('crypto')
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
    .update(callbackMessage)
    .digest('hex');
  assert.strictEqual(verifyHmac(callbackQuery), true, 'valid Shopify callback HMAC must pass');
  assert.strictEqual(verifyHmac({ ...callbackQuery, hmac: 'invalid' }), false);
  assert.strictEqual(verifyHmac({ ...callbackQuery, code: ['invalid'] }), false);
  assert.strictEqual(getShopifyApiVersion(), process.env.SHOPIFY_API_VERSION);
  process.env.SHOPIFY_API_VERSION = '2024-01';
  assert.throws(() => getShopifyApiVersion(), { code: 'SHOPIFY_API_VERSION_UNSUPPORTED' });
  process.env.SHOPIFY_API_VERSION =
    `${currentDate.getUTCFullYear()}-${String(currentReleaseMonth).padStart(2, '0')}`;

  let callbackResponse = null;
  const callbackRes = {
    status(code) {
      return {
        json(payload) {
          callbackResponse = { code, payload };
          return callbackResponse;
        },
      };
    },
  };
  await shopifyController.shopifyCallback(
    { query: {}, cookies: {}, signedCookies: {} },
    callbackRes
  );
  assert.strictEqual(callbackResponse.code, 400);
  assert.strictEqual(callbackResponse.payload.stage, 'callback_parameters');
  assert.ok(callbackResponse.payload.reference, 'callback failures must include a log reference');

  const state = generateState('user-456');
  const decoded = decodeState(state);
  assert.ok(decoded, 'expected Shopify state to decode successfully');
  assert.strictEqual(decoded.userId, 'user-456');

  const missingCookieContext = getStateContext(state, {}, {});
  assert.strictEqual(missingCookieContext.userId, undefined);
  assert.ok(missingCookieContext.decodedState, 'state payload may be decoded for diagnostics only');
  assert.strictEqual(isStateAccepted(undefined, state), false, 'missing state cookies must fail closed');

  const stateContext = getStateContext(
    state,
    { shopify_state: state, shopify_user: 'user-456' },
    {}
  );
  assert.strictEqual(stateContext.userId, 'user-456');
  assert.strictEqual(isStateAccepted(stateContext.storedState, state), true);
  assert.strictEqual(isStateAccepted(stateContext.storedState, `${state}-tampered`), false);

  let nextCalled = false;
  const authReq = {
    headers: { 'x-access-token': createAccessToken('user-456') },
    query: {},
    cookies: {},
    signedCookies: {},
  };
  const authRes = {
    status(code) {
      return { json(payload) { return { code, payload }; } };
    },
  };

  authenticateToken(authReq, authRes, () => {
    nextCalled = true;
  });

  assert.strictEqual(nextCalled, true);
  assert.strictEqual(authReq.user.id, 'user-456');
  console.log('shopify install auth regression test passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
