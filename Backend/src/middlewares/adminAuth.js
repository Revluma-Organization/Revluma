const crypto = require('crypto');
const dbConfig = require('../configs/database');
const prisma = dbConfig.prisma;
const logger = require('../utils/logger');

function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function hashApiKey(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Admin authentication middleware.
 * Checks in order:
 *   1. X-Admin-Key header against per-key DB records (production path)
 *   2. X-Admin-Key header against ADMIN_API_KEY env var (fallback for bootstrapping)
 *
 * Attaches req.adminKey = { id, name, scopes } on DB key match.
 */
async function requireAdminKey(req, res, next) {
  const provided = req.get('x-admin-key') || '';
  if (!provided) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const keyHash = hashApiKey(provided);

  // 1. Try DB-stored keys first
  try {
    const dbKey = await prisma.admin_api_keys.findUnique({
      where: { key_hash: keyHash },
    });

    if (dbKey) {
      // Check revocation
      if (dbKey.revoked_at) {
        logger.warn('admin_key_revoked', { name: dbKey.name, prefix: dbKey.prefix, ip: req.ip });
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      // Check expiry
      if (dbKey.expires_at && new Date() > dbKey.expires_at) {
        logger.warn('admin_key_expired', { name: dbKey.name, prefix: dbKey.prefix, ip: req.ip });
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      // Update last-used audit trail (fire-and-forget)
      prisma.admin_api_keys.update({
        where: { id: dbKey.id },
        data: { last_used_at: new Date(), last_used_ip: req.ip },
      }).catch(() => {});

      logger.info('admin_key_auth_ok', {
        name: dbKey.name,
        prefix: dbKey.prefix,
        ip: req.ip,
        method: req.method,
        path: req.originalUrl,
      });

      req.adminKey = {
        id: dbKey.id,
        name: dbKey.name,
        scopes: dbKey.scopes,
      };

      return next();
    }
  } catch (err) {
    // DB lookup failed — fall through to env var check
    logger.warn('admin_key_db_lookup_failed', { message: err?.message });
  }

  // 2. Fallback: static env var key (for bootstrapping / when DB isn't available)
  const expected = process.env.ADMIN_API_KEY;
  if (expected && timingSafeStringEqual(provided, expected)) {
    logger.info('admin_key_env_auth_ok', {
      ip: req.ip,
      method: req.method,
      path: req.originalUrl,
    });
    return next();
  }

  logger.warn('admin_key_auth_failed', { ip: req.ip, method: req.method, path: req.originalUrl });
  return res.status(401).json({ success: false, error: 'Unauthorized' });
}

module.exports = { requireAdminKey };