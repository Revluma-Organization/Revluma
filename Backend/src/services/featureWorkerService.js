const { prisma } = require('../configs/database');
const logger = require('../utils/logger');
const {
  computeFeatures,
  predictAbandonment,
  predictSensitivity,
  predictOfferValue,
} = require('./mlService');
const { enqueueRecoveryAction } = require('./recoveryActionService');
const { createSensitivityObservation } = require('./trainingObservationService');

const MAX_ATTEMPTS = 5;
const FEATURE_FIELDS = [
  'scroll_depth_pct', 'tab_switch_count', 'time_on_checkout_step_sec',
  'cursor_hesitation', 'checkout_step_reached', 'cart_item_add_count',
  'cart_item_remove_count', 'past_orders_total', 'past_orders_with_coupon_pct',
  'days_since_last_purchase', 'avg_order_value', 'purchase_frequency_trend',
  'visited_coupon_page', 'searched_discount_terms', 'coupon_field_visited',
  'abandoned_at_shipping_reveal', 'failed_payment_attempt', 'failed_payment_count',
  'local_hour_of_session', 'day_of_week_session', 'time_on_page_ms',
  'google_shopping_referrer', 'time_first_view_to_cart_add_hrs',
  'sale_period_purchase_only', 'failed_coupon_attempt', 'merchant_avg_order_value',
  'account_creation_abandonment', 'repeat_checkout_attempts',
  'device_type_mobile', 'shipping_eta_dwell_sec', 'trust_page_visited',
  'failed_coupon_count', 'copied_product_title',
  'cart_value_vs_avg_order_value_ratio',
];

async function claimFeatureJob() {
  const rows = await prisma.$queryRaw`
    WITH candidate AS (
      SELECT id
      FROM feature_jobs
      WHERE attempt_count < ${MAX_ATTEMPTS}
        AND available_at <= NOW()
        AND (
          status = 'pending'
          OR (status = 'processing' AND updated_at < NOW() - INTERVAL '10 minutes')
        )
      ORDER BY available_at ASC, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE feature_jobs AS job
    SET status = 'processing',
        attempt_count = job.attempt_count + 1,
        updated_at = NOW(),
        last_error = NULL
    FROM candidate
    WHERE job.id = candidate.id
    RETURNING job.*
  `;
  return rows[0] || null;
}

function toPythonEvent(event, storeId) {
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
  return {
    id: event.source_event_id || event.id,
    event_type: event.event_type,
    session_id: event.session_id,
    customer_id: event.customer_id,
    anonymous_id: event.anonymous_id,
    store_id: storeId,
    merchant_id: storeId,
    timestamp: event.created_at?.toISOString(),
    platform: payload.platform,
    page: payload.page_url ? { url: payload.page_url, referrer: payload.referrer || null } : undefined,
    device: payload.device_type ? { type: payload.device_type, user_agent: payload.user_agent || '' } : undefined,
    payload,
  };
}

function featureRecord(envelope, storeId) {
  const features = envelope.features;
  const record = {
    store_id: storeId,
    customer_id: envelope.customer_id || null,
    session_id: envelope.session_id || null,
    anonymous_id: envelope.anonymous_id || null,
    updated_at: new Date(),
  };
  for (const field of FEATURE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(features, field)) record[field] = features[field];
  }
  return record;
}

async function persistFeatureSnapshot(envelope, storeId) {
  const existing = await prisma.ml_session_features.findFirst({
    where: {
      store_id: storeId,
      session_id: envelope.session_id || null,
      ...(envelope.session_id ? {} : { anonymous_id: envelope.anonymous_id || null }),
    },
    orderBy: { created_at: 'desc' },
    select: { id: true },
  });
  const data = featureRecord(envelope, storeId);
  if (existing) {
    return prisma.ml_session_features.update({ where: { id: existing.id }, data });
  }
  return prisma.ml_session_features.create({ data });
}

function abandonmentFeatures(features) {
  return {
    scroll_depth_pct: features.scroll_depth_pct,
    tab_switch_count: features.tab_switch_count,
    time_on_page_ms: features.time_on_page_ms,
    checkout_step_reached: features.checkout_step_reached,
    failed_payment_attempt: features.failed_payment_attempt,
    cart_item_add_count: features.cart_item_add_count,
    cart_item_remove_count: features.cart_item_remove_count,
    cursor_hesitation: features.cursor_hesitation,
  };
}

function offerFeatures(features, sensitivity, customer, cart) {
  return {
    pss_score: sensitivity.pss_score,
    css_score: sensitivity.css_score,
    tss_score: sensitivity.tss_score,
    recovery_action: sensitivity.recovery_action,
    past_orders_with_coupon_pct: features.past_orders_with_coupon_pct,
    visited_coupon_page: features.visited_coupon_page,
    searched_discount_terms: features.searched_discount_terms,
    failed_coupon_count: features.failed_coupon_count,
    ltv: Number(customer?.ltv || 0),
    past_orders_total: features.past_orders_total,
    cart_value: cart ? Number(cart.cart_value) : null,
    churn_tier: customer?.churn_tier || 'HEALTHY',
    is_first_purchase: Number(customer?.orders_count || 0) === 0,
    failed_payment_count: features.failed_payment_count,
  };
}

