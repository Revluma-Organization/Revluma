'use strict';
const {
  detectIntegrationFailure,
  detectRevenueChange,
  detectOrderVolumeChange,
  detectReturningCustomerChange,
  detectRefundIncrease,
  detectNoRecentOrders,
  detectStorefrontDomainUnconfigured,
  detectOpenAbandonedCheckouts,
  detectInventoryStockouts,
  detectNoStorefrontEvents,
  prioritizeFindings,
} = require('./intelligenceFindingsEngine');

const { TRUSTED_SOURCE } = require('./intelligenceOrderCoverage');
const DAY = 86400000;
const windowIso = ms => new Date(ms).toISOString();
const sameCurrency = rows => [...new Set(rows.map(row => row.currency))];
const safeNumber = value => Number(value);
const verifiedSync = store => ['active', 'connected'].includes(store.status) && Boolean(store.last_synced_at);

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
      store: { ...store, status: store.status === 'active' ? 'connected' : store.status,
        setup_status: registrationFailures > 0 ? 'failed' : null },
      now, maxSyncAgeMinutes: Number.POSITIVE_INFINITY,
    });
    if (integration) {
      integration.evidence.failed_webhook_registrations = registrationFailures;
      candidates.push(integration);
    }
    if (!verifiedSync(store) || registrationFailures > 0) {
      diagnostics.push({ storeId: store.id, status: 'insufficient_sync_verification' });
      continue;
    }

    // Storefront readiness & operational signals — evaluated only from verified,
    // synchronized store records when those tables are available.
    const observedAtIso = now.toISOString();
    let storeProfile = null;
    if (prisma.store_profiles && typeof prisma.store_profiles.findFirst === 'function') {
      storeProfile = await prisma.store_profiles.findFirst({
        where: { store_id: store.id },
        select: { primary_domain_host: true, myshopify_domain: true, currency_code: true, synced_at: true },
      });
    }
    let activeProductsCount = null;
    if (prisma.products && typeof prisma.products.count === 'function') {
      activeProductsCount = await prisma.products.count({
        where: { store_id: store.id, status: 'active' },
      });
    }

    // 1. Storefront primary domain check (.myshopify.com with zero custom domains)
    if (storeProfile && typeof storeProfile.primary_domain_host === 'string') {
      const domains = prisma.store_domains && typeof prisma.store_domains.findMany === 'function'
        ? await prisma.store_domains.findMany({
            where: { store_id: store.id },
            select: { host: true, kind: true, synced_at: true },
          })
        : [];
      const customDomainCount = domains.filter(
        d => d && String(d.kind || '').toLowerCase() !== 'myshopify' && !/\.myshopify\.com$/i.test(String(d.host || '').trim())
      ).length;
      const totalDomainsCount = Math.max(domains.length, 1);
      if (/\.myshopify\.com$/i.test(storeProfile.primary_domain_host.trim()) && customDomainCount === 0) {
        candidates.push(detectStorefrontDomainUnconfigured({
          scope,
          evidence: {
            verified: true,
            complete: true,
            source: 'store_profiles',
            storeId: store.id,
            primaryDomainHost: storeProfile.primary_domain_host.trim(),
            customDomainCount: 0,
            totalDomainsCount,
            observed_at: observedAtIso,
          },
        }));
      }
    }

    // 2. Open abandoned checkouts (last 30 days, verified checkout records)
    if (prisma.abandoned_carts && typeof prisma.abandoned_carts.findMany === 'function') {
      const checkoutWindowDays = 30;
      const checkoutSince = new Date(now.getTime() - checkoutWindowDays * DAY);
      const recentCarts = await prisma.abandoned_carts.findMany({
        where: { store_id: store.id, abandoned_at: { gte: checkoutSince } },
        select: { status: true, cart_value: true, currency: true, abandoned_at: true },
      });
      const openCarts = recentCarts.filter(c => String(c.status || '').toLowerCase() === 'abandoned');
      const completedCarts = recentCarts.filter(c => String(c.status || '').toLowerCase() === 'recovered');
      const openCurrencies = sameCurrency(openCarts.filter(c => c.currency));
      const cartCurrency = openCurrencies.length === 1
        ? openCurrencies[0]
        : (openCurrencies.length === 0 && storeProfile?.currency_code ? storeProfile.currency_code : null);
      if (openCarts.length > 0 && cartCurrency) {
        const openValue = openCarts.reduce((sum, c) => sum + (Number.isFinite(safeNumber(c.cart_value)) ? Math.max(0, safeNumber(c.cart_value)) : 0), 0);
        candidates.push(detectOpenAbandonedCheckouts({
          scope,
          evidence: {
            verified: true,
            complete: true,
            source: 'abandoned_carts',
            storeId: store.id,
            openAbandonedCount: openCarts.length,
            openAbandonedValue: Number(openValue.toFixed(2)),
            completedAfterCheckoutCount: completedCarts.length,
            currency: cartCurrency,
            windowDays: checkoutWindowDays,
            observed_at: observedAtIso,
          },
        }));
      }
    }

    // 3. Zero-stock inventory levels (current synchronized snapshot)
    if (prisma.inventory_levels && typeof prisma.inventory_levels.findMany === 'function') {
      const levels = await prisma.inventory_levels.findMany({
        where: { store_id: store.id },
        select: { quantities: true, synced_at: true },
      });
      if (levels.length > 0) {
        let zeroStockCount = 0;
        let inStockCount = 0;
        for (const row of levels) {
          const q = row?.quantities && typeof row.quantities === 'object' ? row.quantities : {};
          const avail = Number(q.available);
          if (Number.isFinite(avail) && avail <= 0) zeroStockCount += 1;
          else if (Number.isFinite(avail) && avail > 0) inStockCount += 1;
        }
        if (zeroStockCount > 0) {
          candidates.push(detectInventoryStockouts({
            scope,
            evidence: {
              verified: true,
              complete: true,
              source: 'inventory_levels',
              storeId: store.id,
              zeroStockCount,
              totalLevelsCount: levels.length,
              inStockCount,
              inventory_history_available: false,
              observed_at: observedAtIso,
            },
          }));
        }
      }
    }

    // 4. Zero storefront traffic / visitor events (last 30 days)
    if (prisma.events && typeof prisma.events.count === 'function' && activeProductsCount !== null) {
      const eventsWindowDays = 30;
      const eventsSince = new Date(now.getTime() - eventsWindowDays * DAY);
      const recordedEventsCount = await prisma.events.count({
        where: { store_id: store.id, created_at: { gte: eventsSince } },
      });
      if (recordedEventsCount === 0) {
        candidates.push(detectNoStorefrontEvents({
          scope,
          evidence: {
            verified: true,
            complete: true,
            source: 'events',
            storeId: store.id,
            recordedEventsCount: 0,
            activeProductsCount,
            windowDays: eventsWindowDays,
            observed_at: observedAtIso,
          },
        }));
      }
    }

    // Shopify API coverage may be partial even after sync success. Never
    // infer historical completeness from order counts or connection status.
    const coverage = await prisma.intelligence_order_coverage.findFirst({
      where: { store_id: store.id, organization_id: organizationId,
        coverage_start: { lte: new Date(previousStart) },
        coverage_end: { gte: new Date(currentEnd) } },
      select: { source: true, source_run_id: true, certified_at: true, customer_lifetime_verified: true },
    });
    if (!coverage || coverage.source !== TRUSTED_SOURCE || !coverage.source_run_id) {
      diagnostics.push({ storeId: store.id, status: 'order_history_completeness_unverified' });
      continue;
    }
    // Checkout rows do not establish the total number of checkout starts,
    // unique visitors, or a complete abandonment denominator. Surface this
    // explicitly so the advisor cannot infer a conversion rate from them.
    diagnostics.push({
      storeId: store.id,
      status: 'checkout_funnel_coverage_unverified',
      available_source: 'abandoned_carts',
      missing_evidence: ['complete_checkout_starts', 'consistent_checkout_completions', 'checkout_event_coverage'],
    });
    // Refund movement is attributed to successful refund transaction dates,
    // not an order's lifetime refunded_total. It requires its own complete
    // refund synchronization in addition to certified order history.
    if (prisma.order_transactions && prisma.store_sync_domain_states) {
      const refundSync = await prisma.store_sync_domain_states.findFirst({
        where: { store_id: store.id, domain: 'refunds', status: 'ok', pagination_complete: true,
          last_succeeded_at: { gte: new Date(currentEnd) } },
        select: { id: true, last_succeeded_at: true },
      });
      if (refundSync) {
        const transactions = await prisma.order_transactions.findMany({
          where: { store_id: store.id, kind: 'refund', status: { in: ['success', 'succeeded'] },
            processed_at: { gte: new Date(previousStart), lt: new Date(currentEnd) } },
          select: { external_id: true, external_order_id: true, amount: true, currency: true, processed_at: true },
        });
        const refundCurrencies = sameCurrency(transactions);
        if (transactions.length && refundCurrencies.length === 1) {
          const currentRefunds = transactions.filter(row => row.processed_at.getTime() >= currentStart);
          const previousRefunds = transactions.filter(row => row.processed_at.getTime() < currentStart);
          const refundValue = rows => rows.reduce((sum, row) => sum + Math.abs(safeNumber(row.amount)), 0);
          candidates.push(detectRefundIncrease({ scope, evidence: {
            verified: true, complete: true, source: 'order_transactions', refund_coverage_complete: true,
            refund_sync_run_id: refundSync.id, coverage_source: coverage.source, coverage_run_id: coverage.source_run_id,
            currency: refundCurrencies[0], currentStart: windowIso(currentStart), currentEnd: windowIso(currentEnd),
            previousStart: windowIso(previousStart), previousEnd: windowIso(currentStart),
            currentCount: currentRefunds.length, previousCount: previousRefunds.length,
            currentRefundTotal: refundValue(currentRefunds), previousRefundTotal: refundValue(previousRefunds),
          } }));
        } else if (transactions.length) diagnostics.push({ storeId: store.id, status: 'refund_currency_not_comparable' });
      } else diagnostics.push({ storeId: store.id, status: 'refund_history_completeness_unverified' });
    }
    const orders = await prisma.orders.findMany({
      where: { store_id: store.id, ordered_at: { gte: new Date(previousStart), lt: new Date(currentEnd) } },
      select: { customer_id: true, total: true, currency: true, ordered_at: true, recovery_status: true, refunded_total: true },
    });
    // Exclude cancelled/voided/deleted orders and deduct refunds before
    // comparing periods — identical financial semantics to the verified
    // python metric layer. A refund is not revenue; a cancelled order is
    // not a sale.
    const EXCLUDED_RECOVERY_STATUSES = new Set(['cancelled', 'canceled', 'voided', 'deleted']);
    const netValue = (o) => safeNumber(o.total) - safeNumber(o.refunded_total || 0);
    const liveOrders = orders.filter(o => !EXCLUDED_RECOVERY_STATUSES.has(String(o.recovery_status || '').toLowerCase()));
    const current = liveOrders.filter(o => o.ordered_at.getTime() >= currentStart);
    const previous = liveOrders.filter(o => o.ordered_at.getTime() < currentStart);

    // 5. Certified zero-order window detection (when active catalog exists)
    if (current.length === 0 && activeProductsCount !== null) {
      let lastOrderAt = null;
      if (typeof prisma.orders.findFirst === 'function') {
        const latest = await prisma.orders.findFirst({
          where: { store_id: store.id, NOT: { recovery_status: { in: ['cancelled', 'canceled', 'voided', 'deleted'] } } },
          orderBy: { ordered_at: 'desc' },
          select: { ordered_at: true },
        }).catch(() => null);
        if (latest?.ordered_at) lastOrderAt = new Date(latest.ordered_at).toISOString();
      }
      const orderCurrency = (liveOrders[0]?.currency || storeProfile?.currency_code || 'USD').toUpperCase();
      candidates.push(detectNoRecentOrders({
        scope,
        evidence: {
          verified: true,
          complete: true,
          currency: orderCurrency,
          coverage_source: coverage.source,
          coverage_run_id: coverage.source_run_id,
          currentStart: windowIso(currentStart),
          currentEnd: windowIso(currentEnd),
          previousStart: windowIso(previousStart),
          previousEnd: windowIso(currentStart),
          currentCount: 0,
          previousCount: previous.length,
          activeProductsCount,
          lastOrderAt,
          periodDays,
          observed_at: observedAtIso,
        },
      }));
    }

    const currencies = sameCurrency(liveOrders);
    if (currencies.length !== 1 || !liveOrders.length) {
      diagnostics.push({ storeId: store.id, status: 'mixed_currency_or_no_orders' });
      continue;
    }
    const evidence = {
      verified: true, complete: true, currency: currencies[0],
      coverage_source: coverage.source, coverage_run_id: coverage.source_run_id,
      currentStart: windowIso(currentStart), currentEnd: windowIso(currentEnd),
      previousStart: windowIso(previousStart), previousEnd: windowIso(currentStart),
      currentCount: current.length, previousCount: previous.length,
      currentRevenue: current.reduce((sum, o) => sum + netValue(o), 0),
      previousRevenue: previous.reduce((sum, o) => sum + netValue(o), 0),
    };
    candidates.push(detectRevenueChange({ scope, evidence }));
    candidates.push(detectOrderVolumeChange({ scope, evidence }));
    if (!coverage.customer_lifetime_verified) {
      diagnostics.push({ storeId: store.id, status: 'customer_lifetime_history_unverified' });
      continue;
    }
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
