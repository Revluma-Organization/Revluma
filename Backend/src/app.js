const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const globalErrorHandler = require("./middlewares/globalHandler")
const authRoutes = require('./route/authRoute');
const waitlistRoutes = require('./route/waitlistRoute');

const app = express();

// Trust the first reverse proxy
app.set("trust proxy", 1);

app.use(helmet());

//Global Middlewares
app.use(cors({
    origin: process.env.FRONTEND_URL,
    credentials: true
}));

app.use(express.json());
app.use(cookieParser());

//  API Routers
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/waitlist', waitlistRoutes);

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