require("dotenv").config();
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

// 1. Initialize the PostgreSQL Pool immediately on file load
const pool = global.poolInstance || new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Supabase requires SSL connections
  }
});

// 2. Set up the Driver Adapter immediately
const adapter = global.prismaAdapterInstance || new PrismaPg(pool);

// 3. Instantiate the Prisma Client immediately so it is NEVER undefined when required
const prisma = global.prismaInstance || new PrismaClient({ 
  adapter,
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error']
});

// 4. Save to global cache in development to support hot-reloading smoothly
if (process.env.NODE_ENV !== 'production') {
  global.poolInstance = pool;
  global.prismaAdapterInstance = adapter;
  global.prismaInstance = prisma;
}

// 5. Verification connection function (called in server.js)
const connectDB = async () => {
  try {
    await pool.query('SELECT 1');
    logger.info('database_connected', { adapter: 'prisma-pg' });
  } catch (error) {
    logger.error('database_connection_failed', { message: error.message });
    process.exit(1);
  }
};

// Export using a live getter so controllers always pull the current instance
module.exports = { 
  get prisma() { return prisma; }, 
  connectDB 
};