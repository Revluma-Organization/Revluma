const express = require('express');
const router = express.Router();
const controller = require('../controller/messageWebhookController');

router.post('/:provider', controller.receive);

module.exports = router;
