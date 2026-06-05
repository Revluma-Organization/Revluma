/**
 * Shared authentication utilities
 * Single source of truth — do not duplicate these functions in route files
 *
 * FIX (Password History Cap): checkPasswordHistory now accepts an optional
 * pruneAfter parameter (default 10). After checking history, any entries
 * beyond the cap are deleted to prevent unbounded growth.
 */

/**
 * Validates password strength.
 * Returns { valid: true } or { valid: false, error: string }
 */
function validatePasswordStrength(password) {
  if (typeof password !== 'string') {
    return { valid: false, error: 'Password must be a string' };
  }
  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters long' };
  }
  if (password.length > 128) {
    return { valid: false, error: 'Password must be no more than 128 characters long' };
  }

  const weakPatterns = [
    /^12345678/, /^password/i, /^qwerty/i, /^abc123/i,
    /^admin/i, /^user/i, /^login/i, /^welcome/i,
    /^letmein/i, /^monkey/i, /^dragon/i, /^passw0rd/i, /^p@ssw0rd/i
  ];
  for (const pattern of weakPatterns) {
    if (pattern.test(password)) {
      return { valid: false, error: 'Password contains common patterns that are easily guessed' };
    }
  }

  if (/(.)\\1{2,}/.test(password)) {
    return { valid: false, error: 'Password cannot contain repeated characters' };
  }

  if (
    /123|234|345|456|567|678|789|890|abc|bcd|cde|def|efg|fgh|ghi|hij|ijk|jkl|klm|lmn|mno|nop|opq|pqr|qrs|rst|stu|tuv|uvw|vwx|wxy|xyz/i.test(
      password
    )
  ) {
    return { valid: false, error: 'Password cannot contain sequential characters' };
  }

  const hasLower   = /[a-z]/.test(password);
  const hasUpper   = /[A-Z]/.test(password);
  const hasDigit   = /\d/.test(password);
  const hasSpecial = /[^a-zA-Z\d]/.test(password);
  const categories = [hasLower, hasUpper, hasDigit, hasSpecial].filter(Boolean).length;

  if (categories < 3) {
    return { valid: false, error: 'Password must include at least 3 of: uppercase, lowercase, numbers, symbols' };
  }

  return { valid: true };
}

/**
 * Basic email format validation
 */
function validateEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 255;
}

/**
 * Normalize email to lowercase trimmed string
 */
function normalizeEmail(email) {
  return typeof email === 'string' ? email.toLowerCase().trim() : '';
}

/**
 * Check that the new password has not been used in the last N passwords.
 * Fails open — if the DB check errors, allow the password change so users
 * are never locked out by a transient DB failure.
 *
 * Also prunes old password history entries beyond `pruneAfter` (default 10)
 * to keep the PasswordHistory table bounded.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string}  userId
 * @param {string}  plaintextPassword  — the raw new password to compare
 * @param {import('bcryptjs')} bcrypt
 * @param {object}  [logger]
 * @param {number}  [lookback=5]       — number of passwords to check for reuse
 * @param {number}  [pruneAfter=10]    — cap total history rows per user
 */
async function checkPasswordHistory(prisma, userId, plaintextPassword, bcrypt, logger, lookback = 5, pruneAfter = 10) {
  try {
    // Fetch all history for this user ordered newest-first
    const allPasswords = await prisma.passwordHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });

    // Check the most recent `lookback` entries for reuse
    const toCheck = allPasswords.slice(0, lookback);
    for (const history of toCheck) {
      const isSame = await bcrypt.compare(plaintextPassword, history.passwordHash);
      if (isSame) {
        return { valid: false, error: `You cannot reuse one of your last ${lookback} passwords.` };
      }
    }

    // Prune entries beyond `pruneAfter` cap (fire-and-forget — non-blocking)
    if (allPasswords.length > pruneAfter) {
      const toDelete = allPasswords.slice(pruneAfter).map(r => r.id);
      prisma.passwordHistory.deleteMany({ where: { id: { in: toDelete } } }).catch(pruneErr => {
        if (logger) logger.warn('Password history pruning failed', { error: pruneErr.message, userId });
      });
    }

    return { valid: true };
  } catch (error) {
    if (logger) logger.warn('Password history check failed', { error: error.message, userId });
    return { valid: true };
  }
}

module.exports = { validatePasswordStrength, validateEmail, normalizeEmail, checkPasswordHistory };