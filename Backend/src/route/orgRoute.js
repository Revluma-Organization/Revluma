const express = require('express');
const router = express.Router();
const { body } = require('express-validator');

const orgMemberController = require('../controller/orgMemberController');
const { authenticateToken } = require('../middlewares/authMiddleware');
const { attachOrgMembership, requireRole } = require('../middlewares/orgAuth');
const { passwordResetLimiter } = require('../middlewares/rateLimiter');

// All org routes require authentication + org context
router.use(authenticateToken);
router.use(attachOrgMembership);

// ─── Members ─────────────────────────────────────────────────────────────────

// Invite a new member (owner/admin only)
router.post(
  '/members/invite',
  requireRole('owner', 'admin'),
  passwordResetLimiter,
  [
    body('email')
      .notEmpty().withMessage('Email is required')
      .isEmail().withMessage('Please provide a valid email address')
      .normalizeEmail(),
    body('role')
      .optional()
      .isIn(['admin', 'member']).withMessage('Role must be admin or member'),
  ],
  orgMemberController.inviteMember
);

// Accept an invite (logged-in user, any role)
router.post(
  '/members/invite/accept',
  passwordResetLimiter,
  [
    body('token').notEmpty().withMessage('Invite token is required'),
  ],
  orgMemberController.acceptInvite
);

// List all members (any authenticated org member)
router.get('/members', orgMemberController.listMembers);

// Remove a member (owner/admin, cannot remove self)
router.delete(
  '/members/:memberId',
  requireRole('owner', 'admin'),
  orgMemberController.removeMember
);

// Update a member's role (owner only)
router.patch(
  '/members/:memberId/role',
  requireRole('owner'),
  [
    body('role')
      .notEmpty().withMessage('Role is required')
      .isIn(['admin', 'member']).withMessage('Role must be admin or member'),
  ],
  orgMemberController.updateMemberRole
);

module.exports = router;
