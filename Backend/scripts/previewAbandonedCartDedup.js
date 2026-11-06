'use strict';

// Read-only preview of the abandoned-cart deduplication plan.
// NEVER mutates. Produces:
//   1. Identity groups (canonical checkout identity collisions).
//   2. A per-group decision: keep the earliest row, mark duplicates for
//      supersession — nothing is deleted, no financial values recomputed.
//   3. SQL preview strings only. There is deliberately no --apply mode.
//
// Usage: node scripts/previewAbandonedCartDedup.js [--json]

const { planDedup } = require('./lib/dedupPlan');

function summarize(plan) {
  const lines = [];
  lines.push(`rows scanned: ${plan.rowsScanned}`);
  lines.push(`duplicate identity groups: ${plan.groups.length}`);
  lines.push(`rows planned to supersede (NOT executed): ${plan.totalSuperseded}`);
  for (const g of plan.groups) {
    lines.push(`group store=${g.storeId} identity=${g.identity} rows=${g.rows.length} keep=${g.keep.id} supersede=[${g.supersede.map(r => r.id).join(',')}]`);
  }
  return lines.join('\n');
}

async function main() {
  const json = process.argv.includes('--json');
  const { prisma } = require('../src/configs/database');
  try {
    const rows = await prisma.abandoned_carts.findMany({
      select: {
        id: true,
        store_id: true,
        external_cart_id: true,
        source_checkout_id: true,
        source_checkout_token: true,
        source_cart_token: true,
        cart_value: true,
        currency: true,
        created_at: true,
        abandoned_at: true,
        recovery_status: true,
      },
    });
    const plan = planDedup(rows.map(r => ({
      id: r.id,
      storeId: r.store_id,
      externalCartId: r.external_cart_id,
      sourceCheckoutId: r.source_checkout_id,
      sourceCheckoutToken: r.source_checkout_token,
      sourceCartToken: r.source_cart_token,
      cartValue: Number(r.cart_value || 0),
      currency: r.currency,
      createdAt: r.created_at,
      status: r.recovery_status,
    })));
    if (json) {
      process.stdout.write(JSON.stringify(plan, null, 2) + '\n');
    } else {
      process.stdout.write(summarize(plan) + '\n');
      process.stdout.write('\nSQL preview (not executed):\n');
      for (const g of plan.groups) {
        const ids = g.supersede.map(r => `'${r.id}'`).join(',');
        process.stdout.write(`UPDATE abandoned_carts SET status = 'superseded' WHERE id IN (${ids}); -- group ${g.identity}\n`);
      }
    }
  } finally {
    try { await prisma.$disconnect(); } catch { /* noop */ }
  }
}

if (require.main === module) {
  main().catch(err => {
    process.stderr.write(`previewAbandonedCartDedup failed: ${err.message}\n`);
    process.exit(1);
  });
}

module.exports = { summarize };
