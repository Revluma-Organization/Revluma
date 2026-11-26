// Plan registry and initialize validation for the public pricing plans
// (Starter $29 / Premium $79, yearly 20% off), all billed in USD. Runs without a database or
// Paystack: dependencies are stubbed before the controller is loaded.
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

process.env.PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || 'sk_test_plans';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'https://revluma.test';

const calls = { paystack: [], transactions: [], txUpdates: [], charge: null };
const prisma = {
  users: { findUnique: async () => ({ id: 'user-1', email: 'owner@example.test' }) },
  organizations: { findUnique: async () => ({ id: 'org-12345678', company_name: 'Test Store' }) },
  subscriptions: {
    findUnique: async () => (calls.subscription ? { ...calls.subscription } : null),
    upsert: async ({ create, update }) => { calls.subscription = { ...(calls.subscription || create), ...(calls.subscription ? update : {}) }; return { ...calls.subscription }; },
    update: async ({ data }) => { Object.assign(calls.subscription, data); return { ...calls.subscription }; },
  },
  payment_transactions: {
    create: async ({ data }) => { calls.transactions.push(data); return data; },
    findUnique: async () => (calls.pendingTx ? { ...calls.pendingTx } : null),
    updateMany: async ({ data }) => { calls.txUpdates.push(data); return { count: 1 }; },
  },
};
const stubs = {
  '../configs/database': { prisma },
  '../utils/logger': { info() {}, warn() {}, error() {} },
  '../utils/organizationContext': { requireMembership: async () => ({ role: 'owner', organization_id: 'org-12345678' }) },
  axios: async (request) => {
    calls.paystack.push(request);
    if (request.method === 'get') return { data: { status: true, data: calls.charge } };
    return { data: { status: true, data: { authorization_url: 'https://checkout.paystack.test/abc', reference: request.data.reference } } };
  },
};
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return originalLoad.call(this, request, parent, isMain);
};
const controller = require(path.join(__dirname, '..', 'subscriptionController.js'));
Module._load = originalLoad;

