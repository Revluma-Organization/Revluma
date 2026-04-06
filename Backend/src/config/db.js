// ============================================================
// Database Configuration Module
// Production-ready PostgreSQL connection with proper validation
// ============================================================

const { Pool } = require('pg');

// ============================================================
// Environment Validation - Fail Fast
// ============================================================

function validateEnvironment() {
  const errors = [];
  
  // Check DATABASE_URL
  const dbUrl = process.env.DATABASE_URL;
  
  if (!dbUrl) {
    errors.push('DATABASE_URL is not set');
  } else {
    // Trim and validate format
    const trimmedUrl = dbUrl.trim();
    const validPrefix = /^postgres(ql)?:\/\//i;
    
    if (!validPrefix.test(trimmedUrl)) {
      errors.push(`DATABASE_URL must start with "postgres://" or "postgresql://". Got: "${trimmedUrl.substring(0, 20)}..."`);
    }
  }
  
  return errors;
}

// Run validation immediately
const validationErrors = validateEnvironment();
if (validationErrors.length > 0) {
  console.error('=== DATABASE CONFIGURATION ERROR ===');
  validationErrors.forEach(err => console.error('  - ' + err));
  console.error('======================================');
  console.error('Please set DATABASE_URL in your environment variables.');
  console.error('For local dev, create a .env file with DATABASE_URL=postgres://...');
  console.error('For Render, add DATABASE_URL in your service\'s Environment Variables.');
  console.error('');
  // In production, we exit. In dev, we continue but DB won't work.
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

// ============================================================
// Database Connection Setup
// ============================================================

const dbUrl = process.env.DATABASE_URL ? process.env.DATABASE_URL.trim() : null;
const isProduction = process.env.NODE_ENV === 'production';

// SSL Configuration for Production
const getSslConfig = () => {
  // No SSL in development
  if (!isProduction) {
    return false;
  }
  
  // Check if user explicitly disabled SSL
  if (dbUrl && dbUrl.includes('sslmode=disable')) {
    return false;
  }
  
  // For Render and cloud providers - allow self-signed certs
  return {
    rejectUnauthorized: false
  };
};

// Create connection pool
let pool = null;

if (dbUrl) {
  const poolConfig = {
    connectionString: dbUrl,
    ssl: getSslConfig(),
    max: 20,                    // Max connections in pool
    idleTimeoutMillis: 30000,   // Close idle clients after 30s
    connectionTimeoutMillis: 10000, // Return error after 10s if can't connect
    allowExitOnIdle: false
  };
  
  pool = new Pool(poolConfig);
  
  // Handle pool errors
  pool.on('error', (err, client) => {
    console.error('[DB] Unexpected pool error:', err.message);
  });
  
  console.log('[DB] Connection pool created');
  console.log('[DB] SSL enabled:', !!getSslConfig());
}

// ============================================================
// Exported Functions
// ============================================================

/**
 * Get the pool instance
 * Throws if pool not initialized
 */
function getPool() {
  if (!pool) {
    throw new Error('Database connection pool not initialized. Check DATABASE_URL.');
  }
  return pool;
}

/**
 * Execute a query with parameters
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise} Query result
 */
async function query(text, params = []) {
  const p = getPool();
  try {
    const result = await p.query(text, params);
    return result;
  } catch (err) {
    console.error('[DB] Query error:', err.message);
    throw err;
  }
}

/**
 * Execute a query and return just the rows
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Array>} Array of rows
 */
async function queryRows(text, params = []) {
  const result = await query(text, params);
  return result.rows;
}

/**
 * Execute a query and return a single row
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Object|null>} Single row or null
 */
async function queryOne(text, params = []) {
  const result = await query(text, params);
  return result.rows[0] || null;
}

/**
 * System query - for operations that don't need tenant context (auth, migrations, etc.)
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise} Query result
 */
async function systemQuery(text, params = []) {
  return await query(text, params);
}

/**
 * Get a client from the pool for transactions
 * IMPORTANT: Always release the client after use!
 * @returns {Promise<Object>} Connected client
 */
async function getClient() {
  const p = getPool();
  return await p.connect();
}

/**
 * Health check - verify database connection
 * @returns {Promise<boolean>} True if connected
 */
async function checkConnection() {
  if (!pool) {
    console.error('[DB] Cannot check connection - pool not initialized');
    return false;
  }
  
  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
      console.log('[DB] ✓ Health check passed');
      return true;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[DB] ✗ Health check failed:', err.message);
    return false;
  }
}

/**
 * Close the pool (for graceful shutdown)
 */
async function closePool() {
  if (pool) {
    await pool.end();
    console.log('[DB] Pool closed');
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  pool: pool,            // Raw pool (for direct access if needed)
  getPool,
  query,
  queryRows,
  queryOne,
  getClient,
  checkConnection,
  closePool
};

// ============================================================
// Initial Connection Test (non-blocking)
// ============================================================

if (pool) {
  // Try to connect but don't block startup
  pool.query('SELECT 1')
    .then(() => {
      console.log('[DB] ✓ Initial connection successful');
    })
    .catch(err => {
      console.error('[DB] ✗ Initial connection failed:', err.message);
    });
}