const dbConfig = require('../configs/database');
const prisma = dbConfig.prisma;

/**
 * Middleware: attach the user's organization membership to req.orgMembership.
 * Must be used AFTER authenticateToken.
 *
 * req.orgMembership = { organizationId, role, status, membershipId }
 */
async function attachOrgMembership(req, res, next) {
  try {
    const membership = await prisma.organization_members.findFirst({
      where: { user_id: req.user.id, status: 'active' },
      select: {
        id: true,
        organization_id: true,
        role: true,
        status: true,
      },
      orderBy: { created_at: 'asc' }, // oldest org first (owner)
    });

    if (!membership) {
      return res.status(403).json({
        success: false,
        error: 'You are not a member of any organization.',
      });
    }

    req.orgMembership = {
      membershipId: membership.id,
      organizationId: membership.organization_id,
      role: membership.role,
      status: membership.status,
    };

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Middleware factory: require one of the specified roles.
 * Must be used AFTER attachOrgMembership.
 *
 * Usage: requireRole('owner', 'admin')
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.orgMembership) {
      return res.status(403).json({ success: false, error: 'Organization context required.' });
    }
    if (!allowedRoles.includes(req.orgMembership.role)) {
      return res.status(403).json({
        success: false,
        error: `This action requires one of the following roles: ${allowedRoles.join(', ')}.`,
      });
    }
    next();
  };
}

module.exports = { attachOrgMembership, requireRole };
