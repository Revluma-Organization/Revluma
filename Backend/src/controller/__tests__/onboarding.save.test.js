// Onboarding answers are saved to the database the moment each step is
// completed. Mocked persistence; checks validation, tenancy and what is stored.
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

let membership;
let user;
let organisation;
let profile;
let objectives;
const writes = [];
const prisma = {
  users: {
    findUnique: async () => ({ ...user }),
    update: async ({ data }) => { writes.push(['users', data]); Object.assign(user, data); return { ...user }; },
  },
  organizations: {
    findUnique: async () => ({ ...organisation }),
    update: async ({ where, data }) => { assert.equal(where.id, membership.organization_id); writes.push(['organizations', data]); Object.assign(organisation, data); return { ...organisation }; },
  },
  onboarding_profiles: {
    findUnique: async () => (profile ? { onboarding_objectives: objectives.map((objective) => ({ objective })) } : null),
    upsert: async ({ where }) => { assert.equal(where.user_id, 'user-1'); profile = profile || { id: 'profile-1' }; return profile; },
  },
  onboarding_objectives: {
    deleteMany: async () => { objectives = []; },
    createMany: async ({ data }) => { objectives.push(...data.map((row) => row.objective)); },
  },
  $transaction: async (operation) => operation(prisma),
};
const stubs = {
  '../configs/database': { prisma },
  '../utils/logger': { info() {}, warn() {}, error() {} },
  '../utils/organizationContext': {
    requireMembership: async (db, userId) => {
      assert.equal(userId, 'user-1');
      if (!membership) throw Object.assign(new Error('Select an active organisation workspace.'), { statusCode: 403 });
      return membership;
    },
  },
};
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return originalLoad.call(this, request, parent, isMain);
};
const controller = require(path.join(__dirname, '..', 'onboardingController.js'));
Module._load = originalLoad;

function response() {
  return { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
async function call(method, body) {
  const res = response(); let error = null;
  await controller[method]({ body, user: { id: 'user-1', tenantId: 'org-1' } }, res, (failure) => { error = failure; });
  if (error) throw error;
  return res;
}
function reset() {
  membership = { organization_id: 'org-1', role: 'owner' };
  user = { onboarding_step: 1, onboarding_completed: false };
  organisation = { company_name: "Ada's store", store_url: null, industry: 'Unspecified', monthly_order_volume: null };
  profile = null; objectives = []; writes.length = 0;
}
const store = { store_name: '  Ada   Threads ', store_url: 'HTTPS://Ada-Threads.myshopify.com/collections/all?x=1', store_category: 'fashion', monthly_orders: '100_1000' };

(async () => {
  // URL normalisation.
  const url = controller.normaliseStoreUrl;
  assert.equal(url('ada.myshopify.com'), 'https://ada.myshopify.com');
  assert.equal(url('http://Shop.Example.co.uk:8080/path'), 'https://shop.example.co.uk');
  for (const bad of ['', 'localhost', 'javascript:alert(1)', 'ada', 'a..b.com', '-a.com', 'a.c0m', null, 42]) assert.equal(url(bad), null, String(bad));
  assert.equal(controller.normaliseStoreName('<script>'), null);
  assert.equal(controller.normaliseStoreName('x'.repeat(121)), null);

  // Fresh account: signup placeholders are never shown back as answers.
  reset();
  let res = await call('getOnboarding');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data, { step: 1, completed: false, store: { name: '', url: '', category: '', monthly_orders: '' }, goals: [] });
  console.log('PASS fresh account resumes at step 1 with empty answers');

  // Step 1 validation.
  for (const [patch, field] of [
    [{ store_name: '' }, 'store_name'], [{ store_url: 'not a url' }, 'store_url'],
    [{ store_category: 'weapons' }, 'store_category'], [{ monthly_orders: '1m' }, 'monthly_orders'],
  ]) {
    res = await call('saveStore', { ...store, ...patch });
    assert.equal(res.statusCode, 400); assert.equal(res.body.field, field);
  }
  assert.equal(writes.length, 0);

  // Step 1 saved immediately to the organisation and progress recorded.
  res = await call('saveStore', { ...store, organization_id: 'someone-elses-org' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(organisation, { company_name: 'Ada Threads', store_url: 'https://ada-threads.myshopify.com', website_url: 'https://ada-threads.myshopify.com', industry: 'fashion', custom_industry: null, monthly_order_volume: '100_1000', updated_at: organisation.updated_at });
  assert.equal(user.onboarding_step, 2);
  assert.equal(user.onboarding_completed, false);
  assert.deepEqual(res.body.data.store, { name: 'Ada Threads', url: 'https://ada-threads.myshopify.com', category: 'fashion', monthly_orders: '100_1000' });
  res = await call('getOnboarding');
  assert.equal(res.body.data.step, 2);
  assert.equal(res.body.data.store.name, 'Ada Threads');
  console.log('PASS step 1 saved to the organisation and resumable');

  // Step 2 validation and save.
  for (const goals of [undefined, [], ['world_domination'], ['priorities', 'x'], 'priorities']) {
    res = await call('saveGoals', { goals });
    assert.equal(res.statusCode, 400);
  }
  res = await call('saveGoals', { goals: ['priorities', 'sales_changes', 'priorities'] });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(objectives, ['priorities', 'sales_changes']);
  assert.equal(user.onboarding_completed, true);
  assert.equal(user.onboarding_step, 3);
  res = await call('saveGoals', { goals: ['customer_behaviour'] });
  assert.deepEqual(objectives, ['customer_behaviour'], 'saving again replaces goals instead of duplicating them');
  res = await call('getOnboarding');
  assert.deepEqual(res.body.data.goals, ['customer_behaviour']);
  assert.equal(res.body.data.completed, true);

  // Re-saving step 1 after completion never moves progress backwards.
  await call('saveStore', store);
  assert.equal(user.onboarding_step, 3);
  console.log('PASS step 2 saved to onboarding_profiles/objectives and completes onboarding');

  // Tenancy: members and viewers cannot rewrite the workspace; no membership is 403.
  reset(); membership.role = 'member';
  res = await call('saveStore', store);
  assert.equal(res.statusCode, 403);
  res = await call('saveGoals', { goals: ['priorities'] });
  assert.equal(res.statusCode, 403);
  membership = null;
  res = await call('getOnboarding');
  assert.equal(res.statusCode, 403);
  assert.equal(writes.length, 0);
  console.log('PASS only the owner or an admin of the active workspace can save');

  console.log('onboarding.save.test.js: all assertions passed');
})().catch((error) => { console.error(error); process.exit(1); });
