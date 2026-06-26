// Load environment variables immediately 
require('dotenv').config();

const REQUIRED_ENV_VARS = [
  'DATABASE_USER',
  'DATABASE_HOST',
  'DATABASE_PASSWORD',
  'DATABASE_PORT',
  'DATABASE_NAME',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'JWT_EXPIRES_IN',
  'REFRESH_TOKEN_EXPIRES_IN',
  'PORT',
  'NODE_ENV',
  'FRONTEND_URL'
];

const missingVars = [];

// Validate each required variable
REQUIRED_ENV_VARS.forEach((key) => {
  if (!process.env[key] || process.env[key].trim() === '') {
    missingVars.push(key);
  }
});

// If any variables are missing, halt the application instantly
if (missingVars.length > 0) {
  console.error('\n CRITICAL CONFIGURATION ERROR: Missing required environment variables!');
  console.error(`Missing keys: [ ${missingVars.join(', ')} ]`);
  console.error('Please check your local .env file before restarting the server.\n');
  process.exit(1); 
}

// Build a frozen, immutable configuration object
const env = Object.freeze({
  databaseUser: process.env.DATABASE_USER,
  databaseHost: process.env.DATABASE_HOST,
  databasePassword: process.env.DATABASE_PASSWORD,
  databasePort: parseInt(process.env.DATABASE_PORT),
  databaseName: process.env.DATABASE_NAME,
  jwtSecret: process.env.JWT_SECRET,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN,
  refreshTokenExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN,
  port: parseInt(process.env.PORT ),
  nodeEnv: process.env.NODE_ENV ,
  frontendUrl: process.env.FRONTEND_URL,
});

// Export using CommonJS syntax so database.js can safely require() it
module.exports = { env };