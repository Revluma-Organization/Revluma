/**
 * Admin API Key Controller — per-key management with rotation and audit.
 *
 * Endpoints:
 *   POST   /admin/keys       — create a new admin API key
 *   GET    /admin/keys       — list all admin keys (hashed values never returned)
 *   DELETE /admin/keys/:id   — revoke an admin key
 */

const crypto = require('crypto');
const dbConfig = require('../configs/database');
const prisma = dbConfig.prisma;

const KEY_LENGTH_BYTES = 32;

function hashApiKey(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// ─── CREATE KEY ──────────────────────────────────────────────────────────────

exports.createKey = async (req, res, next) => {
  try {
    const { name, scopes, expires_in_days } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length < 1) {
      return res.status(400).json({ success: false, error: 'Key name is required.' });
    }

    const validScopes = ['read', 'write', 'admin'];
    const keyScopes = scopes || ['read', 'write'];
    if (!Array.isArray(keyScopes) || !keyScopes.every((s) => validScopes.includes(s))) {
      return res.status(400).json({
        success: false,
        error: `Scopes must be an array containing only: ${validScopes.join(', ')}`,
      });
    }

    const raw = crypto.randomBytes(KEY_LENGTH_BYTES).toString('hex');
    const keyHash = hashApiKey(raw);
    const prefix = raw.slice(0, 8);

    const expiresAt = expires_in_days
      ? new Date(Date.now() + expires_in_days * 24 * 60 * 60 * 1000)
      : null;

    const key = await prisma.admin_api_keys.create({
      data: {
        name: name.trim(),
        key_hash: keyHash,
        prefix,
        scopes: keyScopes,
        expires_at: expiresAt,
        created_by: req.user?.id || null,
      },
    });

    // Return the raw key ONCE — it's never stored or retrievable again
    return res.status(201).json({
      success: true,
      data: {
        id: key.id,
        name: key.name,
        key: raw, // ONLY time the raw key is shown
        prefix: key.prefix,
        scopes: key.scopes,
        expires_at: key.expires_at,
        message: 'Save this key now — it will not be shown again.',
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─── LIST KEYS ───────────────────────────────────────────────────────────────

exports.listKeys = async (req, res, next) => {
  try {
    const keys = await prisma.admin_api_keys.findMany({
      select: {
        id: true,
        name: true,
        prefix: true,
        scopes: true,
        last_used_at: true,
        last_used_ip: true,
        expires_at: true,
        revoked_at: true,
        created_at: true,
      },
      orderBy: { created_at: 'desc' },
    });

    return res.status(200).json({
      success: true,
      data: {
        keys: keys.map((k) => ({
          ...k,
          is_revoked: !!k.revoked_at,
          is_expired: k.expires_at ? new Date() > k.expires_at : false,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─── REVOKE KEY ──────────────────────────────────────────────────────────────

exports.revokeKey = async (req, res, next) => {
  try {
    const { id } = req.params;

    const key = await prisma.admin_api_keys.findUnique({ where: { id } });
    if (!key) {
      return res.status(404).json({ success: false, error: 'Key not found.' });
    }
    if (key.revoked_at) {
      return res.status(400).json({ success: false, error: 'Key is already revoked.' });
    }

    await prisma.admin_api_keys.update({
      where: { id },
      data: { revoked_at: new Date() },
    });

    return res.status(200).json({
      success: true,
      message: 'Admin key revoked.',
    });
  } catch (error) {
    next(error);
  }
};
