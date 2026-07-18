/**
 * Have I Been Pwned (HIBP) k-anonymity password breach check.
 * Only the first 5 chars of the SHA-1 hash are sent — never the password or full hash.
 * Fail-open: if HIBP is unreachable or times out, allow the password.
 */

const crypto = require('crypto');
const logger = require('./logger');

const HIBP_TIMEOUT_MS = 2500;

/**
 * @param {string} password
 * @returns {Promise<boolean>} true if the password appears in known breaches
 */
async function isPasswordPwned(password) {
  if (!password || typeof password !== 'string') return false;

  const sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HIBP_TIMEOUT_MS);

  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      method: 'GET',
      headers: {
        'Add-Padding': 'true',
        'User-Agent': 'Revluma-Auth',
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      logger.warn('hibp_unexpected_status', { status: res.status });
      return false; // fail open
    }

    const body = await res.text();
    return body.split('\n').some((line) => {
      const [hashSuffix] = line.trim().split(':');
      return hashSuffix === suffix;
    });
  } catch (err) {
    logger.warn('hibp_check_failed', { message: err?.message || err, note: 'fail-open' });
    return false;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { isPasswordPwned, HIBP_TIMEOUT_MS };
