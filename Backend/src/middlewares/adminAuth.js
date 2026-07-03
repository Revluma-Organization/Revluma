const crypto = require('crypto');

function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireAdminKey(req, res, next) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) {
    return res.status(500).json({ success: false, error: 'Admin access is not configured' });
  }

  const provided = req.get('x-admin-key') || '';
  if (!provided || !timingSafeStringEqual(provided, expected)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  next();
}

module.exports = { requireAdminKey };