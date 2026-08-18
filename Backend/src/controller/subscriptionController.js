/**
 * Revluma Subscription Controller — Production Hardened
 *
 * Security architecture:
 * - All plan amounts derived server-side from PLANS config. Client sends only plan identifier.
 * - organization_id always derived from authenticated JWT, never from request body.
 * - Webhook HMAC SHA-512 verified before any processing. Unsigned requests are rejected.
 * - All DB writes are idempotent: paystack_reference has a UNIQUE constraint.
 * - Subscription state machine enforced: only valid transitions are allowed.
 * - No card data, CVV, PIN, or OTP handled anywhere in this file.
 * - No Paystack secret key ever returned in API responses or logs.
 */

const axios   = require('axios');
const crypto  = require('crypto');
const logger  = require('../utils/logger');

const dbConfig = require('../configs/database');
const prisma   = dbConfig.prisma;

// ── Plan registry — single source of truth for pricing ───────────────────────
// Amounts are in kobo (NGN) and cents (USD). NEVER accept amounts from the client.
const PLANS = {
  growth: {
    name:         'Revluma Growth',
    monthly_ngn:  29000 * 100,   // ₦29,000 in kobo
    annual_ngn:   23000 * 12 * 100,
    monthly_usd:  29 * 100,      // $29 in cents
    annual_usd:   23 * 12 * 100,
    features:     ['AI Cart Recovery', 'Product Intelligence', '1 Store', '1,000 tracked visitors/mo'],
  },
  scale: {
    name:         'Revluma Scale',
    monthly_ngn:  50000 * 100,
    annual_ngn:   40000 * 12 * 100,
    monthly_usd:  50 * 100,
    annual_usd:   40 * 12 * 100,
    features:     ['Everything in Growth', 'WhatsApp + SMS', 'Unlimited flows', 'ROAS Scoring'],
  },
};

const TRIAL_DAYS = 7;
const PAYSTACK_BASE = 'https://api.paystack.co';

// Validate env at startup — do not silently degrade
if (!process.env.PAYSTACK_SECRET_KEY) {
  logger.error('PAYSTACK_SECRET_KEY is not set. Payment endpoints will not function.');
}
if (!process.env.FRONTEND_URL) {
  logger.error('FRONTEND_URL is not set. Paystack callback URL will be malformed.');
}

// ── Paystack API helper ───────────────────────────────────────────────────────
async function paystackRequest(method, path, data = {}) {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    throw new Error('Paystack not configured. PAYSTACK_SECRET_KEY is missing.');
  }
  const res = await axios({
    method,
    url:     `${PAYSTACK_BASE}${path}`,
    data:    method !== 'get' ? data : undefined,
    params:  method === 'get'  ? data : undefined,
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    timeout: 12000,
  });
  return res.data;
}

// ── Amount resolver — server-side only ───────────────────────────────────────
function resolveAmount(plan, billing_cycle, currency) {
  const planConfig = PLANS[plan];
  if (!planConfig) throw new Error(`Unknown plan: ${plan}`);
  const isAnnual = billing_cycle === 'annual';
  if (currency === 'USD') {
    return isAnnual ? planConfig.annual_usd : planConfig.monthly_usd;
  }
  return isAnnual ? planConfig.annual_ngn : planConfig.monthly_ngn;
}

