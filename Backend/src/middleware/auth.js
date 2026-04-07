const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  // Missing or invalid header
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn('Missing or invalid Authorization header', { ip: req.ip });
    return res.status(401).json({ error: 'Authentication required: Bearer token expected' });
  }

  const token = authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'], // enforce algorithm
      ignoreExpiration: false
    });

    // Basic claims check
    if (!decoded.id || !decoded.tenant_id || !decoded.email) {
      throw new Error('Invalid token claims');
    }

    // Set user for all subsequent requests
    req.user = {
      id: decoded.id,
      email: decoded.email,
      tenant_id: decoded.tenant_id,
      role: decoded.role || 'user'
    };

    next();
  } catch (err) {
    let status = 401;
    let message = 'Invalid or expired token';

    if (err.name === 'TokenExpiredError') {
      message = 'Token has expired';
    } else if (err.name === 'JsonWebTokenError') {
      message = 'Malformed token';
    } else {
      logger.error('JWT verification failed', {
        error: err.message,
        stack: err.stack,
        ip: req.ip,
        tokenPrefix: token.substring(0, 10) + '...'
      });
      status = 500;
      message = 'Authentication error';
    }

    return res.status(status).json({ error: message });
  }
};

module.exports = authenticate;