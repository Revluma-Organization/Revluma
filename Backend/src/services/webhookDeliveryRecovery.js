/**
 * Durable recovery for abandoned webhook deliveries.
 *
 * A delivery row is claimed by flipping it to `received` before processing.
 * If the process dies mid-processing (deploy, OOM, crash) the row stays
 * `received` forever: the provider's redelivery hits
 * `WEBHOOK_DELIVERY_PENDING` and the event is effectively lost while the
 * ledger claims the event is "in flight".
 *
 * This module closes that gap without ever re-executing business logic on a
 * guess: it flips deliveries that have been `received` for longer than
 * `olderThanSeconds` to `failed` with an explicit audit reason. The existing
 * claim path (`failed` → `received` on provider redelivery) then makes the
 * next provider redelivery re-claimable. Nothing is re-sent, re-processed or
 * deleted by this module.
 *
 * Stale rows are detected by wall-clock age only. A delivery younger than the
 * threshold is untouched, so in-flight work is never disrupted.
 */
'use strict';

const { prisma } = require('../configs/database');
const logger = require('../utils/logger');

const DEFAULT_STALE_SECONDS = 15 * 60;
const MAX_BATCH = 200;
const ABANDON_REASON = 'delivery_abandoned: claimed but never completed; provider redelivery required';

async function recoverStuckDeliveries({
  db = prisma,
  olderThanSeconds = DEFAULT_STALE_SECONDS,
  limit = MAX_BATCH,
  now = new Date(),
} = {}) {
  const cutoff = new Date(now.getTime() - olderThanSeconds * 1000);
  // Fetch the bounded candidate set first so the update is scoped to explicit ids.
  const stale = await db.webhook_deliveries.findMany({
    where: { status: 'received', received_at: { lt: cutoff } },
    select: { id: true, provider: true, delivery_id: true, store_id: true, topic: true, received_at: true },
    orderBy: { received_at: 'asc' },
    take: Math.min(limit, MAX_BATCH),
  });
  if (!stale.length) return { recovered: 0, candidates: 0 };
  const ids = stale.map((row) => row.id);
  const update = await db.webhook_deliveries.updateMany({
    where: { id: { in: ids }, status: 'received' },
    data: { status: 'failed', last_error: ABANDON_REASON },
  });
  logger.warn('webhook_deliveries_abandoned_recovered', {
    recovered: update.count,
    candidates: stale.length,
    oldest_received_at: stale[0]?.received_at || null,
  });
  return { recovered: update.count, candidates: stale.length };
}

module.exports = { recoverStuckDeliveries, ABANDON_REASON, DEFAULT_STALE_SECONDS };
