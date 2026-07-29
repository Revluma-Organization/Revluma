const express = require("express");
const router = express.Router();

const authController = require("../controller/SessionController");
const {authenticateToken} = require("../middlewares/authMiddleware");

router.get("/sessions",authenticateToken,authController.getSessions);
router.delete("/sessions/others",authenticateToken,authController.deleteOtherSessions);
router.delete("/sessions/:id",authenticateToken,authController.deleteSession);

module.exports = router;