async function runPredictionChain({ envelope, store, snapshot, cartOverride = null }) {
  const features = envelope.features;
  const correlationId = `feature-${snapshot.id}`;
  const abandonment = await predictAbandonment({
    features: abandonmentFeatures(features),
    customerId: envelope.customer_id,
    merchantId: store.id,
    correlationId,
  });
  if (!abandonment.success || !abandonment.data?.should_intervene) {
    return { abandonment: abandonment.success ? abandonment.data : null };
  }

  const sensitivity = await predictSensitivity({
    features,
    customerId: envelope.customer_id,
    merchantId: store.id,
    correlationId,
  });
  if (!sensitivity.success) return { abandonment: abandonment.data, sensitivity: null };

  const [customer, cart] = await Promise.all([
    envelope.customer_id
      ? prisma.customers.findFirst({ where: { id: envelope.customer_id, store_id: store.id } })
      : null,
    cartOverride
      ? Promise.resolve(cartOverride)
      : envelope.session_id
      ? prisma.abandoned_carts.findFirst({
          where: { store_id: store.id, session_id: envelope.session_id, status: 'abandoned' },
          orderBy: { abandoned_at: 'desc' },
        })
      : null,
  ]);

  if (cart) {
    await prisma.abandoned_carts.update({
      where: { id: cart.id },
      data: {
        pss_score: sensitivity.data.pss_score,
        css_score: sensitivity.data.css_score,
        tss_score: sensitivity.data.tss_score,
        recovery_action: sensitivity.data.recovery_action,
        sensitivity_model_version: sensitivity.data.model_version,
        sensitivity_scored_at: new Date(),
      },
    });
  }

  if (customer) {
    await createSensitivityObservation({ store, customer, cart, features });
  }

  const offer = await predictOfferValue({
    features: offerFeatures(features, sensitivity.data, customer, cart),
    customerId: envelope.customer_id,
    merchantId: store.id,
    correlationId,
  });

  if (offer.success && cart && customer) {
    await enqueueRecoveryAction({
      store,
      customer,
      cart,
      snapshot,
      features,
      abandonment: abandonment.data,
      sensitivity: sensitivity.data,
      offer: offer.data,
      correlationId,
    });
  }
  return {
    abandonment: abandonment.data,
    sensitivity: sensitivity.data,
    offer: offer.success ? offer.data : null,
  };
}

async function processFeatureJob(job) {
  const sourceEvent = await prisma.events.findFirst({
    where: { id: job.event_id, store_id: job.store_id },
  });
  if (!sourceEvent?.session_id) throw new Error('feature_source_event_missing_session');

  const [store, sessionEvents] = await Promise.all([
    prisma.stores.findUnique({ where: { id: job.store_id } }),
    prisma.events.findMany({
      where: { store_id: job.store_id, session_id: sourceEvent.session_id },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      take: 1000,
    }),
  ]);
  if (!store) throw new Error('feature_store_not_found');

  const computed = await computeFeatures({
    customerId: sourceEvent.customer_id,
    sessionEvents: sessionEvents.map((event) => toPythonEvent(event, store.id)),
    correlationId: `feature-job-${job.id}`,
  });
  if (!computed.success) throw new Error(computed.error?.code || 'feature_compute_failed');

  const snapshot = await persistFeatureSnapshot(computed.data, store.id);
  const predictions = await runPredictionChain({ envelope: computed.data, store, snapshot });
  await prisma.feature_jobs.update({
    where: { id: job.id },
    data: { status: 'completed', last_error: null, updated_at: new Date() },
  });
  return { snapshotId: snapshot.id, predictions };
}

async function failFeatureJob(job, error) {
  const terminal = Number(job.attempt_count) >= MAX_ATTEMPTS;
  const delayMs = Math.min(15 * 60 * 1000, 30 * 1000 * (2 ** Math.max(0, Number(job.attempt_count) - 1)));
  await prisma.feature_jobs.update({
    where: { id: job.id },
    data: {
      status: terminal ? 'failed' : 'pending',
      available_at: terminal ? job.available_at : new Date(Date.now() + delayMs),
      last_error: String(error.code || error.name || 'feature_job_failed').slice(0, 500),
      updated_at: new Date(),
    },
  });
}

async function runFeatureJobs({ limit = 25 } = {}) {
  let processed = 0;
  let failed = 0;
  while (processed + failed < limit) {
    const job = await claimFeatureJob();
    if (!job) break;
    try {
      await processFeatureJob(job);
      processed += 1;
    } catch (error) {
      failed += 1;
      await failFeatureJob(job, error);
      logger.warn('feature_job_failed', {
        feature_job_id: job.id,
        error_type: error.code || error.name || 'processing_error',
      });
    }
  }
  return { processed, failed };
}

module.exports = {
  FEATURE_FIELDS,
  claimFeatureJob,
  persistFeatureSnapshot,
  processFeatureJob,
  runPredictionChain,
  runFeatureJobs,
  toPythonEvent,
};
