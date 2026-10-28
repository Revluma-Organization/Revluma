const { prisma } = require('../configs/database');
const { buildOperationalOverview } = require('../services/operationalOverviewPresenter');

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
    const stores = await prisma.stores.findMany({
      where: { organization_id: organizationId },
      select: { id: true },
    });
    const ids = stores.map(store => store.id);
    const [workflows, executions, alerts, recovery] = await Promise.all([
      prisma.sequences.findMany({
        where: { store_id: { in: ids } },
        select: { id: true, store_id: true, name: true, channel: true, status: true, delay_mins: true, updated_at: true },
        orderBy: { updated_at: 'desc' }, take: 30,
      }),
      prisma.sequence_sends.findMany({
        where: { store_id: { in: ids } },
        select: { id: true, sequence_id: true, store_id: true, channel: true, status: true, sent_at: true, delivered_at: true, created_at: true, updated_at: true },
        orderBy: { created_at: 'desc' }, take: 60,
      }),
      prisma.alert_queue.findMany({
        where: { organization_id: organizationId },
        select: { id: true, alert_type: true, severity: true, message: true, status: true, created_at: true, action_url: true },
        orderBy: { created_at: 'desc' }, take: 15,
      }),
      prisma.abandoned_carts.groupBy({
        by: ['status'],
        where: { store_id: { in: ids } },
        _count: { _all: true },
      }),
    ]);
    return res.json({
      success: true,
      data: buildOperationalOverview({ workflows, executions, alerts, recovery, storeCount: ids.length }),
    });
  } catch (error) { next(error); }
};
