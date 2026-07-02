// Render Free Tier Keep-Alive Service
// Pings backend every 10 minutes to prevent auto-sleep
// This keeps your Revluma backend running 24/7

const axios = require('axios');
require('dotenv').config();

const BACKEND_URL = process.env.BACKEND_URL || 'https://revluma-backend.onrender.com';
const PING_INTERVAL = 10 * 60 * 1000; // 10 minutes in milliseconds

// Keep-alive function
const keepAliveBackend = async () => {
  try {
    const response = await axios.get(`${BACKEND_URL}/health`, {
      timeout: 5000,
    });
    
    const timestamp = new Date().toISOString();
    console.log(`✅ [${timestamp}] Backend health check passed`);
    console.log(`   Status: ${response.status}`);
    console.log(`   Response: ${JSON.stringify(response.data)}`);
    
    return true;
  } catch (error) {
    const timestamp = new Date().toISOString();
    console.error(`❌ [${timestamp}] Backend health check failed`);
    console.error(`   Error: ${error.message}`);
    
    // Retry logic - try again in 1 minute if failed
    console.log('   Retrying in 1 minute...');
    setTimeout(keepAliveBackend, 60 * 1000);
    
    return false;
  }
};

// Start the keep-alive service
const startKeepAlive = () => {
  const timestamp = new Date().toISOString();
  console.log(`🚀 [${timestamp}] Starting Keep-Alive Service`);
  console.log(`   Backend URL: ${BACKEND_URL}`);
  console.log(`   Ping Interval: Every 10 minutes`);
  console.log(`   Purpose: Prevent Render free tier auto-sleep\n`);
  
  // Initial ping immediately
  keepAliveBackend();
  
  // Then ping every 10 minutes
  setInterval(keepAliveBackend, PING_INTERVAL);
};

// Handle errors gracefully
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Export for use in other files
module.exports = { startKeepAlive, keepAliveBackend };

// Start if run directly
if (require.main === module) {
  startKeepAlive();
}
