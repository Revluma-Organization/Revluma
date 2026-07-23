const express = require("express");
const router = express.Router();

const { authenticateToken } = require("../middlewares/authMiddleware");
const shopifyController = require("../controller/shopifyController");

// Install Shopify App
router.post("/start",authenticateToken, shopifyController.startShopify);

router.get("/install", shopifyController.installShopify );

// OAuth Callback
router.get("/callback", shopifyController.shopifyCallback );

module.exports = router;