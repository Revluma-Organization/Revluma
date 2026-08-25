const logger = require('../utils/logger');

module.exports = (err, req, res, next) => {
  const isProd = process.env.NODE_ENV === 'production';
  const exposeErrorDetails = process.env.EXPOSE_ERROR_DETAILS === 'true';

  // Structured error log — always includes request context
  logger.error('unhandled_error', {
    message: err.message,
    stack: err.stack,
    code: err.code,
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
    userId: req.user?.id || null,
  });

  // JWT Errors
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired access token',
    });
  }

  // Prisma Unique Constraint
  if (err.code === 'P2002') {
    return res.status(409).json({
      success: false,
      error: 'A record with this value already exists',
    });
  }

  // Prisma Record Not Found
  if (err.code === 'P2025') {
    return res.status(404).json({
      success: false,
      error: 'Record not found',
    });
  }

  // Prisma Table Missing
  if (err.code === 'P2021') {
    return res.status(500).json({
      success: false,
      error: 'Database table does not exist',
    });
  }

  const statusCode = err.statusCode || 500;

  if (!isProd) {
    return res.status(statusCode).json({
      success: false,
      error: err.message,
      stack: err.stack,
    });
  }

  return res.status(statusCode).json({
    success: false,
    error: exposeErrorDetails || statusCode !== 500
      ? err.message
      : 'An unexpected server error occurred',
    ...(exposeErrorDetails ? { stack: err.stack } : {}),
  });
};