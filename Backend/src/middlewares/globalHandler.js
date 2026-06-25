module.exports = (err, req, res, next) => {
  console.error('SYSTEM ERROR LOG:', err);

  // JWT Errors
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') 
    {
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired access token'
    });
  }

  // Prisma Unique Constraint
  if (err.code === 'P2002') {
    return res.status(409).json({
      success: false,
      error: 'A record with this value already exists'
    });
  }

  // Prisma Record Not Found
  if (err.code === 'P2025') {
    return res.status(404).json({
      success: false,
      error: 'Record not found'
    });
  }

  // Prisma Table Missing
  if (err.code === 'P2021') {
    return res.status(500).json({
      success: false,
      error: 'Database table does not exist'
    });
  }

  const statusCode = err.statusCode || 500;

  if (process.env.NODE_ENV === 'development') {
    return res.status(statusCode).json({
      success: false,
      error: err.message,
      stack: err.stack
    });
  }

  return res.status(statusCode).json({
    success: false,
    error:
      statusCode === 500
        ? 'An unexpected server error occurred'
        : err.message
  });
};