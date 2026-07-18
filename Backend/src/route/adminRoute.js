const express = require('express');
const router = express.Router();
const { body } = require('express-validator');

const adminKeyController = require('../controller/adminKeyController');
const { requireAdminKey } = require('../middlewares/adminAuth');

// All admin routes require a valid admin key
router.use(requireAdminKey);

// ─── API Keys ────────────────────────────────────────────────────────────────

// Create a new admin API key
router.post(
  '/keys',
  [
    body('name')
      .notEmpty().withMessage('Key name is required')
      .isLength({ max: 100 }).withMessage('Key name must be 100 characters or less'),
    body('scopes')
      .optional()
      .isArray().withMessage('Scopes must be an array'),
    body('expires_in_days')
      .optional()
      .isInt({ min: 1, max: 365 }).withMessage('Expiry must be 1-365 days'),
  ],
  adminKeyController.createKey
);

// List all admin keys (no raw values returned)
router.get('/keys', adminKeyController.listKeys);

// Revoke an admin key
router.delete('/keys/:id', adminKeyController.revokeKey);

module.exports = router;
