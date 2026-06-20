const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

// Temporary enterprise mock state (Simulating a secure DB table)
const usersTableMock = [];

exports.registerUser = async (req, res) => {
    try {
        const { fullName, email, password } = req.body;

        // 1. Business Logic: Check if user already exists
        const userExists = usersTableMock.find(user => user.email === email.toLowerCase());
        if (userExists) {
            return res.status(409).json({
                success: false,
                message: 'A user account with this email address already exists.'
            });
        }

        // 2. Cryptographic Security: Hash password with strong Salt Factor
        const salt = await bcrypt.genSalt(12); // Enterprise standard cost factor
        const hashedPassword = await bcrypt.hash(password, salt);

        // 3. Entity Creation: Structure object using a secure UUIDv4 instead of auto-increment integers
        const newUser = {
            id: uuidv4(), 
            fullName,
            email: email.toLowerCase(),
            password: hashedPassword, // Storing only the secure hash
            createdAt: new Date().toISOString()
        };

        // Persist to mock state
        usersTableMock.push(newUser);

        // 4. Clean Response: Never return the password or hash to the frontend
        return res.status(201).json({
            success: true,
            message: 'User account provisioned successfully.',
            user: {
                id: newUser.id,
                fullName: newUser.fullName,
                email: newUser.email,
                createdAt: newUser.createdAt
            }
        });

    } catch (error) {
        console.error(`Error in registerUser Controller: ${error.message}`);
        return res.status(500).json({
            success: false,
            message: 'An internal server error occurred while processing your request.'
        });
    }
};