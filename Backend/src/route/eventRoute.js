const express = require ("express");
const router = express.Router();
const eventController = require("../controller/eventController");
const {ingestLimiter} = require("../middlewares/rateLimiter");

// Public endpoint
router.post ("/ingest", ingestLimiter, eventController.ingest );
module.exports = router;