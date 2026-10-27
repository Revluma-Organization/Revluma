'use strict';
const { detectIntegrationFailure, detectRevenueChange, detectReturningCustomerChange, prioritizeFindings } = require('./intelligenceFindingsEngine');

const DAY = 86400000;
const windowIso = ms => new Date(ms).toISOString();
const sameCurrency = rows => [...new Set(rows.map(row => row.currency))];
const safeNumber = value => Number(value);
const verifiedSync = store => store.status === 'connected' &&
  store.last_synced_at && store.sync_status === 'succeeded' && store.setup_status === 'succeeded';

/**
 * Read-only candidate evaluation. Never assumes that a connected store has
 * complete historical order coverage. Explicit data completeness is required
 * for business findings; integration failures remain reportable independently.
 */
async function evaluateOrganizationFindings(prisma, organizationId, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const periodDays = options.periodDays || 7;
  const currentEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const currentStart = currentEnd - periodDays * DAY;
  const previousStart = currentStart - periodDays * DAY;
  const stores = await prisma.stores.findMany({
    where: { organization_id: organizationId },
    select: { id: true, status: true, last_synced_at: true, platform: true, shop_domain: true },
  });
  const candidates = [];
  const diagnostics = [];
  for (const store of stores) {
    const scope = { organizationId, storeId: store.id };
    const registrationFailures = await prisma.webhook_registrations.count({
      where: { store_id: store.id, status: 'failed' },
    });
    const integration = detectIntegrationFailure({
      scope,
      store: { ...store, setup_status: registrationFailures > 0 ? 'failed' : null },
      now,
    });
    if (integration) {
      integration.evidence.failed_webhook_registrations = registrationFailures;
      candidates.push(integration);
    }
    if (!verifiedSync(store) || registrationFailures > 0) {
      diagnostics.push({ storeId: store.id, status: 'insufficient_sync_verification' });
      continue;
    }
    // Shopify API coverage may be partial even after sync success. Never
    // infer historical completeness from order counts or connection status.
    if (!store.history_coverage_verified) { // Not present until durable ingestion attestation is implemented.
      diagnostics.push({ storeId: store.id, status: 'order_history_completeness_unverified' });
      continue;
    }
    const orders = await prisma.orders.findMany({
      where: { store_id: store.id, ordered_at: { gte: new Date(previousStart), lt: new Date(currentEnd) } },
      select: { customer_id: true, total: true, currency: true, ordered_at: true },
    });
    const currencies = sameCurrency(orders);
    if (currencies.length !== 1 || !orders.length) {
      diagnostics.push({ storeId: store.id, status: 'mixed_currency_or_no_orders' });
      continue;
    }
    const current = orders.filter(o => o.ordered_at.getTime() >= currentStart);
    const previous = orders.filter(o => o.ordered_at.getTime() < currentStart);
    const evidence = {
      verified: true, complete: true, currency: currencies[0],
      currentStart: windowIso(currentStart), currentEnd: windowIso(currentEnd),
      previousStart: windowIso(previousStart), previousEnd: windowIso(currentStart),
      currentCount: current.length, previousCount: previous.length,
      currentRevenue: current.reduce((sum, o) => sum + safeNumber(o.total), 0),
      previousRevenue: previous.reduce((sum, o) => sum + safeNumber(o.total), 0),
    };
    candidates.push(detectRevenueChange({ scope, evidence }));
    // Returning status is determined from actual prior purchases, not the
    // denormalized customers.orders_count or guessed RFM segment.
    const currentBuyers = [...new Set(current.map(o => o.customer_id))];
    const previousBuyers = [...new Set(previous.map(o => o.customer_id))];
    const allBuyers = [...new Set([...currentBuyers, ...previousBuyers])];
    const earliest = await prisma.orders.groupBy({
      by: ['customer_id'],
      where: { store_id: store.id, customer_id: { in: allBuyers }, ordered_at: { lt: new Date(currentEnd) } },
      _min: { ordered_at: true },
    });
    const firstPurchase = new Map(earliest.map(x => [x.customer_id, x._min.ordered_at?.getTime()]));
    const returning = (buyers, start) => buyers.filter(id => firstPurchase.get(id) < start).length;
    candidates.push(detectReturningCustomerChange({
      scope,
      evidence: { ...evidence, currentCount: currentBuyers.length, previousCount: previousBuyers.length,
        currentReturning: returning(currentBuyers, currentStart),
        previousReturning: returning(previousBuyers, previousStart) },
    }));
  }
  return { findings: prioritizeFindings(candidates), diagnostics,
    evaluated_at: now.toISOString(), period_days: periodDays };
}
module.exports = { evaluateOrganizationFindings };
