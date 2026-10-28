const { prisma } = require('../configs/database');
const { buildOperationalOverview } = require('../services/operationalOverviewPresenter');
const { fetchTenantOperations } = require('../services/operationalOverviewRepository');

// Read-only operational telemetry. All store-scoped records are constrained by
// authenticated active organization membership. No execution controls are exposed.
exports.getOperationalOverview = async (req, res, next) => {
  try {
    const member = await prisma.organization_members.findFirst({
      where: { user_id: req.user.id, status: 'active' },
      select: { organization_id: true },
      orderBy: { created_at: 'asc' },
    });
    if (!member) return res.status(403).json({ success: false, error: { code: 'ORGANIZATION_REQUIRED' } });
    const organizationId = member.organization_id;
    const records = await fetchTenantOperations(prisma, organizationId);
    return res.json({
      success: true,
      data: buildOperationalOverview(records),
    });
  } catch (error) { next(error); }
};
