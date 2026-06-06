const express = require('express');
const router = express.Router();
const { initiateAuth, authCallback } = require('../controllers/shopifyController');
const { authenticate } = require("../middleware/sessionAuth");

router.post('/auth/initiate', authenticate, initiateAuth);
router.get('/auth/callback', authCallback);

module.exports = router;