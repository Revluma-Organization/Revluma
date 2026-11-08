'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

function loadWith(post, decrypt = value => value) {
  const path = require.resolve('../shopifyGraphql');
  delete require.cache[path];
  const original = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === 'axios') return { post };
    if (request === '../utils/encryption') return { decrypt };
    return original.call(this, request, parent, isMain);
  };
  try { return require('../shopifyGraphql'); }
  finally { Module._load = original; }
}

test('bounded retries recover from throttling without exposing response payloads', async () => {
  let calls = 0;
  const { shopifyGraphql } = loadWith(async () => {
    calls += 1;
    if (calls < 3) return { status: 200, data: { errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }] } };
    return { status: 200, data: { data: { abandonedCheckouts: { nodes: [] } } } };
  });
  const result = await shopifyGraphql({ shop_domain: 'shop.example', access_token: Buffer.from('token').toString('base64') }, '{ shop { id } }');
  assert.deepEqual(result.abandonedCheckouts.nodes, []);
  assert.equal(calls, 3);
});

test('non-retryable access errors fail once and retain only sanitized diagnostics', async () => {
  let calls = 0;
  const { shopifyGraphql } = loadWith(async () => {
    calls += 1;
    const error = new Error('network');
    error.response = { status: 403, data: { errors: [{ message: 'Access denied', token: 'must-not-leak' }] } };
    throw error;
  });
  await assert.rejects(
    shopifyGraphql({ shop_domain: 'shop.example', access_token: Buffer.from('token').toString('base64') }, '{ shop { id } }'),
    error => {
      assert.equal(error.code, 'SHOPIFY_GRAPHQL_HTTP_ERROR');
      assert.equal(error.status, 403);
      assert.equal(error.shopifyErrors[0].token, undefined);
      return true;
    });
  assert.equal(calls, 1);
});

test('local credential decryption failures require reauthorization without an HTTP request or retry', async () => {
  let calls = 0;
  const { shopifyGraphql } = loadWith(async () => {
    calls += 1;
    throw new Error('must not be called');
  }, () => {
    // Node's GCM authentication failure has neither a response nor a code.
    throw new Error('Unsupported state or unable to authenticate data');
  });
  await assert.rejects(
    shopifyGraphql({ shop_domain: 'shop.example', access_token: 'legacy-ciphertext' }, '{ shop { id } }'),
    error => {
      assert.equal(error.code, 'SHOPIFY_CREDENTIAL_UNUSABLE');
      assert.equal(error.retryable, false);
      assert.equal(error.status, undefined);
      assert.equal(error.message.includes('authenticate data'), false);
      return true;
    });
  assert.equal(calls, 0);
  const { classifyShopifyError } = require('../integrationLifecycle');
  assert.equal(classifyShopifyError({ code: 'SHOPIFY_CREDENTIAL_UNUSABLE' }), 'AUTHORIZATION_REQUIRED');
});
