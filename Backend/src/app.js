const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
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

module.exports = app;