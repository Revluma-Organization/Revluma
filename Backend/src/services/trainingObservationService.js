const { prisma } = require('../configs/database');
const logger = require('../utils/logger');

const DAY_MS = 24 * 60 * 60 * 1000;
const SENSITIVITY_FEATURES = [
  'past_orders_with_coupon_pct', 'visited_coupon_page', 'searched_discount_terms',
  'cart_item_remove_count', 'coupon_field_visited', 'abandoned_at_shipping_reveal',
  'checkout_step_reached', 'cursor_hesitation', 'time_on_page_ms',
  'failed_payment_attempt', 'failed_payment_count', 'is_return_visitor',
  'avg_order_value',
];

function sensitivitySnapshot(features) {
  const source = {
    ...features,
    is_return_visitor: Number(features.past_orders_total || 0) > 0,
  };
  return Object.fromEntries(SENSITIVITY_FEATURES.map((name) => [name, Number(source[name] || 0)]));
}

async function createSensitivityObservation({ store, customer, cart, features, decisionAt = new Date() }) {
  if (!store?.organization_id || !customer?.id) return null;
  if (cart?.id) {
    const existing = await prisma.sensitivity_training_observations.findFirst({
      where: { abandoned_cart_id: cart.id, finalized_at: null },
      select: { id: true },
    });
    if (existing) return existing;
  }
  return prisma.sensitivity_training_observations.create({
    data: {
      organization_id: store.organization_id,
      store_id: store.id,
      customer_id: customer.id,
      abandoned_cart_id: cart?.id || null,
      decision_at: decisionAt,
      observation_due_at: new Date(decisionAt.getTime() + 7 * DAY_MS),
      label_policy_version: 'observed-outcome-7d-v1',
      feature_snapshot: sensitivitySnapshot(features),
    },
  });
}

function churnTier(daysSincePurchase) {
  if (daysSincePurchase <= 30) return 'HEALTHY';
  if (daysSincePurchase <= 60) return 'AT_RISK';
  if (daysSincePurchase <= 90) return 'HIGH_RISK';
  return 'CRITICAL';
}

async function finalizeChurnObservation(observation) {
  const [lastOrder, nextOrder] = await Promise.all([
    prisma.orders.findFirst({
      where: {
        customer_id: observation.customer_id,
        ordered_at: { lte: observation.observation_due_at },
        OR: [{ recovery_status: null }, { recovery_status: { not: 'cancelled' } }],
      },
      orderBy: { ordered_at: 'desc' },
      select: { ordered_at: true },
    }),
    prisma.orders.findFirst({
      where: {
        customer_id: observation.customer_id,
        ordered_at: { gt: observation.prediction_at, lte: observation.observation_due_at },
        OR: [{ recovery_status: null }, { recovery_status: { not: 'cancelled' } }],
      },
      orderBy: { ordered_at: 'asc' },
      select: { ordered_at: true },
    }),
  ]);
  const snapshotDays = Math.max(0, Number(observation.feature_snapshot?.days_since_last_purchase || 0));
  const observedDays = lastOrder
    ? Math.max(0, Math.floor((observation.observation_due_at - lastOrder.ordered_at) / DAY_MS))
    : snapshotDays + Math.floor((observation.observation_due_at - observation.prediction_at) / DAY_MS);
  await prisma.churn_training_observations.update({
    where: { id: observation.id },
    data: {
      finalized_at: new Date(),
      next_completed_order_at: nextOrder?.ordered_at || null,
      observed_churn_tier: churnTier(observedDays),
    },
  });
}

async function finalizeSensitivityObservation(observation) {
  const cartFilters = observation.abandoned_cart_id
    ? [
        { abandoned_cart_id: observation.abandoned_cart_id },
        ...(observation.abandoned_carts?.session_id
          ? [{ session_id: observation.abandoned_carts.session_id }]
          : []),
      ]
    : null;
  const order = await prisma.orders.findFirst({
    where: {
      customer_id: observation.customer_id,
      ordered_at: { gt: observation.decision_at, lte: observation.observation_due_at },
      ...(cartFilters ? { OR: cartFilters } : {}),
    },
    orderBy: { ordered_at: 'asc' },
    select: { coupon_used: true, discount_pct: true },
  });
  const snapshot = observation.feature_snapshot || {};
  const recovered = Boolean(order);
  const priceEvidence = Boolean(order?.coupon_used) || Number(order?.discount_pct || 0) > 0;
  const frictionEvidence = Boolean(
    snapshot.abandoned_at_shipping_reveal || snapshot.failed_payment_attempt ||
    Number(snapshot.failed_payment_count || 0) > 0 || Number(snapshot.checkout_step_reached || 0) < 5
  );
  const trustEvidence = Boolean(
    Number(snapshot.is_return_visitor || 0) === 0
  );
  await prisma.sensitivity_training_observations.update({
    where: { id: observation.id },
    data: {
      finalized_at: new Date(),
      pss_label: priceEvidence,
      css_label: recovered && frictionEvidence,
      tss_label: recovered && trustEvidence,
    },
  });
}

async function runTrainingObservationFinalization({ limit = 100 } = {}) {
  const take = Math.min(Math.max(Number(limit) || 1, 1), 500);
  const [churn, sensitivity] = await Promise.all([
    prisma.churn_training_observations.findMany({
      where: { finalized_at: null, observation_due_at: { lte: new Date() } },
      orderBy: { observation_due_at: 'asc' }, take,
    }),
    prisma.sensitivity_training_observations.findMany({
      where: { finalized_at: null, observation_due_at: { lte: new Date() } },
      include: { abandoned_carts: { select: { session_id: true } } },
      orderBy: { observation_due_at: 'asc' }, take,
    }),
  ]);
  let completed = 0;
  let failed = 0;
  for (const observation of churn) {
    try { await finalizeChurnObservation(observation); completed += 1; }
    catch (error) {
      failed += 1;
      logger.warn('churn_observation_finalization_failed', {
        observation_id: observation.id, error_type: error.code || error.name || 'processing_error',
      });
    }
  }
  for (const observation of sensitivity) {
    try { await finalizeSensitivityObservation(observation); completed += 1; }
    catch (error) {
      failed += 1;
      logger.warn('sensitivity_observation_finalization_failed', {
        observation_id: observation.id, error_type: error.code || error.name || 'processing_error',
      });
    }
  }
  return { completed, failed, remaining: Math.max(0, churn.length + sensitivity.length - completed) };
}

module.exports = {
  SENSITIVITY_FEATURES,
  churnTier,
  createSensitivityObservation,
  runTrainingObservationFinalization,
  sensitivitySnapshot,
};
