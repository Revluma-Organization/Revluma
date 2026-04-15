const express = require('express');
const router = express.Router();
const { prisma } = require('../../services/prisma');
const logger = require('../../utils/logger');

// POST /api/admin/migrate
// Run database migrations
router.post('/migrate', async (req, res) => {
  try {
    // Add avatarUrl column if not exists
    await prisma.$executeRawUnsafe(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS "avatarUrl" TEXT;
    `);
    
    await prisma.$executeRawUnsafe(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);
    `);
    
    logger.info('Migration completed');
    res.json({ success: true, message: 'Migration completed' });
  } catch (error) {
    logger.error('Migration failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;