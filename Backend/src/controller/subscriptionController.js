/**
 * Revluma Subscription Controller
 * Handles Paystack payment initialization, verification, webhooks, and plan management.
 *
 * Flow:
 *   1. POST /api/v1/subscriptions/initialize  — create Paystack transaction, return payment URL
 *   2. Paystack redirects to /auth/payment-success.html?reference=xxx
 *   3. GET  /api/v1/subscriptions/verify/:reference — verify payment, activate subscription
 *   4. POST /api/v1/subscriptions/webhook — Paystack webhook (recurring billing events)
 *   5. GET  /api/v1/subscriptions/current — return current subscription for dashboard
 *   6. POST /api/v1/subscriptions/cancel  — cancel subscription
 */

const axios  = require('axios');
const crypto = require('crypto');

const dbConfig = require('../configs/database');
const prisma   = dbConfig.prisma;

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE   = 'https://api.paystack.co';

// Plan definitions — amounts in kobo (Naira * 100)
// Also include USD for international merchants
const PLANS = {
  growth: {
    name:         'Revluma Growth',
    monthly_kobo: 2900 * 100,   // ₦29,000/mo  (~$29 USD at ~₦1000/USD)
    annual_kobo:  23 * 12 * 100 * 1000, // ₦276,000/yr (20% off)
    monthly_usd:  29 * 100,     // $29 in cents (for USD transactions)
    annual_usd:   23 * 12 * 100,
    features:     ['AI Cart Recovery', 'Product Intelligence', '1 Store', '1,000 tracked visitors/mo'],
  },
  scale: {
    name:         'Revluma Scale',
    monthly_kobo: 5000 * 100,
    annual_kobo:  40 * 12 * 100 * 1000,
    monthly_usd:  50 * 100,
    annual_usd:   40 * 12 * 100,
    features:     ['Everything in Growth', 'WhatsApp + SMS', 'Unlimited flows', 'ROAS Scoring'],
  },
};

const TRIAL_DAYS = 7;

/**
 * Helper: call Paystack API
 */
