// Plan registry and initialize validation for the public pricing plans
// (Starter $29 / Premium $79, yearly 20% off). Runs without a database or
// Paystack: dependencies are stubbed before the controller is loaded.
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

process.env.PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || 'sk_test_plans';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'https://revluma.test';

const calls = { paystack: [], transactions: [] };
const prisma = {
  users: { findUnique: async () => ({ id: 'user-1', email: 'owner@example.test' }) },
  organizations: { findUnique: async () => ({ id: 'org-12345678', company_name: 'Test Store' }) },
  subscriptions: { findUnique: async () => null },
  payment_transactions: { create: async ({ data }) => { calls.transactions.push(data); return data; } },
};
const stubs = {
  '../configs/database': { prisma },
  '../utils/logger': { info() {}, warn() {}, error() {} },
  '../utils/organizationContext': { requireMembership: async () => ({ role: 'owner', organization_id: 'org-12345678' }) },
  axios: async (request) => {
    calls.paystack.push(request);
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
  assert.equal(controller.resolveAmount('premium', 'monthly', 'NGN'), 79000 * 100);

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

  // Legacy dashboard checkout still works and is stored under the new plan.
  res = await initialize({ plan: 'growth', billing_cycle: 'monthly', currency: 'NGN' });
  assert.equal(res.statusCode, 200);
  assert.equal(calls.transactions.at(-1).plan, 'starter');
  assert.equal(calls.paystack.at(-1).data.amount, 29000 * 100);

  for (const plan of ['enterprise', 'free', '', null]) {
    res = await initialize({ plan });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /starter or premium/);
  }

  console.log('subscription plans: all assertions passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
