require("dotenv").config();
const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

/*
 * Make the Node side of the database connection budget explicit.
 *
 * Verified against the production Supabase project on 2026-11-03:
 *   max_connections = 60, total_backends observed = 27
 *
 * The Python intelligence service holds its own pool of 12 (pool_size 8 plus
 * max_overflow 4). Prisma's default is `2 * CPU + 1`, which means the number of
 * connections this service opens depends on the size of the Render instance and
 * changes silently whenever that instance type changes, while the database limit
 * does not. An implicit pool can therefore exhaust the shared budget without any
 * code change in this repository.
 *
 * Setting the limit here makes the combined budget knowable and reviewable:
 *   Node (this service) + Python (12) must stay well under 60, leaving room for
 *   Supabase internals, the management API, edge functions and a second replica.
 *
 * Both values are only applied when the operator has not already set them on the
 * DSN, so an explicit production configuration always wins.
 */
const {
  applyConnectionBudget,
  PRISMA_CONNECTION_LIMIT,
  PRISMA_POOL_TIMEOUT_SECONDS,
} = require('../utils/dbConnectionBudget');

const budget = applyConnectionBudget(process.env.DATABASE_URL);
if (budget.applied) {
  process.env.DATABASE_URL = budget.url;
}

// Never log the DSN itself: it carries database credentials.
logger.info('database_connection_budget', {
  connection_limit: budget.connectionLimit ?? PRISMA_CONNECTION_LIMIT,
  pool_timeout_seconds: budget.poolTimeoutSeconds ?? PRISMA_POOL_TIMEOUT_SECONDS,
  limit_source: budget.applied ? 'applied_default' : 'operator_dsn',
  python_pool_budget: 12,
  supabase_max_connections: 60,
});

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
    logger.error('database_connection_failed', { error_type: error.code || error.name || 'connection_error' });
    throw error;
  }
};

const disconnectDB = async () => {
  await prisma.$disconnect();
  logger.info('database_disconnected');
};

// Export using a live getter so controllers always pull the current instance
module.exports = {
  get prisma() { return prisma; },
  connectDB,
  disconnectDB,
  applyConnectionBudget,
  PRISMA_CONNECTION_LIMIT,
  PRISMA_POOL_TIMEOUT_SECONDS,
};
