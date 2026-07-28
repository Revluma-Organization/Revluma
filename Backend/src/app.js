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


// ── Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Catch-all for unknown routes
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Route not found.' });
});

// ── Global error handler (always last)
app.use(globalErrorHandler);

module.exports = app;