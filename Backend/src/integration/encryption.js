const crypto = require('crypto');

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getMasterKey() {
  const key = process.env.CREDENTIALS_MASTER_KEY;
  if (!key) {
    throw new Error('CREDENTIALS_MASTER_KEY environment variable not set');
  }
  return Buffer.from(key, 'hex');
}

function deriveStoreKey(storeId) {
  const masterKey = getMasterKey();
  const hkdf = crypto.createHmac('sha256', masterKey);
  hkdf.update(storeId);
  return hkdf.digest();
}

function encryptCredentials(credentials, storeId) {
  const storeKey = deriveStoreKey(storeId);
  const iv = crypto.randomBytes(IV_LENGTH);
  
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, storeKey, iv, {
    authTagLength: AUTH_TAG_LENGTH
  });
  
  const credentialsJson = JSON.stringify(credentials);
  const encrypted = Buffer.concat([
    cipher.update(credentialsJson, 'utf8'),
    cipher.final()
  ]);
  
  const authTag = cipher.getAuthTag();
  
  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64')
  ].join(':');
}

function decryptCredentials(encryptedData, storeId) {
  const storeKey = deriveStoreKey(storeId);
  const parts = encryptedData.split(':');
  
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }
  
  const iv = Buffer.from(parts[0], 'base64');
  const authTag = Buffer.from(parts[1], 'base64');
  const encrypted = Buffer.from(parts[2], 'base64');
  
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, storeKey, iv, {
    authTagLength: AUTH_TAG_LENGTH
  });
  
  decipher.setAuthTag(authTag);
  
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ]);
  
  return JSON.parse(decrypted.toString('utf8'));
}

function maskCredentials(credentials) {
  const masked = { ...credentials };
  
  for (const key of Object.keys(masked)) {
    if (key.toLowerCase().includes('token') || 
        key.toLowerCase().includes('secret') ||
        key.toLowerCase().includes('key')) {
      const value = masked[key];
      if (typeof value === 'string' && value.length > 4) {
        masked[key] = value.substring(0, 4) + '****' + value.substring(value.length - 4);
      }
    }
  }
  
  return masked;
}

module.exports = {
  encryptCredentials,
  decryptCredentials,
  maskCredentials,
  deriveStoreKey,
  getMasterKey
};