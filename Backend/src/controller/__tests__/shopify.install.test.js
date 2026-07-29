const assert = require('assert');
const shopifyController = require('../shopifyController');

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
  assert.ok(cookies.some((cookie) => cookie.name === 'shopify_state'));
  console.log('shopify install auth regression test passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