async function paystackRequest(method, path, data = {}) {
  const res = await axios({
    method,
    url:     `${PAYSTACK_BASE}${path}`,
    data:    method !== 'get' ? data : undefined,
    params:  method === 'get'  ? data : undefined,
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET}`,
      'Content-Type': 'application/json',
    },
    timeout: 10000,
  });
  return res.data;
}

// ─── POST /api/v1/subscriptions/initialize ────────────────────────────────────
exports.initialize = async (req, res, next) => {
  try {
    const { plan, billing_cycle = 'monthly', currency = 'NGN' } = req.body;

    if (!plan || !PLANS[plan]) {
      return res.status(400).json({ success: false, error: 'Invalid plan. Choose growth or scale.' });
    }

    const user = await prisma.users.findUnique({
      where:  { id: req.user.id },
      select: { id: true, email: true, full_name: true },
    });

    const org = await prisma.organizations.findFirst({
      where:  { owner_id: req.user.id },
      select: { id: true, company_name: true },
    });

    if (!org) {
      return res.status(400).json({ success: false, error: 'Organization not found. Complete onboarding first.' });
    }

    // Amount in kobo or cents depending on currency
    const isAnnual   = billing_cycle === 'annual';
    const amountKobo = currency === 'NGN'
      ? (isAnnual ? PLANS[plan].annual_kobo  : PLANS[plan].monthly_kobo)
      : (isAnnual ? PLANS[plan].annual_usd   : PLANS[plan].monthly_usd);

    const reference = `rev_${org.id.slice(0, 8)}_${Date.now()}`;

    // Initialize Paystack transaction
    const paystackRes = await paystackRequest('post', '/transaction/initialize', {
      email:     user.email,
      amount:    amountKobo,
      currency:  currency,
      reference: reference,
      callback_url: `${process.env.FRONTEND_URL}/auth/payment-success.html`,
      metadata: {
        organization_id:  org.id,
        user_id:          user.id,
        plan:             plan,
        billing_cycle:    billing_cycle,
        company_name:     org.company_name,
        custom_fields: [
          { display_name: 'Plan', variable_name: 'plan', value: PLANS[plan].name },
          { display_name: 'Billing', variable_name: 'billing', value: billing_cycle },
        ],
      },
    });

    if (!paystackRes.status) {
      return res.status(502).json({ success: false, error: 'Could not initialize payment. Try again.' });
    }

    // Log pending transaction
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

    return res.status(200).json({
      success:      true,
      data: {
        authorization_url: paystackRes.data.authorization_url,
        reference:         reference,
        plan,
        billing_cycle,
        amount_kobo:       amountKobo,
        currency,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─── GET /api/v1/subscriptions/verify/:reference ──────────────────────────────
exports.verify = async (req, res, next) => {
  try {
    const { reference } = req.params;

    if (!reference) {
      return res.status(400).json({ success: false, error: 'Payment reference required.' });
    }

    // Verify with Paystack
    const paystackRes = await paystackRequest('get', `/transaction/verify/${reference}`);

    if (!paystackRes.status || paystackRes.data.status !== 'success') {
      return res.status(402).json({ success: false, error: 'Payment not confirmed. Please try again.' });
    }

    const txData  = paystackRes.data;
    const meta    = txData.metadata || {};
    const orgId   = meta.organization_id;
    const plan    = meta.plan;
    const billing = meta.billing_cycle || 'monthly';

    if (!orgId || !plan) {
      return res.status(400).json({ success: false, error: 'Invalid payment metadata.' });
    }

    // Verify org belongs to authenticated user
    const org = await prisma.organizations.findFirst({
      where: { id: orgId, owner_id: req.user.id },
    });
    if (!org) {
      return res.status(403).json({ success: false, error: 'Unauthorized.' });
    }

    const now          = new Date();
    const periodEnd    = new Date(now);
    billing === 'annual'
      ? periodEnd.setFullYear(periodEnd.getFullYear() + 1)
      : periodEnd.setMonth(periodEnd.getMonth() + 1);

    // Upsert subscription
    await prisma.subscriptions.upsert({
      where:  { organization_id: orgId },
      create: {
        organization_id:      orgId,
        plan:                 plan,
        billing_cycle:        billing,
        status:               'active',
        paystack_customer_id: txData.customer?.customer_code || null,
        amount_kobo:          txData.amount,
        currency:             txData.currency,
        current_period_start: now,
        current_period_end:   periodEnd,
      },
      update: {
        plan:                 plan,
        billing_cycle:        billing,
        status:               'active',
        paystack_customer_id: txData.customer?.customer_code || null,
        amount_kobo:          txData.amount,
        currency:             txData.currency,
        current_period_start: now,
        current_period_end:   periodEnd,
        cancelled_at:         null,
        updated_at:           now,
      },
    });

    // Update transaction record
    await prisma.payment_transactions.updateMany({
      where: { paystack_reference: reference },
      data:  { status: 'success', paystack_event: 'charge.success' },
    });

    return res.status(200).json({
      success: true,
      data: {
        plan,
        billing_cycle:  billing,
        status:         'active',
        period_end:     periodEnd,
        message:        `Welcome to Revluma ${plan.charAt(0).toUpperCase() + plan.slice(1)}!`,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─── POST /api/v1/subscriptions/webhook ───────────────────────────────────────
// Paystack sends events here for recurring billing
exports.webhook = async (req, res) => {
  try {
    // Verify webhook signature
    const hash = crypto
      .createHmac('sha512', PAYSTACK_SECRET)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      return res.status(401).send('Invalid signature');
    }

    const event = req.body;
    const data  = event.data;

    switch (event.event) {
      case 'charge.success': {
        const meta  = data.metadata || {};
        const orgId = meta.organization_id;
        if (!orgId) break;

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

        await prisma.payment_transactions.create({
          data: {
            organization_id:    orgId,
            paystack_reference: data.reference,
            paystack_event:     'charge.success',
            plan:               meta.plan,
            amount_kobo:        data.amount,
            currency:           data.currency || 'NGN',
            status:             'success',
            metadata:           meta,
          },
        }).catch(() => {}); // Ignore duplicate reference
        break;
      }

      case 'subscription.disable':
      case 'subscription.not_renew': {
        const meta  = data.metadata || {};
        const orgId = meta.organization_id;
        if (!orgId) break;
        await prisma.subscriptions.updateMany({
          where: { organization_id: orgId },
          data:  { status: 'cancelled', cancelled_at: new Date(), updated_at: new Date() },
        });
        break;
      }

      case 'invoice.payment_failed': {
        const meta  = data.metadata || {};
        const orgId = meta.organization_id;
        if (!orgId) break;
        await prisma.subscriptions.updateMany({
          where: { organization_id: orgId },
          data:  { status: 'past_due', updated_at: new Date() },
        });
        break;
      }
    }

    return res.status(200).send('OK');
  } catch (error) {
    console.error('[Webhook Error]', error.message);
    return res.status(500).send('Error');
  }
};

// ─── GET /api/v1/subscriptions/current ────────────────────────────────────────
exports.getCurrent = async (req, res, next) => {
  try {
    const org = await prisma.organizations.findFirst({
      where:  { owner_id: req.user.id },
      select: { id: true },
    });

    if (!org) {
      return res.status(404).json({ success: false, error: 'Organization not found.' });
    }

    const sub = await prisma.subscriptions.findUnique({
      where: { organization_id: org.id },
    });

    // No subscription = free plan
    const response = sub || {
      plan:           'free',
      billing_cycle:  'monthly',
      status:         'active',
      current_period_end: null,
    };

    return res.status(200).json({ success: true, data: response });
  } catch (error) {
    next(error);
  }
};

// ─── POST /api/v1/subscriptions/cancel ───────────────────────────────────────
exports.cancel = async (req, res, next) => {
  try {
    const org = await prisma.organizations.findFirst({
      where:  { owner_id: req.user.id },
      select: { id: true },
    });

    if (!org) {
      return res.status(404).json({ success: false, error: 'Organization not found.' });
    }

    await prisma.subscriptions.updateMany({
      where: { organization_id: org.id, status: 'active' },
      data:  { status: 'cancelled', cancelled_at: new Date(), updated_at: new Date() },
    });

    // TODO: Also cancel on Paystack via subscription code when recurring billing is live

    return res.status(200).json({
      success: true,
      message: 'Subscription cancelled. Your plan stays active until the end of the current billing period.',
    });
  } catch (error) {
    next(error);
  }
};