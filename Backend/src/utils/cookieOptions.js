function isProductionLikeEnvironment(env = process.env) {
  if (!env) return false;

  const nodeEnv = String(env.NODE_ENV || '').toLowerCase();
  const render = String(env.RENDER || '').toLowerCase();
  const vercel = String(env.VERCEL || '').toLowerCase();
  const forwardedProto = String(env.FORWARDED_PROTO || '').toLowerCase();

  return (
    nodeEnv === 'production' ||
    render === 'true' ||
    vercel === '1' ||
    vercel === 'true' ||
    forwardedProto === 'https'
  );
}

function buildCookieOptions(req, overrides = {}) {
  const secure = isProductionLikeEnvironment(req?.headers ? {
    NODE_ENV: process.env.NODE_ENV,
    RENDER: process.env.RENDER,
    VERCEL: process.env.VERCEL,
    FORWARDED_PROTO: req.headers['x-forwarded-proto'] || req.headers['X-Forwarded-Proto'],
  } : process.env);

  return {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/',
    ...overrides,
  };
}

module.exports = {
  isProductionLikeEnvironment,
  buildCookieOptions,
};
