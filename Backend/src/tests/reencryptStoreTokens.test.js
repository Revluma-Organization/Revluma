/**
 * GCM migration planner: classification logic for the token re-encryption runbook.
 */
'use strict';

process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY =
  process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { encrypt } = require('../utils/encryption');
const { planReencryption, APPLY_PHRASE } = require('../../scripts/reencryptStoreTokens');

function legacyCbc(plaintext) {
  const key = Buffer.from(process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY, 'hex');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${body.toString('hex')}`;
}

test('planner classifies v1 as reencrypt, v2 as skip, unknown as skip', () => {
  const rows = [
    { id: 's1', access_token: legacyCbc('token-1') },
    { id: 's2', access_token: encrypt('token-2') },
    { id: 's3', access_token: 'garbage::not-a-format' },
  ];
  const plan = planReencryption(rows);
  assert.deepEqual(plan, [
    { id: 's1', action: 'reencrypt' },
    { id: 's2', action: 'skip_already_v2' },
    { id: 's3', action: 'skip_unrecognized_format' },
  ]);
});

test('planner handles an empty store population', () => {
  assert.deepEqual(planReencryption([]), []);
});

test('apply phrase is the documented exact constant', () => {
  assert.equal(APPLY_PHRASE, 'REENCRYPT-ALL-SHOPIFY-TOKENS');
});
