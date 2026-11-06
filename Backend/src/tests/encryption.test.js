/**
 * Token encryption: v2 GCM write path, v1 CBC read backcompat, tamper detection.
 */
'use strict';

process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY =
  process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { encrypt, decrypt, encryptionFormat, isLegacyFormat } = require('../utils/encryption');

test('v2 round-trip preserves the token and uses the v2 format', () => {
  const token = 'shppa_test_token_1234567890';
  const encrypted = encrypt(token);
  assert.equal(encryptionFormat(encrypted), 'v2-gcm');
  assert.equal(decrypt(encrypted), token);
  // 12-byte IV => 24 hex chars after the prefix
  assert.match(encrypted, /^v2:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
});

test('two encryptions of the same token differ (random IV)', () => {
  const token = 'shppa_same_token';
  assert.notEqual(encrypt(token), encrypt(token));
});

test('legacy v1 ciphertext still decrypts (read backcompat)', () => {
  const key = Buffer.from(process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY, 'hex');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const body = Buffer.concat([cipher.update('legacy_token_abc', 'utf8'), cipher.final()]);
  const legacy = `${iv.toString('hex')}:${body.toString('hex')}`;
  assert.equal(isLegacyFormat(legacy), true);
  assert.equal(encryptionFormat(legacy), 'v1-cbc');
  assert.equal(decrypt(legacy), 'legacy_token_abc');
});

test('tampered v2 ciphertext fails authentication instead of returning plaintext', () => {
  const encrypted = encrypt('shppa_do_not_strip');
  const [prefix, iv, tag, data] = encrypted.split(':');
  const flipped = (parseInt(data.slice(0, 2), 16) ^ 1).toString(16).padStart(2, '0');
  const tampered = [prefix, iv, tag, flipped + data.slice(2)].join(':');
  assert.throws(() => decrypt(tampered));
  const tagTampered = [prefix, iv, tag.slice(0, -2) + '00', data].join(':');
  assert.throws(() => decrypt(tagTampered));
});

test('unrecognized formats throw ENCRYPTION_FORMAT_UNKNOWN', () => {
  assert.throws(() => decrypt('not-a-ciphertext'), (err) => err.code === 'ENCRYPTION_FORMAT_UNKNOWN');
  assert.throws(() => decrypt('v2:bad:bad:bad'), (err) => err.code === 'ENCRYPTION_FORMAT_UNKNOWN');
  assert.equal(encryptionFormat('not-a-ciphertext'), 'unknown');
});
