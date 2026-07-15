const jwt = require('jsonwebtoken');
const {
  ALLOWED_ALGORITHMS,
  JWT_ISSUER,
  JWT_AUDIENCE,
} = require('./authMiddleware');

/**
 * Attaches req.user when a valid Bearer access token is present.
 * Never rejects — used by logout so expired access tokens still allow
 * refresh-token revocation via body/cookie.
 */
function optionalAuthenticate(req, _res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.split(' ')[1];
    if (!token) return next();

    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ALLOWED_ALGORITHMS,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    if (decoded.type !== 'access') return next();

    req.user = {
      id: decoded.sub,
      email: decoded.email,
      tenantId: decoded.tenantId || null,
      jti: decoded.jti,
    };
  } catch {
    // Expired / invalid access token — continue without req.user
  }
  return next();
}

module.exports = { optionalAuthenticate };
