const assert = require('assert');
const jwt = require('jsonwebtoken');
const shopifyController = require('../shopifyController');
const { authenticateToken, JWT_ISSUER, JWT_AUDIENCE, ALLOWED_ALGORITHMS } = require('../../middlewares/authMiddleware');
const { generateState, decodeState } = require('../../utils/shopify');

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

  const state = generateState('user-456');
  const decoded = decodeState(state);
  assert.ok(decoded, 'expected Shopify state to decode successfully');
  assert.strictEqual(decoded.userId, 'user-456');

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
