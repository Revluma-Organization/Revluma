const express = require('express');
const router = express.Router();
const { registerUser } = require('../controller/authController');
const { validateRegister } = require('../middlewares/validateAuth');

// Route: POST /api/v1/auth/register
router.post('/register', validateRegister, registerUser);

module.exports = router;