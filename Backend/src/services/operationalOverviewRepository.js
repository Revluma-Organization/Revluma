'use strict';
// Every query is constrained to authenticated organization's stores or organization ID.
// Never accept organization/store scope from query parameters.
async function fetchTenantOperations(prisma, organizationId) {
  const stores = await prisma.stores.findMany({
    where: { organization_id: organizationId, status: { not: 'deleted' } },
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
      by: ['status'], where: { store_id: { in: ids } }, _count: { _all: true },
    }),
  ]);
  return { workflows, executions, alerts, recovery, storeCount: ids.length };
}
module.exports = { fetchTenantOperations };
