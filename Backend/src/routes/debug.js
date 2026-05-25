const express = require('express');
const logger = require('../utils/logger');
const { validateSession } = require('../middleware/sessionAuth');

const router = express.Router();

// Disabled in production — only available in development
router.get('/session-check', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }

  try {
    const sessionAuth = await validateSession(req, res);
    if (!sessionAuth) {
      return res.status(200).json({ session: null, authenticated: false });
    }

    // Never expose the raw session token — return only safe metadata
    return res.status(200).json({
      session: {
        tokenPrefix: sessionAuth.token ? `${sessionAuth.token.slice(0, 8)}…` : null,
        expiresAt: sessionAuth.expiresAt
      },
      user: {
        id: sessionAuth.user.id,
        email: sessionAuth.user.email,
        role: sessionAuth.user.role
      },
      authenticated: true,
      verified: sessionAuth.verified
    });
  } catch (err) {
    logger.error('Debug session-check failed', { error: err.message });
    return res.status(500).json({ error: 'Debug session-check failed' });
  }
});

module.exports = router;
