'use strict';
const allowedStatuses = new Set(['acknowledged', 'resolved', 'dismissed']);
const allowedTypes = new Set(['integration_failure', 'revenue_change', 'order_volume_change', 'returning_customer_change']);
const allowedSeverity = new Set(['low', 'medium', 'high', 'critical']);
const uuid = value => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

async function persistVerifiedFindings(prisma, organizationId, findings) {
  let saved = 0;
  for (const candidate of findings) {
    if (!allowedTypes.has(candidate.type) || !allowedSeverity.has(candidate.severity) ||
        candidate.scope?.organizationId !== organizationId || !uuid(candidate.scope?.storeId) ||
        !candidate.evidence || candidate.evidence.verified !== true) continue;
    // Recheck store ownership, even when callers are trusted internal code.
    const store = await prisma.stores.findFirst({
      where: { id: candidate.scope.storeId, organization_id: organizationId },
      select: { id: true },
    });
    if (!store) continue;
    await prisma.intelligence_findings.upsert({
      where: { organization_id_dedupe_key: { organization_id: organizationId, dedupe_key: candidate.dedupe_key } },
      create: {
        organization_id: organizationId, store_id: store.id, type: candidate.type,
        severity: candidate.severity, title: candidate.title, description: candidate.description,
        evidence: candidate.evidence, action: candidate.action || undefined,
        dedupe_key: candidate.dedupe_key,
      },
      update: { severity: candidate.severity, title: candidate.title, description: candidate.description,
        evidence: candidate.evidence, updated_at: new Date() },
    });
    saved++;
  }
  return saved;
}
async function listFindings(prisma, organizationId, { status = 'open', limit = 25 } = {}) {
  const where = { organization_id: organizationId };
  if (status !== 'all') where.status = status;
  return prisma.intelligence_findings.findMany({
    where, orderBy: [{ detected_at: 'desc' }], take: Math.min(Math.max(Number(limit) || 25, 1), 100),
    select: { id: true, store_id: true, type: true, severity: true, status: true,
      title: true, description: true, evidence: true, action: true, detected_at: true,
      acknowledged_at: true, resolved_at: true, dismissed_at: true },
  });
}
async function changeFindingStatus(prisma, organizationId, id, status) {
  if (!uuid(id) || !allowedStatuses.has(status)) return { invalid: true };
  const stamp = new Date();
  const update = { status, updated_at: stamp };
  if (status === 'acknowledged') update.acknowledged_at = stamp;
  if (status === 'resolved') update.resolved_at = stamp;
  if (status === 'dismissed') update.dismissed_at = stamp;
  const result = await prisma.intelligence_findings.updateMany({
    where: { id, organization_id: organizationId, status: { in: ['open', 'acknowledged'] } },
    data: update,
  });
  return { changed: result.count === 1 };
}
module.exports = { persistVerifiedFindings, listFindings, changeFindingStatus };
