const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const globalErrorHandler = require('./middlewares/globalHandler');
const { apiLimiter } = require('./middlewares/rateLimiter');

const authRoutes = require('./route/authRoute');
const orgRoutes = require('./route/orgRoute');
const adminRoutes = require('./route/adminRoute');
const waitlistRoutes = require('./route/waitlistRoute');
const shopifyRoutes = require('./route/shopifyRoute');
const dashboardRoutes = require('./route/dashboardRoute');
const storeRoutes = require('./route/storeRoute');
const notificationRoutes = require('./route/notificationRoute');
const eventRoutes = require("./route/eventRoute");
const preferencesRoutes = require("./route/preferencesRoute");
const sessionRoutes = require("./route/SessionRoute");
const settingsRoutes = require("./route/settingsRoute");
const workspaceRoutes = require("./route/workspaceRoute");
const subscriptionRoutes = require("./route/subscriptionRoute");
const billingRoutes = require("./route/billingRoute");
const revRoutes           = require("./route/revRoute");
const memoryRoutes        = require("./route/memoryRoute");
const internalRoutes      = require('./route/internalRoute');
const commerceWebhookRoute = require('./route/commerceWebhookRoute');
const messageWebhookRoute = require('./route/messageWebhookRoute');
const subscriptionController = require('./controller/subscriptionController');
const { prisma } = require('./configs/database');
const { isRedisReady } = require('./configs/redis');
const { checkPythonHealth } = require('./services/mlService');



const app = express();

// ── Trust proxy (required for Render, Railway, Vercel)
app.set('trust proxy', 1);

// ── Security headers (helmet)
app.use(helmet({
  contentSecurityPolicy: false, // CSP is handled at CDN level
  crossOriginEmbedderPolicy: false,
}));

// ── CORS — explicit allowlist only (no *.vercel.app wildcard)
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:8080',
  'http://localhost:3000',
  'http://localhost:5173',
  'https://revluma.com',
  'https://app.revluma.com',
  'https://www.revluma.com',
  'https://revluma.vercel.app',
  'https://revluma-git-main-revluma-organization.vercel.app',
  // Exact URL for *this* Vercel deployment only (not any *.vercel.app subdomain)
  process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (Postman, mobile apps, curl, same-origin)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('CORS: origin not allowed'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Provider signatures cover the exact bytes, so webhook bodies must be raw.
app.use('/api/v1/webhooks', express.raw({ type: 'application/json', limit: '2mb' }), commerceWebhookRoute);
app.use('/api/v1/message-webhooks', express.raw({ type: 'application/json', limit: '2mb' }), messageWebhookRoute);
app.post('/api/v1/subscriptions/webhook', express.raw({ type: 'application/json', limit: '1mb' }), subscriptionController.webhook);

// ── Body parsing
app.use(express.json({ limit: '1mb' })); // Prevent oversized JSON bodies
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser(process.env.COOKIE_SECRET));

// ── Global API rate limiter
// Applied before routes. Pixel ingestion has its own stricter limiter.
app.use('/api/', apiLimiter);

// ── Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/org', orgRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/waitlist', waitlistRoutes);
app.use('/api/v1/shopify', shopifyRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/stores', storeRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/events', eventRoutes);
app.use("/api/v1/preferences", preferencesRoutes);
app.use("/api/v1/auth/",sessionRoutes);
app.use("/api/v1/settings",settingsRoutes);
app.use("/api/v1/workspace", workspaceRoutes);
app.use("/api/v1/subscriptions", subscriptionRoutes);
app.use("/api/v1/billing", billingRoutes);
app.use("/api/v1/rev",           revRoutes);
app.use("/api/v1/memory",        memoryRoutes);
app.use('/internal', internalRoutes);


// ── Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/ready', async (req, res) => {
  let databaseReady = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    databaseReady = true;
  } catch {
    databaseReady = false;
  }
  const python = await checkPythonHealth();
  const automationEnabled = process.env.BETA_AUTOMATION_KILL_SWITCH === 'false';
  const requiredAutomationConfig = [
    'BACKEND_URL',
    'SHOPIFY_API_KEY',
    'SHOPIFY_API_SECRET',
    'SHOPIFY_REDIRECT_URI',
    'SHOPIFY_TOKEN_ENCRYPTION_KEY',
    'SENDGRID_API_KEY',
    'SENDGRID_FROM_EMAIL',
    'SENDGRID_WEBHOOK_VERIFICATION_KEY',
  ];
  const automationConfigMissing = requiredAutomationConfig.filter(
    (name) => !String(process.env[name] || '').trim()
  );
  const redisConfigured = Boolean(process.env.REDIS_URL || process.env.REDIS_HOST);
  const automationReady = automationEnabled &&
    automationConfigMissing.length === 0 &&
    redisConfigured &&
    isRedisReady();
  const ready = databaseReady && python.healthy && (!automationEnabled || automationReady);
  return res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    database_ready: databaseReady,
    python_ready: python.healthy,
    python_model_status: python.modelStatus || null,
    python_models_missing: python.modelsMissing || [],
    beta_automation_enabled: automationEnabled,
    beta_automation_ready: automationReady,
    beta_automation_config_missing: automationConfigMissing,
    redis_ready: isRedisReady(),
  });
});

// ── Catch-all for unknown routes
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Route not found.' });
});

// ── Global error handler (always last)
app.use(globalErrorHandler);

module.exports = app;
