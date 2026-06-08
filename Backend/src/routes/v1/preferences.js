const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/sessionAuth');
const { prisma } = require('../../services/prisma');
const logger = require('../../utils/logger');

router.get('/', authenticate, async (req, res) => {
  try {
    let prefs = await prisma.userPreferences.findUnique({
      where: { userId: req.user.id }
    });

    if (!prefs) {
      prefs = await prisma.userPreferences.create({
        data: { userId: req.user.id }
      });
    }

    res.json({
      success: true,
      data: {
        theme: prefs.theme,
        date_format: prefs.dateFormat,
        time_format: prefs.timeFormat,
        currency: prefs.currency,
        language: prefs.language,
        sidebar_density: prefs.sidebarDensity,
        font_size: prefs.fontSize,
        notification_prefs: prefs.notificationPrefs
      }
    });
  } catch (err) {
    logger.error('Preferences fetch failed', { error: err.message, userId: req.user.id });
    res.status(500).json({ error: 'Failed to fetch preferences' });
  }
});

router.put('/', authenticate, async (req, res) => {
  try {
    const { theme, dateFormat, timeFormat, currency, language, sidebarDensity, fontSize, notificationPrefs } = req.body;

    const updateData = {};
    if (theme !== undefined) updateData.theme = theme;
    if (dateFormat !== undefined) updateData.dateFormat = dateFormat;
    if (timeFormat !== undefined) updateData.timeFormat = timeFormat;
    if (currency !== undefined) updateData.currency = currency;
    if (language !== undefined) updateData.language = language;
    if (sidebarDensity !== undefined) updateData.sidebarDensity = sidebarDensity;
    if (fontSize !== undefined) updateData.fontSize = fontSize;
    if (notificationPrefs !== undefined) updateData.notificationPrefs = notificationPrefs;
    updateData.updatedAt = new Date();

    const prefs = await prisma.userPreferences.upsert({
      where: { userId: req.user.id },
      update: updateData,
      create: {
        userId: req.user.id,
        ...updateData
      }
    });

    logger.info('Preferences updated', { userId: req.user.id });

    res.json({
      success: true,
      data: {
        theme: prefs.theme,
        date_format: prefs.dateFormat,
        time_format: prefs.timeFormat,
        currency: prefs.currency,
        language: prefs.language,
        sidebar_density: prefs.sidebarDensity,
        font_size: prefs.fontSize,
        notification_prefs: prefs.notificationPrefs
      }
    });
  } catch (err) {
    logger.error('Preferences update failed', { error: err.message, userId: req.user.id });
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

module.exports = router;
