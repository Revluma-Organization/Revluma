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


/**
 * Sum the authoritative refund amount from a webhook order payload.
 * Returns null when the payload carries no refund evidence at all, so callers
 * can distinguish "no refunds" (0) from "unknown" (null).
 */
function shopifyRefundedAmount(payload) {
  // An explicitly declared refunded total wins. When the key is present but
  // null the evidence is unknown: do not fall through to an empty refunds
  // array and mistake "unknown" for "nothing was refunded".
  if (payload && Object.prototype.hasOwnProperty.call(payload, 'total_refunded')) {
    if (payload.total_refunded === null || payload.total_refunded === undefined || payload.total_refunded === '') return null;
    const declared = Number(payload.total_refunded);
    if (!Number.isFinite(declared) || declared < 0) return null;
    return Math.round(declared * 100) / 100;
  }
  if (!Array.isArray(payload?.refunds)) return null;
  let refunded = 0;
  for (const refund of payload.refunds) {
    if (!Array.isArray(refund?.transactions)) return null;
    for (const transaction of refund.transactions) {
      if (String(transaction.kind || '').toLowerCase() !== 'refund') continue;
      if (String(transaction.status || '').toLowerCase() !== 'success') continue;
      const amount = Number(transaction.amount);
      if (!Number.isFinite(amount) || amount < 0) return null;
      refunded += amount;
    }
  }
  return Math.round(refunded * 100) / 100;
}

function graphqlAmount(bag) {
  const amount = bag?.shopMoney?.amount;
  if (amount === null || amount === undefined || amount === '') return null;
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100) / 100;
}

/**
 * Shopify Admin GraphQL order money, per Shopify's own definitions:
 * - totalPriceSet: total before returns/refunds (the amount as ordered).
 * - currentTotalPriceSet: total after returns/refunds and order edits (net).
 * - totalRefundedSet: amount refunded so far.
 *
 * `orders.total` stores the NET value. currentTotalPriceSet is authoritative
 * when present; otherwise net is gross minus refunded. When neither route
 * yields a verifiable net (missing current total AND missing refund evidence)
 * the result is null so ingestion fails closed instead of recording the
 * pre-refund gross for a refunded order.
 */
function shopifyGraphqlOrderTotals(order) {
  const current = graphqlAmount(order?.currentTotalPriceSet);
  const gross = graphqlAmount(order?.totalPriceSet);
  const refunded = graphqlAmount(order?.totalRefundedSet);
  let net = null;
  if (current !== null) net = current;
  else if (gross !== null && refunded !== null) {
    net = Math.max(0, Math.round((gross - refunded) * 100) / 100);
  }
  const currency = order?.currentTotalPriceSet?.shopMoney?.currencyCode
    ?? order?.totalPriceSet?.shopMoney?.currencyCode
    ?? null;
  return { net, gross, refunded, currency };
}

module.exports = {
  shopifyNetOrderTotal,
  shopifyRefundedAmount,
  shopifyGraphqlOrderTotals,
};
