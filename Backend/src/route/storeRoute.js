const express = require('express');
const router = express.Router();
const storeController = require('../controller/storeController');
const { authenticateToken } = require('../middlewares/authMiddleware');

router.get('/', authenticateToken, storeController.getStores);

module.exports = router;
