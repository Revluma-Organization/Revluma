const { prisma } = require('../configs/database');
const logger = require('../utils/logger');
const { predictChurnRisk } = require('./mlService');

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function rate(matches, total) {
  return total > 0 ? matches / total : 0;
}

function trend(current, previous) {
  if (previous === 0) return current > 0 ? 1 : 0;
  const change = (current - previous) / previous;
  return change > 0.1 ? 1 : change < -0.1 ? -1 : 0;
}

function rfmScore(value) {
  return Math.min(5, Math.max(1, Math.round(Number(value) || 1)));
}

async function buildChurnFeatures(customer) {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const since180 = new Date(now - 180 * day);
  const [orders, events, sends] = await Promise.all([
    prisma.orders.findMany({
      where: {
        customer_id: customer.id,
        ordered_at: { gte: since180 },
        OR: [{ recovery_status: null }, { recovery_status: { not: 'cancelled' } }],
      },
      select: { total: true, coupon_used: true, ordered_at: true },
      orderBy: { ordered_at: 'desc' },
    }),
    prisma.events.findMany({
      where: { customer_id: customer.id, created_at: { gte: new Date(now - 90 * day) } },
      select: { event_type: true, created_at: true },
    }),
    prisma.sequence_sends.findMany({
      where: { customer_id: customer.id, created_at: { gte: new Date(now - 90 * day) } },
      select: {
        channel: true,
        created_at: true,
        sequence_events: { select: { event_type: true, occurred_at: true } },
      },
    }),
  ]);
  const lastOrderAt = orders[0]?.ordered_at;
  const recentOrders = orders.filter((order) => order.ordered_at >= new Date(now - 90 * day));
  const priorOrders = orders.filter((order) => order.ordered_at < new Date(now - 90 * day));
  const orders30 = orders.filter((order) => order.ordered_at >= new Date(now - 30 * day));
  const orders31to90 = orders.filter((order) => order.ordered_at < new Date(now - 30 * day));
  const visits30 = events.filter((event) => event.event_type === 'PAGE_VIEW' && event.created_at >= new Date(now - 30 * day)).length;
  const visits90 = events.filter((event) => event.event_type === 'PAGE_VIEW').length;
  const carts30 = events.filter((event) => event.event_type === 'ADD_TO_CART' && event.created_at >= new Date(now - 30 * day)).length;
  const carts90 = events.filter((event) => event.event_type === 'ADD_TO_CART').length;
  const email30 = sends.filter((send) => send.channel === 'email' && send.created_at >= new Date(now - 30 * day));
  const email90 = sends.filter((send) => send.channel === 'email');
  const opened = (send) => send.sequence_events.some((event) => event.event_type === 'opened');
  const sms30 = sends.filter((send) => send.channel === 'sms' && send.created_at >= new Date(now - 30 * day));
  const clicked = (send) => send.sequence_events.some((event) => event.event_type === 'clicked');
  const coupon30 = rate(orders30.filter((order) => order.coupon_used).length, orders30.length);
  const couponPrior = rate(orders31to90.filter((order) => order.coupon_used).length, orders31to90.length);
  const currentAov = average(recentOrders.map((order) => Number(order.total)));
  const priorAov = average(priorOrders.map((order) => Number(order.total)));

  return {
    past_orders_total: Number(customer.orders_count || orders.length),
    days_since_last_purchase: lastOrderAt ? Math.max(0, Math.floor((now - lastOrderAt.getTime()) / day)) : -1,
    avg_order_value: Number(customer.ltv || 0) / Math.max(1, Number(customer.orders_count || 0)),
    purchase_frequency_trend: trend(orders30.length, orders31to90.length / 2),
    rfm_recency_score: rfmScore(customer.rfm_recency),
    rfm_frequency_score: rfmScore(customer.rfm_frequency),
    rfm_monetary_score: rfmScore(customer.rfm_monetary),
    historical_aov_trend: priorAov ? (currentAov - priorAov) / priorAov : 0,
    email_open_rate_30d: rate(email30.filter(opened).length, email30.length),
    email_open_rate_90d: rate(email90.filter(opened).length, email90.length),
    email_open_rate_delta: rate(email30.filter(opened).length, email30.length) - rate(email90.filter(opened).length, email90.length),
    sms_click_rate_30d: rate(sms30.filter(clicked).length, sms30.length),
    site_visit_frequency_30d: visits30,
    site_visit_frequency_90d: visits90,
    site_visit_delta: visits30 - visits90 / 3,
    browse_to_cart_conversion_trend: rate(carts30, visits30) - rate(carts90, visits90),
    coupon_dependency_score: rate(orders.filter((order) => order.coupon_used).length, orders.length),
    return_rate: 0,
    support_contact_frequency_90d: 0,
    discount_seeking_escalation: coupon30 - couponPrior,
    unsubscribe_risk_score: customer.consent_email === false ? 1 : 0,
    customer_ltv: Number(customer.ltv || 0),
  };
}

async function scoreCustomer(customer, store) {
  const scoreStartedAt = new Date();
  const features = await buildChurnFeatures(customer);
  const result = await predictChurnRisk({
    customerId: customer.id,
    merchantId: store.id,
    features,
    correlationId: `daily-churn-${customer.id}-${scoreStartedAt.getTime()}`,
  });
  if (!result.success) throw new Error(result.error?.code || 'churn_prediction_failed');
  const updated = await prisma.customers.updateMany({
    where: {
      id: customer.id,
      store_id: store.id,
      OR: [
        { churn_scored_at: null },
        { churn_scored_at: { lte: scoreStartedAt } },
      ],
    },
    data: { ...result.data, churn_scored_at: new Date() },
  });
  if (updated.count === 1) {
    await prisma.churn_training_observations.create({
      data: {
        organization_id: store.organization_id,
        store_id: store.id,
        customer_id: customer.id,
        prediction_at: scoreStartedAt,
        observation_due_at: new Date(scoreStartedAt.getTime() + 30 * 24 * 60 * 60 * 1000),
        feature_snapshot: features,
        label_policy_version: '30-day-v1',
      },
    });
  }
  return updated.count === 1;
}

async function runDailyChurnScoring({ limit = 100 } = {}) {
  const staleBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const customers = await prisma.customers.findMany({
    where: {
      status: 'active',
      OR: [{ churn_scored_at: null }, { churn_scored_at: { lte: staleBefore } }],
    },
    include: { stores: true },
    orderBy: [{ churn_scored_at: 'asc' }, { created_at: 'asc' }],
    take: Math.min(Math.max(limit, 1), 500),
  });
  let processed = 0;
  let failed = 0;
  for (const customer of customers) {
    try {
      if (await scoreCustomer(customer, customer.stores)) processed += 1;
    } catch (error) {
      failed += 1;
      logger.warn('daily_churn_customer_failed', {
        customer_id: customer.id,
        error_type: error.code || error.name || 'processing_error',
      });
    }
  }
  return { processed, failed };
}

module.exports = { buildChurnFeatures, runDailyChurnScoring, scoreCustomer };
