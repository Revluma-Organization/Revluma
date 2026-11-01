const { requireMembership } = require('../utils/organizationContext');
const { prisma } = require('../configs/database');
const { buildOperationalOverview } = require('../services/operationalOverviewPresenter');
const { fetchTenantOperations } = require('../services/operationalOverviewRepository');

// Read-only operational telemetry. All store-scoped records are constrained by
// authenticated active organization membership. No execution controls are exposed.
exports.getOperationalOverview = async (req, res, next) => {
  try {
    const member = await requireMembership(prisma, req.user.id, req.user.tenantId);
    const organizationId = member.organization_id;
    const records = await fetchTenantOperations(prisma, organizationId);
    return res.json({
      success: true,
      data: buildOperationalOverview(records),
    });
  } catch (error) { next(error); }
};
