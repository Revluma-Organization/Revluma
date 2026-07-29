require("dotenv").config();
const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

// Instantiate the Prisma client once and reuse it across the app.
const prisma = global.prismaInstance || new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
  global.prismaInstance = prisma;
}

// Verification connection function (called in server.js)
const connectDB = async () => {
  try {
    await prisma.$connect();
    logger.info('database_connected', { adapter: 'prisma' });
  } catch (error) {
    logger.error('database_connection_failed', { message: error.message });
    process.exit(1);
  }
};

// Export using a live getter so controllers always pull the current instance
module.exports = {
  get prisma() { return prisma; },
  connectDB,
};