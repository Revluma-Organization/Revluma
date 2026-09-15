const crypto = require('crypto');

function timingSafeStringEqual(actual, expected) {
  if (!actual || !expected) return false;

  const actualBuffer = Buffer.from(String(actual));
  const expectedBuffer = Buffer.from(String(expected));

  return (
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function requireInternalKey(req, res, next) {
  const providedKey = req.get('x-internal-key');

  if (!timingSafeStringEqual(providedKey, process.env.ML_INTERNAL_KEY)) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
    });
  }

  next();
}

module.exports = { requireInternalKey };