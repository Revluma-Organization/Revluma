const express = require('express');
const router = express.Router();
const authenticate = require('../../middleware/auth');
const { prisma } = require('../../services/prisma');
const logger = require('../../utils/logger');

// ============================================================
// User Profile API
// ============================================================

// GET /api/v1/user/profile
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const tenantId = req.user.tenant_id;

    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId },
      include: { tenant: true }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        full_name: user.fullName,
        role: user.role,
        avatar_url: user.avatarUrl,
        email_verified: user.emailVerified,
        store_name: user.tenant?.storeName,
        onboarding_status: user.onboardingStatus
      }
    });
  } catch (error) {
    logger.error('Profile fetch failed', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// PUT /api/v1/user/profile
router.put('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { fullName, storeName } = req.body;

    // Update user
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        fullName: fullName || undefined,
        updatedAt: new Date()
      }
    });

    // Update tenant store name if provided
    if (storeName) {
      await prisma.tenant.update({
        where: { id: user.tenantId },
        data: { storeName }
      });
    }

    logger.info('Profile updated', { userId });

    res.json({
      success: true,
      data: {
        id: user.id,
        full_name: user.fullName,
        store_name: storeName
      }
    });
  } catch (error) {
    logger.error('Profile update failed', { error: error.message });
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// POST /api/v1/user/profile/avatar
router.post('/avatar', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { avatarData } = req.body; // base64 image data

    if (!avatarData) {
      return res.status(400).json({ error: 'Avatar data required' });
    }

    // In production, upload to S3/Cloudinary and get URL
    // For now, store as base64
    const avatarUrl = `data:image/png;base64,${avatarData}`;

    await prisma.user.update({
      where: { id: userId },
      data: { avatarUrl }
    });

    logger.info('Avatar updated', { userId });

    res.json({
      success: true,
      data: { avatar_url: avatarUrl }
    });
  } catch (error) {
    logger.error('Avatar update failed', { error: error.message });
    res.status(500).json({ error: 'Failed to update avatar' });
  }
});

module.exports = router;