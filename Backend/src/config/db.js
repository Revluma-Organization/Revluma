// Production-ready PostgreSQL connection pool with tenant-aware RLS support
// Features: connection pooling, tenant context (RLS), error handling, health checks

const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';
const hasDbUrl = process.env.DATABASE_URL && (process.env.DATABASE_URL.startsWith('postgresql') || process.env.DATABASE_URL.startsWith('postgres'));

// Only create pool if DATABASE_URL is set
const pool = hasDbUrl ? new Pool({
  connectionString: process.env.DATABASE_URL,
  // Production SSL – NEVER disable verification in real prod
  // For local dev, use sslmode=disable in DATABASE_URL
  ssl: isProduction && !process.env.DATABASE_URL?.includes('sslmode=disable') ? {
    rejectUnauthorized: true,
    ca: process.env.DB_CA_CERT || undefined,
  } : false,

  // Production tuning
  max: 20,                // max connections (adjust based on traffic)
  idleTimeoutMillis: 30000, // close idle after 30s
  connectionTimeoutMillis: 5000, // fail fast if DB unreachable
  allowExitOnIdle: false,
}) : null;

// Error handling on pool creation
if (pool) {
  pool.on('error', (err, client) => {
    console.error('Unexpected error on idle client', err.message);
    if (isProduction) {
      process.exit(-1);
    }
  });
}

// Health check function (use in startup or monitoring)
async function checkConnection() {
  if (!pool || !hasDbUrl) {
    return false;
  }
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    return true;
  } catch (err) {
    console.error('DB connection health check failed', err);
    return false;
  } finally {
    client.release();
  }
}

// Critical: Set tenant context for RLS before EVERY query
async function withTenantContext(tenantId, callback) {
  if (!tenantId) throw new Error('tenantId required for RLS');

  const client = await pool.connect();
  try {
    // Validate tenant ID format - allow 'system' or valid UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (tenantId !== 'system' && !uuidRegex.test(tenantId)) {
      throw new Error('Invalid tenant ID format');
    }
    
    // Set tenant for this connection/session using safe string
    await client.query(`SET app.current_tenant_id = '${tenantId}'`);

    // Execute the callback (query) with the context set
    return await callback(client);
  } finally {
    client.release(); // ALWAYS release client back to pool
  }
}

// Safe query wrapper – enforces tenant context
async function query(text, params = [], tenantId = null) {
  if (!tenantId) {
    throw new Error('tenantId is required for all queries (RLS enforcement)');
  }

  return withTenantContext(tenantId, async (client) => {
    try {
      const result = await client.query(text, params);
      return result;
    } catch (err) {
      console.error('Query failed', { text, params, tenantId, error: err.message });
      throw err; // let caller handle
    }
  });
}

// Non-tenant query for system operations
async function systemQuery(text, params = []) {
  if (!pool) {
    throw new Error('Database not configured');
  }
  try {
    const result = await pool.query(text, params);
    return result;
  } catch (err) {
    console.error('System query failed', { text, params, error: err.message });
    throw err;
  }
}

// Export
module.exports = {
  query,
  pool,
  checkConnection,
  withTenantContext,
  systemQuery
};

// Startup health check (call once on server start)
(async () => {
  if (!process.env.DATABASE_URL) {
    console.warn('⚠️  DATABASE_URL not set — DB queries will fail until configured');
    console.warn('⚠️  Server continuing in limited mode (no database)');
    return;
  }
  try {
    const healthy = await checkConnection();
    if (!healthy) {
      console.warn('⚠️  Database connection failed — continuing in limited mode');
      return;
    }
    console.log('PostgreSQL connection pool initialized and healthy');
  } catch (err) {
    console.warn('⚠️  Database connection error — continuing without DB:', err.message);
  }
})();
