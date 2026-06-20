const dotenv = require('dotenv');
const app = require('./src/app');
const {connectDB} = require ("./src/configs/database")

// Load environment variables
dotenv.config();

//Connect dataBase
connectDB ()

//Server
const PORT = process.env.PORT;
const server = app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

// Handle unhandled promise rejections gracefully 
process.on('unhandledRejection', (err) => {
    console.error(`Error: ${err.message}`);
    // Close server & exit process
    server.close(() => process.exit(1));
});