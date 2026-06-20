require("dotenv").config();
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');

// 💡 Explicitly mapping the parameters completely avoids the URL parsing validation error
const pool = new Pool({
  user: process.env.DATABASE_USER,
  host: process.env.DATABASE_HOST,
  database: 'postgres',
  password: process.env.DATABASE_PASSWORD,
  port: process.env.DATABASE_PORT,
  ssl: {
    rejectUnauthorized: false // Supabase requires SSL connections
  }
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const connectDB = async () => {
    try {
        await pool.query('SELECT 1');
        console.log('PostgreSQL Database connected✅ successfully via Driver Adapter to Supabase.');
    } catch (error) {
        console.error(`Unable to connect to the database: ${error.message}`);
        process.exit(1);
    }
};

module.exports = { prisma, connectDB };