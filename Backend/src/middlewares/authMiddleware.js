const jwt = require('jsonwebtoken');

const ALLOWED_ALGORITHMS = ['HS256'];
const JWT_ISSUER = 'revluma-api';
const JWT_AUDIENCE = 'revluma-client';

/**
 * Authenticates a request by verifying the JWT access token.
 * Accepts token from:
 *   1. Authorization: Bearer <token> header  (standard API calls)
 *   2. ?token=<token> query param            (browser redirect flows e.g. Shopify OAuth)
 *
 * Attaches req.user = { id, email, tenantId, jti } on success.
 */
const authenticateToken = (req, res, next) => {
  try {
    let token = null;

    const authHeader = req.headers.authorization;
    const alternateHeader = req.headers['x-access-token'] || req.headers['x-auth-token'] || req.headers['authorization'];

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (alternateHeader) {
      token = String(alternateHeader).startsWith('Bearer ') ? String(alternateHeader).split(' ')[1] : String(alternateHeader);
    } else if (req.query && req.query.token) {
      // Browser redirects cannot send Authorization headers
      token = req.query.token;
    } else if (req.cookies && req.cookies.access_token) {
      token = req.cookies.access_token;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    // Strict verification — enforce algorithm, issuer, audience
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ALLOWED_ALGORITHMS,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    // Enforce token type — only access tokens are valid here
    if (decoded.type !== 'access') {
      return res.status(401).json({
        success: false,
        error: 'Invalid token type',
      });
    }

    req.user = {
      id:        decoded.sub,
      email:     decoded.email,
      tenantId:  decoded.tenantId || null,
      jti:       decoded.jti,
      sessionId: decoded.sid || null,
    };

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired token',
    });
  }
};

module.exports = { authenticateToken, JWT_ISSUER, JWT_AUDIENCE, ALLOWED_ALGORITHMS };