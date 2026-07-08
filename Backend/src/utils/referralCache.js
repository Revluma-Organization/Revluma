// utils/referralCache.js
const cache = new Map(); // code -> { valid: boolean, expiresAt: number }

const POSITIVE_TTL = 10 * 60 * 1000; 
const NEGATIVE_TTL = 30 * 1000;    

function getCached(code) {
  const entry = cache.get(code);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(code);
    return undefined;
  }
  return entry.valid;
}

function setCached(code, valid) {
  cache.set(code, {
    valid,
    expiresAt: Date.now() + (valid ? POSITIVE_TTL : NEGATIVE_TTL),
  });
}

module.exports = { getCached, setCached };