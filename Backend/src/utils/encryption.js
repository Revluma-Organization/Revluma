/**
 * Token and secret encryption for store credentials.
 *
 * Versioned formats:
 *   v2  aes-256-gcm   "v2:<iv_hex>:<auth_tag_hex>:<ciphertext_hex>"
 *   v1  aes-256-cbc   "<iv_hex>:<ciphertext_hex>"        (legacy, decrypt-only)
 *
 * v1 values are still read so existing rows keep working; every NEW encryption
 * is v2 (authenticated encryption: tampering fails closed instead of yielding
 * garbage plaintext). v1 is never produced anymore.
 *
 * Decryption of a malformed value throws ENCRYPTION_FORMAT_UNKNOWN or a GCM
 * authentication error. Callers must treat any throw as "credential unusable"
 * and must never fall back to returning plaintext or partial data.
 */
'use strict';

const crypto = require('crypto');

const GCM = 'aes-256-gcm';
const CBC = 'aes-256-cbc';
const V2_PREFIX = 'v2:';

const encryptionKey = String(process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY || '');

if (!/^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
  throw new Error(
    'SHOPIFY_TOKEN_ENCRYPTION_KEY must be a 64-character hexadecimal string.'
  );
}
const KEY = Buffer.from(encryptionKey, 'hex');

function isLegacyFormat(value) {
  // Legacy format: exactly "<32 hex chars>:<even-length hex ciphertext>"
  const parts = String(value || '').split(':');
  return parts.length === 2 && /^[0-9a-f]{32}$/i.test(parts[0]) &&
    parts[1].length > 0 && parts[1].length % 2 === 0 && /^[0-9a-f]+$/i.test(parts[1]);
}

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(GCM, KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${V2_PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
}

function decrypt(encryptedText) {
  const value = String(encryptedText || '');
  if (value.startsWith(V2_PREFIX)) {
    const parts = value.split(':');
    const [, ivHex, tagHex, dataHex] = parts;
    const shapeOk = parts.length === 4 &&
      /^[0-9a-f]{24}$/i.test(ivHex || '') &&
      /^[0-9a-f]{32}$/i.test(tagHex || '') &&
      (dataHex || '').length > 0 && dataHex.length % 2 === 0 && /^[0-9a-f]+$/i.test(dataHex);
    if (!shapeOk) {
      throw Object.assign(new Error('malformed v2 ciphertext'), { code: 'ENCRYPTION_FORMAT_UNKNOWN' });
    }
    const decipher = crypto.createDecipheriv(GCM, KEY, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
  }
  if (isLegacyFormat(value)) {
    const [ivHex, encrypted] = value.split(':');
    const decipher = crypto.createDecipheriv(CBC, KEY, Buffer.from(ivHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
  throw Object.assign(new Error('unrecognized ciphertext format'), { code: 'ENCRYPTION_FORMAT_UNKNOWN' });
}

function encryptionFormat(value) {
  if (String(value || '').startsWith(V2_PREFIX)) return 'v2-gcm';
  if (isLegacyFormat(value)) return 'v1-cbc';
  return 'unknown';
}

module.exports = { encrypt, decrypt, encryptionFormat, isLegacyFormat };
