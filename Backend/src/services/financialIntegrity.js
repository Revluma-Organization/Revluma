'use strict';

/**
 * Financial validation shared by Shopify ingestion, webhook reconciliation and
 * customer lifetime value.
 *
 * Invariants:
 *  - a missing or malformed currency is an error, never a silent USD;
 *  - a missing or malformed amount is an error, never a silent zero;
 *  - lifetime value is never summed across currencies.
 */

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

function financialError(code, message, extra = {}) {
  const error = new Error(message || code);
  error.code = code;
  return Object.assign(error, extra);
}

function normalizeCurrency(value) {
  if (typeof value !== 'string') return null;
  const candidate = value.trim().toUpperCase();
  return CURRENCY_PATTERN.test(candidate) ? candidate : null;
}

function requireCurrency(value, { code = 'CURRENCY_UNVERIFIED', context = 'financial record' } = {}) {
  const currency = normalizeCurrency(value);
  if (!currency) {
    throw financialError(code, `${context} has no verified ISO currency code`);
  }
  return currency;
}

function parseAmount(value, { allowNegative = false } = {}) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    if (!allowNegative && value < 0) return null;
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return null;
    if (!allowNegative && parsed < 0) return null;
    return Math.round(parsed * 100) / 100;
  }
  return null;
}

function requireAmount(value, { code = 'AMOUNT_UNVERIFIED', context = 'financial record' } = {}) {
  const amount = parseAmount(value);
  if (amount === null) {
    throw financialError(code, `${context} has no verified monetary amount`);
  }
  return amount;
}

/**
 * Aggregate monetary rows per currency. Rows without a valid currency are
 * excluded and reported, never coerced into a default currency.
 */
function totalsByCurrency(rows, { valueKey = 'total', currencyKey = 'currency' } = {}) {
  const totals = new Map();
  const rejected = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const currency = normalizeCurrency(row?.[currencyKey]);
    const amount = parseAmount(row?.[valueKey], { allowNegative: true });
    if (!currency || amount === null) {
      rejected.push(row);
      continue;
    }
    const current = totals.get(currency) || { currency, value: 0, count: 0 };
    current.value = Math.round((current.value + amount) * 100) / 100;
    current.count += 1;
    totals.set(currency, current);
  }
  return {
    currencies: [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    rejected: rejected.length,
  };
}

/**
 * Customer LTV is only usable when its currency is verified.
 *
 * `customers.ltv` is a stored merchant value. When a customer's orders span
 * currencies, the stored value is marked mixed and must never be turned into
 * one number, and an unlabelled legacy value must never be assumed to be USD.
 * Callers receive `value: null` for both cases so nothing downstream can
 * silently present a mixed or currency-less figure.
 */
function verifiedCustomerLifetimeValue(customer) {
  const mixed = customer?.ltv_mixed_currency === true;
  const rawCurrency = typeof customer?.ltv_currency === 'string'
    ? customer.ltv_currency.trim().toUpperCase()
    : '';
  const currency = /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : null;
  const rawAmount = customer?.ltv;
  const amount = rawAmount === null || rawAmount === undefined || rawAmount === ''
    ? null
    : Number(rawAmount);
  if (mixed || !currency || amount === null || !Number.isFinite(amount) || amount < 0) {
    return { value: null, currency: null, mixed, verified: false };
  }
  return { value: amount, currency, mixed: false, verified: true };
}


/**
 * Reconcile an incoming order money observation against what is already stored.
 *
 * Shopify delivery is not ordered: an `orders/create` snapshot taken before a
 * refund can arrive after the refund was recorded. Overwriting the stored row
 * with that older snapshot would resurrect refunded revenue, so the recorded
 * refunded amount is treated as monotonic and any refund the incoming payload
 * has not seen yet is still deducted from the incoming net total.
 *
 * Refund reversals are not modelled by Shopify's order total, so keeping the
 * maximum refunded amount is the conservative choice: it can understate net
 * revenue (never overstate it) and is reported as refunded evidence.
 */
function reconcileOrderMoney({ incomingNet, incomingRefunded, storedRefunded } = {}) {
  const net = parseAmount(incomingNet);
  const incoming = parseAmount(incomingRefunded, { allowNegative: true });
  const stored = storedRefunded === null || storedRefunded === undefined || storedRefunded === ''
    ? null
    : parseAmount(storedRefunded, { allowNegative: true });

  if (net === null) return { total: null, refunded_total: incoming };
  if (incoming !== null && incoming < 0) return { total: null, refunded_total: null };

  const effectiveRefunded = incoming === null
    ? stored
    : (stored === null ? incoming : Math.max(stored, incoming));

  if (effectiveRefunded === null) {
    // No refund evidence anywhere: the incoming net total stands on its own.
    return { total: net, refunded_total: null };
  }

  const unseenRefund = Math.max(0, Math.round((effectiveRefunded - (incoming ?? 0)) * 100) / 100);
  return {
    total: Math.max(0, Math.round((net - unseenRefund) * 100) / 100),
    refunded_total: effectiveRefunded,
  };
}

/**
 * Compute a customer's lifetime value without mixing currencies.
 * Mixed-currency customers must surface as mixed rather than as one total.
 */
function computeCustomerLifetimeValue(orders) {
  const { currencies, rejected } = totalsByCurrency(
    (Array.isArray(orders) ? orders : []).filter((order) => {
      const status = String(order?.recovery_status || '').toLowerCase();
      return !['cancelled', 'canceled', 'voided', 'deleted'].includes(status);
    }),
    { valueKey: 'total' },
  );
  const ordersCount = currencies.reduce((sum, entry) => sum + entry.count, 0);
  if (!currencies.length) {
    return {
      ltv: 0,
      ltv_currency: null,
      mixed_currency: false,
      orders_count: 0,
      rejected: rejected,
    };
  }
  if (currencies.length === 1) {
    return {
      ltv: currencies[0].value,
      ltv_currency: currencies[0].currency,
      mixed_currency: false,
      orders_count: ordersCount,
      rejected: rejected,
    };
  }
  return {
    ltv: null,
    ltv_currency: null,
    mixed_currency: true,
    orders_count: ordersCount,
    rejected: rejected,
    currencies: currencies.map((entry) => entry.currency),
  };
}

/**
 * A cancelled order is terminal for revenue even if a delayed order-update
 * arrives later. A cancellation observed before the order row is persisted is
 * recorded as a tombstone and must prevent resurrection.
 */
function resolveOrderRecoveryStatus({ existing, tombstone, incomingCancelled = false } = {}) {
  if (tombstone || existing?.recovery_status === 'cancelled' || incomingCancelled) {
    return 'cancelled';
  }
  return existing?.recovery_status || 'completed';
}

module.exports = {
  CURRENCY_PATTERN,
  computeCustomerLifetimeValue,
  financialError,
  normalizeCurrency,
  parseAmount,
  reconcileOrderMoney,
  requireAmount,
  requireCurrency,
  resolveOrderRecoveryStatus,
  totalsByCurrency,
  verifiedCustomerLifetimeValue,
};
