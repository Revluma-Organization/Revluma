const crypto = require('crypto');

/**
 * Constant-time comparison for secrets of arbitrary length (e.g. UUID access tokens).
 */
function secureCompareSecret(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') {
    return false;
  }
  const a = provided.trim();
  const b = expected.trim();
  if (!a || !b) return false;

  const hashA = crypto.createHash('sha256').update(a, 'utf8').digest();
  const hashB = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function normalizeAffiliateStatusForClient(status) {
  if (!status) return 'pending_review';
  return String(status).toLowerCase();
}

module.exports = {
  secureCompareSecret,
  normalizeAffiliateStatusForClient
};