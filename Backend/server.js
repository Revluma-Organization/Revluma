const dotenv = require('dotenv');
dotenv.config();

process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err);
    process.exit(1);
});

const app = require('./src/app');
const { connectDB } = require('./src/configs/database');
const { startKeepAlive } = require('./src/utils/keepAlive');

connectDB();

// Start keep-alive service to prevent Render free tier sleep
startKeepAlive();

const PORT = process.env.PORT || 8080;

const server = app.listen(PORT, () => {
    console.log(`✅ Server is running on port ${PORT}`);
    console.log(`🔗 Backend URL: ${process.env.BACKEND_URL || 'Not configured'}`);
});

process.on('unhandledRejection', (err) => {
    console.error('UNHANDLED REJECTION:', err);

    server.close(() => {
        process.exit(1);
    });
});
