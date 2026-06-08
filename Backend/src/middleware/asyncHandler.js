/**
 * Wraps async Express route handlers to catch promise rejections
 * and forward them to the error handler middleware.
 *
 * Without this, Express 4 silently swallows unhandled promise rejections
 * in async route handlers, causing stalled requests and resource leaks.
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
