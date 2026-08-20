const express = require("express");

const router = express.Router();

const workspaceController = require("../controller/workspaceController");
const { authenticateToken } = require("../middlewares/authMiddleware");
const { attachOrgMembership,requireRole,} = require("../middlewares/orgAuth");
const uploadProfilePicture = require("../middlewares/uploadProfilePicture");

// Get current organization/workspace
router.get("/current",authenticateToken,attachOrgMembership,workspaceController.getCurrentWorkspace);

// Upload organization logo
router.post("/logo",authenticateToken,attachOrgMembership,requireRole("owner", "admin"),uploadProfilePicture.single("logo"),workspaceController.uploadWorkspaceLogo);

// Update organization details
router.patch("/current",authenticateToken,attachOrgMembership,requireRole("owner", "admin"),workspaceController.updateCurrentWorkspace);

module.exports = router;