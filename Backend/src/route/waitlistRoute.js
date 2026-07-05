const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/authMiddleware');

// GET /api/v1/stores
// Returns connected stores for the authenticated user's organization
// Stub: returns empty array until stores table migration runs (2.BE1.1)
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    // TODO 2.BE1.1: query stores table when migration is live
    // const stores = await prisma.stores.findMany({
    //   where: { organizations: { owner_id: req.user.id } },
    //   select: { id: true, platform: true, shop_domain: true, status: true, installed_at: true, last_synced_at: true }
    // });
    res.json({ success: true, data: { stores: [] } });
  } catch (error) {
    next(error);
  }
});

module.exports = router;