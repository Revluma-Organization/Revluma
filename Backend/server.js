const dotenv = require('dotenv');
dotenv.config();

process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err);
    process.exit(1);
});

const app = require('./src/app');
const { connectDB } = require('./src/configs/database');

connectDB();

const PORT = process.env.PORT;

const server = app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

process.on('unhandledRejection', (err) => {
    console.error('UNHANDLED REJECTION:', err);

    server.close(() => {
        process.exit(1);
    });
});