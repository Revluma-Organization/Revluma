const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const globalErrorHandler = require("./middlewares/globalHandler")
const authRoutes = require('./route/authRoute');
const waitlistRoutes = require('./route/waitlistRoute');
const dashboardRoutes = require('./route/dashboardRoute');
const storeRoutes = require('./route/storeRoute');
const notificationRoutes = require('./route/notificationRoute');

const app = express();

// Trust the first reverse proxy
app.set("trust proxy", 1);

app.use(helmet());

//Global Middlewares
// CORS: allow multiple origins (local dev + Vercel production + preview deployments)
const allowedOrigins = [
    process.env.FRONTEND_URL,
    'http://localhost:8080',
    'http://localhost:3000',
    'http://localhost:5173',
    'https://revluma.vercel.app',
    'https://revluma-git-main-revluma-organization.vercel.app',
].filter(Boolean);

app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (mobile apps, curl, Postman)
        if (!origin) return callback(null, true);
        // Allow any vercel.app subdomain for preview deployments
        if (origin.endsWith('.vercel.app') || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(new Error('CORS: origin not allowed: ' + origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());
app.use(cookieParser());

//  API Routers
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/waitlist', waitlistRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/stores', storeRoutes);
app.use('/api/v1/notifications', notificationRoutes);

// Base API Checking Endpoint
app.get('/', (req, res) => {
    res.send('Revluma Backend API is running...');
});

// Health Check Endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date()
    });
});

// Always LAST
app.use(globalErrorHandler);

module.exports = app;