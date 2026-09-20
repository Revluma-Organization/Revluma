const express = require('express');
const router = express.Router();
const controller = require('../controller/commerceWebhookController');

router.post('/:provider/*topic', (req, res, next) => {
	req.params.topic = Array.isArray(req.params.topic)
		? req.params.topic.join('/')
		: req.params.topic;
	return controller.receive(req, res, next);
});

module.exports = router;
