const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const globalErrorHandler = require('./middlewares/globalHandler');
const { apiLimiter } = require('./middlewares/rateLimiters');

const authRoutes = require('./route/authRoute');
const waitlistRoutes = require('./route/waitlistRoute');
const shopifyRoutes = require('./route/shopifyRoute');
const dashboardRoutes = require('./route/dashboardRoute');
const storeRoutes = require('./route/storeRoute');
const notificationRoutes = require('./route/notificationRoute');

const app = express();

// ── Trust proxy (required for Render, Railway, Vercel)
app.set('trust proxy', 1);

// ── Security headers (helmet)
app.use(helmet({
  contentSecurityPolicy: false, // CSP is handled at CDN level
  crossOriginEmbedderPolicy: false,
}));

// ── CORS
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:8080',
  'http://localhost:3000',
  'http://localhost:5173',
  'https://revluma.vercel.app',
  'https://revluma-git-main-revluma-organization.vercel.app',
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (Postman, mobile apps, curl)
    if (!origin) return callback(null, true);
    // Allow any *.vercel.app subdomain for preview deployments
    if (origin.endsWith('.vercel.app') || allowedOrigins.includes(origin)) {
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
app.use('/api/v1/waitlist', waitlistRoutes);
app.use('/api/v1/shopify', shopifyRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/stores', storeRoutes);
app.use('/api/v1/notifications', notificationRoutes);

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