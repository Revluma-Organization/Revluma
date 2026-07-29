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
  let redirectedTo = null;

  const res = {
    cookie(name, value, options) {
      cookies.push({ name, value, options });
    },
    redirect(url) {
      redirectedTo = url;
      return url;
    },
    status(code) {
      return { json(payload) { return { code, payload }; } };
    },
  };

  await shopifyController.installShopify(req, res, (err) => {
    throw err;
  });

  assert.ok(redirectedTo, 'expected installShopify to redirect when user is authenticated');
  assert.ok(cookies.some((cookie) => cookie.name === 'shopify_state'));
  console.log('shopify install auth regression test passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
