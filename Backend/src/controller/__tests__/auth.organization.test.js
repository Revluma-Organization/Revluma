const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const context = require('../../utils/organizationContext');

let user;
let memberships = [];
let issuedTenant;
let createdMemberships = 0;
const makeUser = () => ({ id: 'user', email: 'owner@example.test', full_name: 'Test Owner', password_hash: 'test-only', email_verified: true, status: 'active', google_id: 'google-sub', onboarding_completed: true });
const member = (organization_id, role, status = 'active') => ({ id: `membership-${organization_id}`, user_id: 'user', organization_id, role, status, joined_at: null, organizations: { id: organization_id, company_name: organization_id } });
const prisma = {
  organization_members: {
    findMany: async query => {
      assert.equal(query.where.user_id, 'user');
      assert.equal(query.where.status, 'active');
      return memberships.filter(item => item.status === 'active');
    },
    create: async ({ data }) => { createdMemberships++; const row = member(data.organization_id, data.role, data.status); memberships.push(row); return row; },
  },
  users: {
    findFirst: async () => user || null,
    findUnique: async () => user && { ...user, organization_members: memberships.filter(item => item.status === 'active'), organizations: [{ id: 'unrelated-owned-organisation' }] },
    create: async ({ data }) => (user = { ...makeUser(), ...data }),
  },
  organizations: { create: async () => ({ id: 'new-org' }) },
  login_attempts: { count: async () => 0, create: async () => ({}) },
  refresh_tokens: {
    findUnique: async () => ({ id: 'session', user_id: 'user', expires_at: new Date(Date.now() + 60000), family_id: 'family' }),
    create: async () => ({ id: 'session' }), updateMany: async () => ({ count: 1 }),
  },
  $transaction: async operation => operation(prisma),
};
function load(file, mocks) {
  const filename = path.resolve(__dirname, file);
  const originalRequire = createRequire(filename);
  const module = { exports: {} };
  const requireMock = name => Object.hasOwn(mocks, name) ? mocks[name] : originalRequire(name);
  vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(filename, 'utf8')}\n})`, { filename })(requireMock, module, module.exports);
  return module.exports;
}
const log = { info() {}, warn() {}, error() {} };
const controller = load('../authController.js', {
  '../configs/database': { prisma }, '../configs/cloudinary': {}, '../utils/logger': log,
  '../utils/organizationContext': context,
  'express-validator': { validationResult: () => ({ isEmpty: () => true }) },
  '../utils/otp': { generateVerificationCode: () => '123456', getVerificationExpiry: () => new Date() },
  '../utils/emailService': { sendVerificationEmail: async () => ({ success: true }) },
  '../utils/passwordBreach': { isPasswordPwned: async () => false },
  '../utils/tokens': {
    generateAccessToken: claims => { issuedTenant = claims.tenantId; return 'test-only-access-token'; },
    generateRefreshToken: () => ({ raw: 'test-only-refresh', hash: 'test-only-hash', expiresAt: new Date(Date.now() + 60000) }),
    hashRefreshToken: () => 'test-only-hash',
  },
  bcrypt: { hashSync: () => 'test-only-hash', hash: async () => 'test-only-hash', compare: async () => true },
  uuid: { v4: () => 'test-only-id' }, speakeasy: {}, qrcode: {},
  'google-auth-library': { OAuth2Client: class { async verifyIdToken() { return { getPayload: () => ({ sub: 'google-sub', email: 'owner@example.test', email_verified: true }) }; } } },
  '../utils/cookieOptions': { buildCookieOptions: () => ({}) },
});
const middleware = load('../../middlewares/orgAuth.js', { '../configs/database': { prisma } });
function response() { return { statusCode: 200, body: null, cookie() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }
async function call(method, organizationId) {
  const req = { headers: {}, user: { id: 'user', tenantId: organizationId }, body: { account: { email: 'owner@example.test', password: 'A-valid-Password1!' }, credential: 'test-credential', refresh_token: 'test-only-refresh', ...(organizationId ? { organization_id: organizationId } : {}) } };
  const res = response();
  let error;
  await controller[method](req, res, failure => { error = failure; });
  return { req, res, error };
}

(async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-only-client-id';
  const cases = [
    ['Existing owner', [member('A', 'owner')], 'A', 'owner'],
    ['Owner of multiple organisations selects B', [member('A', 'owner'), member('B', 'owner')], 'B', 'owner'],
    ['Owner in A, Member in B', [member('A', 'owner'), member('B', 'member')], 'B', 'member'],
    ['Admin', [member('A', 'admin')], 'A', 'admin'],
    ['Member', [member('A', 'member')], 'A', 'member'],
    ['Viewer', [member('A', 'viewer')], 'A', 'viewer'],
  ];
  for (const [label, rows, selected, role] of cases) {
    user = makeUser(); memberships = rows; const before = createdMemberships;
    for (const method of ['login', 'googleLogin', 'getProfile', 'refresh', 'selectWorkspace']) {
      const { res, error } = await call(method, selected);
      assert.ifError(error); assert.equal(res.statusCode, 200, `${label}: ${method}`);
      const data = res.body.data;
      const resolved = ['login', 'googleLogin'].includes(method) ? data.user : data;
      assert.equal(resolved.role, role, `${label}: ${method} role`);
      assert.equal(resolved.active_organization_id, selected);
      if (method !== 'getProfile') assert.equal(issuedTenant, selected);
    }
    const req = { user: { id: 'user', tenantId: selected } }; let nextError;
    await middleware.attachOrgMembership(req, response(), error => { nextError = error; });
    assert.ifError(nextError); assert.equal(req.orgMembership.role, role);
    const res = response(); let allowed = false;
    middleware.requireRole('owner', 'admin')(req, res, () => { allowed = true; });
    assert.equal(allowed, role === 'owner' || role === 'admin');
    assert.equal(createdMemberships, before, 'Existing accounts must never be promoted or repaired automatically.');
    console.log(`PASS ${label}: password, Google, /me, refresh, selection and middleware`);
  }
  user = makeUser(); memberships = [member('A', 'owner'), member('B', 'member')];
  for (const method of ['login', 'googleLogin', 'getProfile', 'refresh']) {
    const { res, error } = await call(method);
    assert.ifError(error);
    const data = ['login', 'googleLogin'].includes(method) ? res.body.data.user : res.body.data;
    assert.equal(data.active_organization_id, null); assert.equal(data.role, 'unknown');
  }
  console.log('PASS ambiguous multi-organisation sessions require selection; no first-membership fallback');
  for (const rows of [[], [member('A', 'owner', 'inactive')], [member('A', 'owner', 'expired')]]) {
    memberships = rows;
    for (const method of ['login', 'googleLogin', 'refresh', 'selectWorkspace']) {
      const { error } = await call(method, 'A'); assert.equal(error?.statusCode, 403);
    }
    const { res } = await call('getProfile', 'A'); assert.equal(res.statusCode, 403);
    const req = { user: { id: 'user', tenantId: 'A' } }; let denied;
    await middleware.attachOrgMembership(req, response(), error => { denied = error; });
    assert.equal(denied?.statusCode, 403);
  }
  console.log('PASS inactive/expired/missing membership denies context, including legacy ownership-only accounts');
  user = null; memberships = [];
  const res = response(); let failure;
  await controller.register({ headers: {}, body: { account: { firstName: 'New', lastName: 'Owner', email: 'owner@example.test', password: 'NewPassword123!', termsAgreed: true }, storeSetup: { brand_name: 'Test store', storeCategory: 'General', country: 'NG' } } }, res, error => { failure = error; });
  assert.ifError(failure); assert.equal(res.statusCode, 201); assert.equal(memberships[0].role, 'owner');
  user.email_verified = true;
  const session = await call('login'); assert.ifError(session.error); assert.equal(session.res.body.data.user.role, 'owner');
  console.log('PASS newly registered owner uses the same resolver as existing accounts');
  user = null; memberships = [];
  const googleRes = response(); let googleFailure;
  await controller.googleLogin({ headers: {}, body: { credential: 'test-credential', terms_agreed: true, organization: { company_name: 'New Google Workspace' } } }, googleRes, error => { googleFailure = error; });
  assert.ifError(googleFailure); assert.equal(googleRes.statusCode, 200);
  assert.equal(googleRes.body.data.user.role, 'owner'); assert.equal(memberships.length, 1);
  console.log('PASS newly registered Google owner creates its own membership and uses the shared resolver');
  console.log('auth.organization.test.js: all assertions passed; mocked persistence only');
})().catch(error => { console.error(error); process.exitCode = 1; });
