const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const globalErrorHandler = require("./middlewares/globalHandler")
const authRoutes = require('./route/authRoute');

const app = express();

//Global Middlewares
app.use(cors({
    origin: process.env.FRONTEND_URL, // Update this as frontend scales
    credentials: true // Crucial for passing HttpOnly cookies later
}));

app.use(express.json());
app.use(cookieParser());

//  API Routers
app.use('/api/v1/auth', authRoutes);

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