const { prisma } = require('../configs/database');
const { summarizeExecutions } = require('../services/operationalExecutionSummary');

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
    const executionSummary = summarizeExecutions(executions);
    return res.json({
      success: true,
      data: {
        observed_at: new Date().toISOString(),
        scope: { stores: ids.length, execution_window: 'latest 60 records', workflows_window: 'latest 30 records' },
        workflows: workflows.map(row => ({ ...row, controls: { pause: false, resume: false, investigate: false, review_settings: true } })),
        executions: { recent: executions, ...executionSummary, counts_are_windowed: true },
        recovery: recovery.map(row => ({ status: row.status, count: row._count._all })),
        alerts,
        campaigns: { available_actions: [], reason: 'No campaign execution actions have been verified for Command Center.' },
        controls_verified: false,
      },
    });
  } catch (error) { next(error); }
};