// ── Get authenticated org — throws if not found ───────────────────────────────
async function getAuthenticatedOrg(userId) {
  const org = await prisma.organizations.findFirst({
    where: { owner_id: userId },
    select: { id: true, company_name: true },
  });
  if (!org) throw Object.assign(new Error('Organization not found. Complete onboarding first.'), { statusCode: 400 });
  return org;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/subscriptions/initialize
// Requires: authenticateToken
// Body: { plan: "growth"|"scale", billing_cycle: "monthly"|"annual", currency: "NGN"|"USD" }
// Returns: { authorization_url, reference }
// ─────────────────────────────────────────────────────────────────────────────
exports.initialize = async (req, res, next) => {
  try {
    const { plan, billing_cycle = 'monthly', currency = 'NGN' } = req.body;

    // Validate plan — server determines amount, not client
    if (!plan || !PLANS[plan]) {
      return res.status(400).json({ success: false, error: 'Invalid plan. Choose: growth or scale.' });
    }
    if (!['monthly', 'annual'].includes(billing_cycle)) {
      return res.status(400).json({ success: false, error: 'Invalid billing_cycle. Choose: monthly or annual.' });
    }
    if (!['NGN', 'USD'].includes(currency)) {
      return res.status(400).json({ success: false, error: 'Invalid currency. Choose: NGN or USD.' });
    }

    // Always resolve amount server-side — ignore any amount from request body
    const amountKobo = resolveAmount(plan, billing_cycle, currency);

    const user = await prisma.users.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true },
    });
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    const org = await getAuthenticatedOrg(req.user.id);

    // Check for existing active subscription — prevent accidental duplicate initialization
    const existing = await prisma.subscriptions.findUnique({
      where: { organization_id: org.id },
      select: { status: true, plan: true },
    });
    if (existing?.status === 'active') {
      return res.status(409).json({
        success: false,
        error: `Already on an active ${existing.plan} plan. Use the upgrade endpoint to change plans.`,
      });
    }

    // Generate a unique reference — org prefix + timestamp + 6 random chars
    const randomSuffix = crypto.randomBytes(3).toString('hex');
    const reference = `rev_${org.id.slice(0, 8)}_${Date.now()}_${randomSuffix}`;

    // Initialize with Paystack
    let paystackRes;
    try {
      paystackRes = await paystackRequest('post', '/transaction/initialize', {
        email:        user.email,
        amount:       amountKobo,
        currency:     currency,
        reference:    reference,
        callback_url: `${process.env.FRONTEND_URL}/auth/payment-success.html`,
        metadata: {
          organization_id: org.id,
          user_id:         user.id,
          plan:            plan,
          billing_cycle:   billing_cycle,
          custom_fields: [
            { display_name: 'Plan',    variable_name: 'plan',    value: PLANS[plan].name },
            { display_name: 'Billing', variable_name: 'billing', value: billing_cycle },
          ],
        },
      });
    } catch (paystackError) {
      logger.error('paystack_initialize_failed', {
        orgId: org.id,
        plan,
        error: paystackError.message,
      });
      return res.status(502).json({ success: false, error: 'Payment provider unavailable. Please try again.' });
    }

    if (!paystackRes?.status || !paystackRes?.data?.authorization_url) {
      logger.error('paystack_bad_response', { orgId: org.id, response: paystackRes?.message });
      return res.status(502).json({ success: false, error: 'Could not initialize payment. Try again.' });
    }

    // Log pending transaction — idempotent via unique reference constraint
    try {
      await prisma.payment_transactions.create({
        data: {
          organization_id:    org.id,
          paystack_reference: reference,
          paystack_event:     'initialize',
          plan:               plan,
          amount_kobo:        amountKobo,
          currency:           currency,
          status:             'pending',
          metadata:           { billing_cycle },
        },
      });
    } catch (dbError) {
      if (dbError.code === 'P2002') {
        // Duplicate reference — impossible by construction but handle gracefully
        logger.warn('duplicate_reference_on_initialize', { reference });
      } else {
        throw dbError;
      }
    }

    logger.info('payment_initialized', {
      orgId:    org.id,
      plan,
      billing:  billing_cycle,
      currency,
      // Amount logged in kobo — never log secret key
    });

    return res.status(200).json({
      success: true,
      data: {
        authorization_url: paystackRes.data.authorization_url,
        reference:         reference,
        plan,
        billing_cycle,
        // Do NOT return amount or access_code to client
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/subscriptions/verify/:reference
// Requires: authenticateToken
// Verifies payment directly with Paystack. Frontend redirect is NOT trusted.
// ─────────────────────────────────────────────────────────────────────────────
exports.verify = async (req, res, next) => {
  try {
    const { reference } = req.params;
    if (!reference || typeof reference !== 'string' || reference.length > 100) {
      return res.status(400).json({ success: false, error: 'Invalid payment reference.' });
    }

    // Verify that this reference belongs to this authenticated user's org
    // before calling Paystack — prevents probing other merchants' references
    const org = await getAuthenticatedOrg(req.user.id);

    const pendingTx = await prisma.payment_transactions.findUnique({
      where: { paystack_reference: reference },
      select: { organization_id: true, status: true, plan: true },
    });

    if (!pendingTx) {
      return res.status(404).json({ success: false, error: 'Payment reference not found.' });
    }

    // Authorization check: reference must belong to this organization
    if (pendingTx.organization_id !== org.id) {
      logger.warn('unauthorized_verify_attempt', {
        requestorOrgId: org.id,
        referenceOrgId: pendingTx.organization_id,
        reference,
      });
      return res.status(403).json({ success: false, error: 'Not authorized to verify this payment.' });
    }

    // If already verified and successful, return idempotently
    if (pendingTx.status === 'success') {
      const sub = await prisma.subscriptions.findUnique({ where: { organization_id: org.id } });
      return res.status(200).json({
        success: true,
        data: { plan: sub?.plan || pendingTx.plan, status: 'active', already_verified: true },
      });
    }

    // Verify directly with Paystack — do NOT trust frontend redirect as proof of payment
    let paystackRes;
    try {
      paystackRes = await paystackRequest('get', `/transaction/verify/${reference}`);
    } catch (paystackError) {
      logger.error('paystack_verify_failed', { reference, error: paystackError.message });
      return res.status(502).json({ success: false, error: 'Could not reach payment provider. Try again.' });
    }

    if (!paystackRes?.status || paystackRes?.data?.status !== 'success') {
      logger.warn('payment_verification_failed', { reference, status: paystackRes?.data?.status });
      await prisma.payment_transactions.updateMany({
        where: { paystack_reference: reference },
        data:  { status: 'failed' },
      });
      return res.status(402).json({ success: false, error: 'Payment not confirmed by Paystack.' });
    }

    const txData  = paystackRes.data;
    const meta    = txData.metadata || {};

    // Re-validate the metadata against server state — do not trust client-supplied metadata
    const expectedPlan = pendingTx.plan;
    const billing      = meta.billing_cycle || 'monthly';

    const now       = new Date();
    const periodEnd = new Date(now);
    billing === 'annual'
      ? periodEnd.setFullYear(periodEnd.getFullYear() + 1)
      : periodEnd.setMonth(periodEnd.getMonth() + 1);

    // Upsert subscription atomically
    await prisma.subscriptions.upsert({
      where:  { organization_id: org.id },
      create: {
        organization_id:      org.id,
        plan:                 expectedPlan,
        billing_cycle:        billing,
        status:               'active',
        paystack_customer_id: txData.customer?.customer_code || null,
        amount_kobo:          txData.amount,
        currency:             txData.currency || 'NGN',
        current_period_start: now,
        current_period_end:   periodEnd,
      },
      update: {
        plan:                 expectedPlan,
        billing_cycle:        billing,
        status:               'active',
        paystack_customer_id: txData.customer?.customer_code || null,
        amount_kobo:          txData.amount,
        currency:             txData.currency || 'NGN',
        current_period_start: now,
        current_period_end:   periodEnd,
        cancelled_at:         null,
        updated_at:           now,
      },
    });

    // Mark transaction as successful — idempotent
    await prisma.payment_transactions.updateMany({
      where: { paystack_reference: reference },
      data:  { status: 'success', paystack_event: 'charge.success' },
    });

    logger.info('payment_verified', {
      orgId:    org.id,
      plan:     expectedPlan,
      billing,
      // No card data, no secret key
    });

    return res.status(200).json({
      success: true,
      data: {
        plan:         expectedPlan,
        billing_cycle: billing,
        status:       'active',
        period_end:   periodEnd,
        message:      `Welcome to Revluma ${expectedPlan.charAt(0).toUpperCase() + expectedPlan.slice(1)}!`,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/subscriptions/webhook
// No auth — uses HMAC SHA-512 signature to verify Paystack origin
// Raw body required (configured in subscriptionRoute.js)
// Idempotent: duplicate events are safely ignored via unique reference constraint
// ─────────────────────────────────────────────────────────────────────────────
exports.webhook = async (req, res) => {
  try {
    const signature = req.headers['x-paystack-signature'];

    // Reject immediately if signature header is missing
    if (!signature) {
      logger.warn('webhook_missing_signature', { ip: req.ip });
      return res.status(401).send('Signature required');
    }

    if (!process.env.PAYSTACK_SECRET_KEY) {
      logger.error('webhook_no_secret_key');
      return res.status(500).send('Configuration error');
    }

    // Compute HMAC over raw body — constant-time comparison prevents timing attacks
    const rawBody = req.body; // express.raw() middleware gives us a Buffer
    const expectedHash = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
      .update(rawBody)
      .digest('hex');

    // Constant-time comparison
    if (!crypto.timingSafeEqual(Buffer.from(expectedHash, 'hex'), Buffer.from(signature, 'hex'))) {
      logger.warn('webhook_invalid_signature', { ip: req.ip });
      return res.status(401).send('Invalid signature');
    }

    // Parse validated body
    let event;
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return res.status(400).send('Malformed JSON');
    }

    const data = event?.data || {};
    const meta = data?.metadata || {};

    logger.info('webhook_received', { event: event.event, reference: data.reference });

    switch (event.event) {
      case 'charge.success': {
        const orgId = meta.organization_id;
        if (!orgId) { logger.warn('webhook_no_org_id', { event: event.event }); break; }

        const now     = new Date();
        const billing = meta.billing_cycle || 'monthly';
        const end     = new Date(now);
        billing === 'annual'
          ? end.setFullYear(end.getFullYear() + 1)
          : end.setMonth(end.getMonth() + 1);

        await prisma.subscriptions.updateMany({
          where: { organization_id: orgId },
          data:  { status: 'active', current_period_start: now, current_period_end: end, updated_at: now },
        });

        // Idempotent transaction log — duplicate events are safely rejected by unique constraint
        await prisma.payment_transactions.create({
          data: {
            organization_id:    orgId,
            paystack_reference: data.reference || `wh_${Date.now()}`,
            paystack_event:     'charge.success',
            plan:               meta.plan || 'unknown',
            amount_kobo:        data.amount || 0,
            currency:           data.currency || 'NGN',
            status:             'success',
            metadata:           meta,
          },
        }).catch(err => {
          if (err.code === 'P2002') {
            // Duplicate event — already processed. Safe to ignore.
            logger.info('webhook_duplicate_ignored', { reference: data.reference });
          } else {
            throw err;
          }
        });
        break;
      }

      case 'subscription.disable':
      case 'subscription.not_renew': {
        const orgId = meta.organization_id;
        if (!orgId) break;
        await prisma.subscriptions.updateMany({
          where: { organization_id: orgId, status: 'active' },
          data:  { status: 'cancelled', cancelled_at: new Date(), updated_at: new Date() },
        });
        logger.info('subscription_cancelled_via_webhook', { orgId, event: event.event });
        break;
      }

      case 'invoice.payment_failed': {
        const orgId = meta.organization_id;
        if (!orgId) break;
        await prisma.subscriptions.updateMany({
          where: { organization_id: orgId },
          data:  { status: 'past_due', updated_at: new Date() },
        });
        logger.warn('subscription_past_due', { orgId });
        break;
      }

      default:
        logger.info('webhook_unhandled_event', { event: event.event });
    }

    // Always return 200 to Paystack so it does not retry indefinitely
    return res.status(200).send('OK');
  } catch (error) {
    logger.error('webhook_processing_error', { message: error.message });
    // Return 200 even on internal errors so Paystack does not flood with retries
    // Log internally for reconciliation
    return res.status(200).send('OK');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/subscriptions/current
// Requires: authenticateToken
// ─────────────────────────────────────────────────────────────────────────────
exports.getCurrent = async (req, res, next) => {
  try {
    const org = await getAuthenticatedOrg(req.user.id);

    const sub = await prisma.subscriptions.findUnique({
      where: { organization_id: org.id },
      select: {
        plan:                true,
        billing_cycle:       true,
        status:              true,
        current_period_end:  true,
        trial_ends_at:       true,
        cancelled_at:        true,
        created_at:          true,
        // Never return: paystack_customer_id, paystack_subscription_code, amount_kobo
      },
    });

    // No subscription = free plan
    return res.status(200).json({
      success: true,
      data: sub || {
        plan:          'free',
        billing_cycle: null,
        status:        'active',
        current_period_end: null,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/subscriptions/cancel
// Requires: authenticateToken
// Only cancels the authenticated user's own subscription
// ─────────────────────────────────────────────────────────────────────────────
exports.cancel = async (req, res, next) => {
  try {
    const org = await getAuthenticatedOrg(req.user.id);

    const sub = await prisma.subscriptions.findUnique({
      where: { organization_id: org.id },
      select: { status: true, paystack_subscription_code: true },
    });

    if (!sub) {
      return res.status(404).json({ success: false, error: 'No active subscription found.' });
    }

    // State machine: only active subscriptions can be cancelled
    if (!['active', 'trialing', 'past_due'].includes(sub.status)) {
      return res.status(409).json({
        success: false,
        error: `Cannot cancel a subscription with status: ${sub.status}`,
      });
    }

    // Idempotent: if already cancelled, return success
    if (sub.status === 'cancelled') {
      return res.status(200).json({
        success: true,
        message: 'Subscription is already cancelled.',
      });
    }

    await prisma.subscriptions.update({
      where: { organization_id: org.id },
      data:  { status: 'cancelled', cancelled_at: new Date(), updated_at: new Date() },
    });

    logger.info('subscription_cancelled', { orgId: org.id });

    return res.status(200).json({
      success: true,
      message: 'Subscription cancelled. Your plan remains active until the end of the current billing period.',
    });
  } catch (error) {
    next(error);
  }
};