function response() {
  return {
    statusCode: 0,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}
async function initialize(body) {
  const res = response();
  let error = null;
  await controller.initialize({ body, user: { id: 'user-1', tenantId: 'org-12345678' } }, res, (err) => { error = err; });
  if (error) throw error;
  return res;
}

(async () => {
  // Registry matches the pricing page.
  assert.deepEqual(Object.keys(controller.PLANS).sort(), ['premium', 'starter']);
  assert.equal(controller.resolveAmount('starter', 'monthly', 'USD'), 2900);
  assert.equal(controller.resolveAmount('starter', 'annual', 'USD'), 23 * 12 * 100);
  assert.equal(controller.resolveAmount('premium', 'monthly', 'USD'), 7900);
  assert.equal(controller.resolveAmount('premium', 'annual', 'USD'), 63 * 12 * 100);
  for (const plan of ['starter', 'premium']) {
    const monthly = controller.resolveAmount(plan, 'monthly', 'USD');
    const annual = controller.resolveAmount(plan, 'annual', 'USD');
    // Yearly is 20% off, rounded down to the dollar per month.
    assert.equal(annual / 12, Math.floor((monthly / 100) * 0.8) * 100);
  }
  assert.equal(controller.resolveAmount('premium', 'monthly'), 7900);
  assert.throws(() => controller.resolveAmount('premium', 'monthly', 'NGN'), /Unsupported currency/);

  // A charge only counts when amount and currency match what the server asked for.
  assert.equal(controller.chargeMatches({ amount_kobo: 2900, currency: 'USD' }, { amount: 2900, currency: 'usd' }), true);
  assert.equal(controller.chargeMatches({ amount_kobo: 2900, currency: 'USD' }, { amount: 2800, currency: 'USD' }), false);
  assert.equal(controller.chargeMatches({ amount_kobo: 2900, currency: 'USD' }, { amount: 2900, currency: 'NGN' }), false);
  assert.equal(controller.chargeMatches(null, { amount: 2900, currency: 'USD' }), false);

  // Legacy identifiers map onto the current plans; unknown plans are rejected.
  assert.equal(controller.normalizePlan('growth'), 'starter');
  assert.equal(controller.normalizePlan('scale'), 'premium');
  assert.equal(controller.normalizePlan(' Premium '), 'premium');
  assert.equal(controller.normalizePlan('enterprise'), null);
  assert.equal(controller.normalizePlan('__proto__'), null);
  assert.equal(controller.normalizePlan(undefined), null);

  // initialize charges the server-side amount for the canonical plan.
  let res = await initialize({ plan: 'premium', billing_cycle: 'annual', currency: 'USD' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.authorization_url, 'https://checkout.paystack.test/abc');
  assert.equal(calls.paystack.at(-1).data.amount, 63 * 12 * 100);
  assert.equal(calls.paystack.at(-1).data.metadata.plan, 'premium');
  assert.equal(calls.transactions.at(-1).plan, 'premium');

  // A client-supplied amount is ignored.
  res = await initialize({ plan: 'starter', amount: 1, currency: 'USD' });
  assert.equal(res.statusCode, 200);
  assert.equal(calls.paystack.at(-1).data.amount, 2900);

  // Legacy plan ids still work and are stored under the new plan, in USD.
  res = await initialize({ plan: 'growth', billing_cycle: 'monthly' });
  assert.equal(res.statusCode, 200);
  assert.equal(calls.transactions.at(-1).plan, 'starter');
  assert.equal(calls.transactions.at(-1).currency, 'USD');
  assert.equal(calls.paystack.at(-1).data.amount, 2900);
  assert.equal(calls.paystack.at(-1).data.currency, 'USD');

  // Everything is charged in dollars: other currencies are refused before Paystack is called.
  const paystackCalls = calls.paystack.length;
  res = await initialize({ plan: 'starter', currency: 'NGN' });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /USD/);
  assert.equal(calls.paystack.length, paystackCalls);

  for (const plan of ['enterprise', 'free', '', null]) {
    res = await initialize({ plan });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /starter or premium/);
  }

  // The free trial records the plan the merchant chose and is used once.
  async function startTrial(body) {
    const res = response(); let error = null;
    await controller.startTrial({ body, user: { id: 'user-1', tenantId: 'org-12345678' } }, res, (err) => { error = err; });
    if (error) throw error;
    return res;
  }
  calls.subscription = null;
  res = await startTrial({ plan: 'scale', billing_cycle: 'annual' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.status, 'in_trial');
  assert.equal(calls.subscription.plan, 'premium');
  assert.equal(calls.subscription.billing_cycle, 'annual');
  assert.equal(calls.subscription.currency, 'USD');
  const trialEnds = calls.subscription.trial_ends_at;
  assert.ok(Math.abs(trialEnds - Date.now() - 7 * 864e5) < 5000, 'trial lasts 7 days');
  res = await startTrial({ plan: 'starter' });
  assert.equal(res.statusCode, 200);
  assert.equal(calls.subscription.plan, 'starter', 'switching plan during the trial');
  assert.equal(calls.subscription.trial_ends_at, trialEnds, 'switching does not extend the trial');
  res = await startTrial({ plan: 'enterprise' });
  assert.equal(res.statusCode, 400);
  calls.subscription.trial_ends_at = new Date(Date.now() - 1000);
  res = await startTrial({ plan: 'starter' });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'TRIAL_USED');
  calls.subscription = null;
  res = await startTrial(undefined);
  assert.equal(calls.subscription.plan, 'starter', 'defaults to Starter');

  // verify only activates a plan when Paystack charged exactly the expected USD amount.
  async function verify(reference) {
    const res = response(); let error = null;
    await controller.verify({ params: { reference }, user: { id: 'user-1', tenantId: 'org-12345678' } }, res, (err) => { error = err; });
    if (error) throw error;
    return res;
  }
  calls.pendingTx = { organization_id: 'org-12345678', status: 'pending', plan: 'premium', amount_kobo: 7900, currency: 'USD' };
  for (const charge of [{ amount: 100, currency: 'USD' }, { amount: 7900, currency: 'NGN' }, { amount: 7900 }]) {
    calls.subscription = null; calls.txUpdates.length = 0;
    calls.charge = { status: 'success', metadata: { billing_cycle: 'monthly' }, ...charge };
    res = await verify('RVL-test-ref');
    assert.equal(res.statusCode, 402, JSON.stringify(charge));
    assert.equal(calls.subscription, null, 'a mismatched charge must not activate a plan');
    assert.equal(calls.txUpdates.at(-1).status, 'failed');
  }
  calls.charge = { status: 'success', amount: 7900, currency: 'USD', metadata: { billing_cycle: 'monthly' } };
  res = await verify('RVL-test-ref');
  assert.equal(res.statusCode, 200);
  assert.equal(calls.subscription.plan, 'premium');
  assert.equal(calls.subscription.status, 'active');
  assert.equal(calls.subscription.currency, 'USD');

  console.log('subscription plans: all assertions passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
