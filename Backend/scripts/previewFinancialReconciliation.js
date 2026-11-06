'use strict';

// Read-only financial reconciliation preview for stored orders.
// NEVER mutates. Reports:
//   - orders stored as cancelled/voided/deleted whose total is inconsistent
//     (the "stale cancelled order" class, e.g. external_order_id 18973892706493)
//   - orders with NULL refunded_total (history unknown — reported as unknown,
//     never rewritten to 0)
//   - orders where refunded_total > total (impossible under net reconciliation)
// and prints the SQL preview only. There is deliberately no --apply mode;
// the bulk correction is an approval-gated operation.
//
// Usage: node scripts/previewFinancialReconciliation.js [--json]

async function main() {
  const json = process.argv.includes('--json');
  const { prisma } = require('../src/configs/database');
  try {
    const total = await prisma.orders.count();
    const staleCancelled = await prisma.orders.findMany({
      where: { recovery_status: { in: ['cancelled', 'canceled', 'voided', 'deleted'] }, total: { gt: 0 } },
      select: { store_id: true, external_order_id: true, recovery_status: true, total: true, refunded_total: true, currency: true, ordered_at: true },
      orderBy: { ordered_at: 'asc' },
    });
    const nullRefund = await prisma.orders.count({ where: { refunded_total: null, recovery_status: { notIn: ['cancelled', 'canceled', 'voided', 'deleted'] } } });
    const impossibleRefund = await prisma.orders.findMany({
      where: { refunded_total: { not: null } },
      select: { store_id: true, external_order_id: true, total: true, refunded_total: true },
    });
    const overRefunded = impossibleRefund.filter(r => Number(r.refunded_total) > Number(r.total));

    const staleSum = staleCancelled.reduce((sum, o) => sum + Number(o.total || 0), 0);
    const report = {
      orders_total: total,
      stale_cancelled_rows: staleCancelled.length,
      stale_cancelled_gross: staleSum,
      refunded_total_null_completed_orders: nullRefund,
      over_refunded_rows: overRefunded.length,
      stale_cancelled: staleCancelled.map(o => ({
        store_id: o.store_id,
        external_order_id: o.external_order_id,
        status: o.recovery_status,
        stored_total: Number(o.total),
        refunded_total: o.refunded_total == null ? null : Number(o.refunded_total),
        currency: o.currency,
        ordered_at: o.ordered_at,
      })),
      over_refunded: overRefunded.map(o => ({ store_id: o.store_id, external_order_id: o.external_order_id, total: Number(o.total), refunded_total: Number(o.refunded_total) })),
      proposed_sql_preview_only: (
        "-- Example remediation, NOT applied; Shopify Admin API values are authoritative.\n" +
        "-- 1. Re-derive net totals from Shopify (orders API) and write via reconcileOrderMoney, or\n" +
        "-- 2. Mark stale tombstoned rows' refunded_total := greatest(stored refunded_total, stored total) for fully-cancelled orders.\n" +
        "UPDATE orders SET refunded_total = total WHERE recovery_status IN ('cancelled','canceled','voided','deleted') AND total > 0 AND (refunded_total IS NULL OR refunded_total < total);"
      ),
      rollback: 'no writes performed; remediation must be applied via an authorized, tenant-scoped remediation that re-reads Shopify as source of truth',
    };

    if (json) {
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    } else {
      process.stdout.write(
        `orders total: ${report.orders_total}\n` +
        `stale cancelled rows (stored total > 0): ${report.stale_cancelled_rows} (gross ${report.stale_cancelled_gross.toFixed(2)})\n` +
        `completed-status orders with NULL refunded_total (history unknown): ${report.refunded_total_null_completed_orders}\n` +
        `over-refunded rows: ${report.over_refunded_rows}\n\n`
      );
      for (const o of report.stale_cancelled) {
        process.stdout.write(`  order ${o.external_order_id} status=${o.status} total=${o.stored_total} refunded=${o.refunded_total ?? 'NULL'} ${o.currency} ${o.ordered_at}\n`);
      }
      process.stdout.write('\n' + report.proposed_sql_preview_only + '\n');
    }
  } finally {
    try { await prisma.$disconnect(); } catch { /* noop */ }
  }
}

if (require.main === module) {
  main().catch(err => {
    process.stderr.write(`previewFinancialReconciliation failed: ${err.message}\n`);
    process.exit(1);
  });
}
