const express = require("express");
const router = express.Router();

const preferencesController = require("../controller/preferencesController");
const {authenticateToken} = require("../middlewares/authMiddleware");

router.get( "/", authenticateToken, preferencesController.getPreferences);
router.put("/", authenticateToken, preferencesController.updatePreferences);
module.exports = router;