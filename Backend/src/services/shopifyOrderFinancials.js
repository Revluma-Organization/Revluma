'use strict';

// Shopify order money helpers.
//
// These are pure so the refund-reconciliation rules can be tested without a
// database connection. Nothing here may invent a net amount: malformed refund
// evidence returns null rather than falling back to the gross total.

/**
 * Shopify orders/update webhooks retain the original total_price after refunds.
 * Refund transactions are authoritative for cash refunded; ignore pending or
 * failed transactions and do not subtract the order's current_total_price twice.
 * Return null for malformed refund evidence rather than inventing net revenue.
 */
function shopifyNetOrderTotal(payload) {
  if (payload.total_price === null || payload.total_price === undefined || payload.total_price === '') {
    return null;
  }
  const gross = Number(payload.total_price);
  if (!Number.isFinite(gross) || gross < 0) return null;
  if (!Array.isArray(payload.refunds) || payload.refunds.length === 0) return gross;
  let refunded = 0;
  for (const refund of payload.refunds) {
    if (!Array.isArray(refund.transactions)) return null;
    for (const transaction of refund.transactions) {
      if (String(transaction.kind || '').toLowerCase() !== 'refund') continue;
      if (String(transaction.status || '').toLowerCase() !== 'success') continue;
      const amount = Number(transaction.amount);
      if (!Number.isFinite(amount) || amount < 0) return null;
      refunded += amount;
    }
  }
  return Math.max(0, Math.round((gross - refunded) * 100) / 100);
}

module.exports = {
  shopifyNetOrderTotal,
};
