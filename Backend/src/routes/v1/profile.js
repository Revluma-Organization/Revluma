const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/sessionAuth');
const { prisma } = require('../../services/prisma');
const logger = require('../../utils/logger');

function buildProfilePayload(user) {
  return {
    id: user.id,
    email: user.email,
    full_name: user.fullName,
    display_name: user.displayName || user.fullName,
    avatar_url: user.avatarUrl || null,
    bio: user.bio || null,
    phone: user.phone || null,
    timezone: user.timezone || null,
    country: user.country || null,
    role: user.role,
    membership_tier: user.membershipTier || 'free',
    account_status: user.accountStatus || 'active',
    email_verified: user.emailVerified,
    onboarding_status: user.onboardingStatus,
    last_login_at: user.lastLoginAt?.toISOString() || null,
    created_at: user.createdAt?.toISOString() || null
  };
}

router.get('/', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        fullName: true,
        displayName: true,
        avatarUrl: true,
        bio: true,
        phone: true,
        timezone: true,
        country: true,
        role: true,
        membershipTier: true,
        accountStatus: true,
        emailVerified: true,
        onboardingStatus: true,
        lastLoginAt: true,
        createdAt: true
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ success: true, data: buildProfilePayload(user) });
  } catch (err) {
    logger.error('Profile fetch failed', { error: err.message, userId: req.user.id });
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

router.put('/', authenticate, async (req, res) => {
  try {
    const { fullName, displayName, bio, phone, timezone, country } = req.body;

    const updateData = {};
    if (fullName !== undefined) updateData.fullName = fullName;
    if (displayName !== undefined) updateData.displayName = displayName;
    if (bio !== undefined) updateData.bio = bio;
    if (phone !== undefined) updateData.phone = phone;
    if (timezone !== undefined) updateData.timezone = timezone;
    if (country !== undefined) updateData.country = country;
    updateData.updatedAt = new Date();

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: updateData,
      select: {
        id: true,
        email: true,
        fullName: true,
        displayName: true,
        avatarUrl: true,
        bio: true,
        phone: true,
        timezone: true,
        country: true,
        role: true,
        membershipTier: true,
        accountStatus: true,
        emailVerified: true,
        onboardingStatus: true,
        lastLoginAt: true,
        createdAt: true
      }
    });

    logger.info('Profile updated', { userId: req.user.id });

    res.json({ success: true, data: buildProfilePayload(user) });
  } catch (err) {
    logger.error('Profile update failed', { error: err.message, userId: req.user.id });
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'User not found' });
    }
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

module.exports = router;
