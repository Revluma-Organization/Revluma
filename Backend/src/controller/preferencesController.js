const { prisma } = require("../configs/database");
const logger = require("../utils/logger");

exports.getPreferences = async (req, res, next) => {
  try {
    let preferences = await prisma.userPreference.findUnique({
      where: {
        userId: req.user.id,
      },
    });

    if (!preferences) {
      preferences = await prisma.userPreference.create({
        data: {
          userId: req.user.id,
        },
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        theme: preferences.theme,
        language: preferences.language,
        timezone: preferences.timezone,
        date_format: preferences.dateFormat,
      },
    });
  } catch (error) {
    logger.error("get_preferences_failed", {
      userId: req.user?.id,
      message: error.message,
      stack: error.stack,
    });

    next(error);
  }
};


exports.updatePreferences = async (req, res, next) => {
  try {
    const {
      theme,
      language,
      timezone,
      date_format,
    } = req.body;

    const preferences = await prisma.userPreference.upsert({
      where: {
        userId: req.user.id,
      },
      update: {
        theme,
        language,
        timezone,
        dateFormat: date_format,
      },
      create: {
        userId: req.user.id,
        theme,
        language,
        timezone,
        dateFormat: date_format,
      },
    });

    return res.status(200).json({
      success: true,
      data: {
        theme: preferences.theme,
        language: preferences.language,
        timezone: preferences.timezone,
        date_format: preferences.dateFormat,
      },
    });
  } catch (error) {
    logger.error("update_preferences_failed", {
      userId: req.user?.id,
      message: error.message,
      stack: error.stack,
    });

    next(error);
  }
};