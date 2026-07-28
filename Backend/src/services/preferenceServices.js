const { prisma } = require("../configs/database");

class PreferencesService {
  async getPreferences(userId) {
    let preferences = await prisma.userPreference.findUnique({
      where: {
        userId,
      },
    });

    // Create defaults if user has none
    if (!preferences) {
      preferences = await prisma.userPreference.create({
        data: {
          userId,
        },
      });
    }

    return preferences;
  }

  async updatePreferences(userId, data) {
    return prisma.userPreference.update({
      where: {
        userId,
      },
      data,
    });
  }
}

module.exports = new PreferencesService();