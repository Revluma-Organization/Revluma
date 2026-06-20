require("dotenv").config();
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');

// Use global memory to hold the instances across reloads/multiple imports
let prisma;
let pool;

if (!global.prismaInstance) {
  // 1. Initialize the single pg connection pool
  pool = new Pool({
    user: process.env.DATABASE_USER,
    host: process.env.DATABASE_HOST,
    database: 'postgres',
    password: process.env.DATABASE_PASSWORD,
    port: process.env.DATABASE_PORT,
    ssl: {
      rejectUnauthorized: false // Supabase requires SSL connections
    }
  });

  // 2. Set up the Driver Adapter and Client instance
  const adapter = new PrismaPg(pool);
  prisma = new PrismaClient({ 
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error']
  });

  // 3. Save them to global cache if we aren't in production
  if (process.env.NODE_ENV !== 'production') {
    global.prismaInstance = prisma;
    global.poolInstance = pool;
  }
} else {
  // Reuse the existing cached instances
  prisma = global.prismaInstance;
  pool = global.poolInstance;
}

// 4. Verification connection function
const connectDB = async () => {
  try {
    await pool.query('SELECT 1');
    console.log('PostgreSQL Database connected ✅ successfully via Driver Adapter to Supabase.');
  } catch (error) {
    console.error(`Unable to connect to the database: ${error.message}`);
    process.exit(1);
  }
};

module.exports = { prisma, connectDB };