// Sign in with Apple: real RS256 tokens signed by a throwaway key, served from
// a local JWKS endpoint, verified by utils/appleIdentity and driven through the
// auth controller with mocked persistence. No network, no database.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const jwt = require('jsonwebtoken');

const CLIENT_ID = 'com.revluma.web.test';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const { privateKey: strangerKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'test-kid-1';
let jwksHits = 0;

const server = http.createServer((req, res) => {
  jwksHits++;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'RS256' }] }));
});

const RAW_NONCE = 'raw-nonce-0123456789abcdef';
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
function token(claims = {}, { key = privateKey, kid = KID, expiresIn = 300 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({
    iss: 'https://appleid.apple.com', aud: CLIENT_ID, iat: now, sub: 'apple-sub-1',
    email: 'merchant@example.test', email_verified: 'true', nonce: sha(RAW_NONCE), ...claims,
  }, key, { algorithm: 'RS256', keyid: kid, expiresIn });
}

// ── Mocked persistence ───────────────────────────────────────────────────────
let users = [];
let organisations = [];
let memberships = [];
const prisma = {
  users: {
    findUnique: async ({ where }) => users.find((u) => (where.id && u.id === where.id) || (where.apple_id && u.apple_id === where.apple_id) || (where.email && u.email === where.email)) || null,
    findFirst: async ({ where }) => users.find((u) => u.email.toLowerCase() === String(where.email.equals).toLowerCase()) || null,
    create: async ({ data }) => { const row = { id: `user-${users.length + 1}`, status: 'active', ...data }; users.push(row); return row; },
    update: async ({ where, data }) => { const row = users.find((u) => u.id === where.id); Object.assign(row, data); return row; },
  },
  organizations: { create: async ({ data }) => { const row = { id: `org-${organisations.length + 1}`, ...data }; organisations.push(row); return row; } },
  organization_members: {
    create: async ({ data }) => { memberships.push(data); return data; },
    findMany: async ({ where }) => memberships.filter((m) => m.user_id === where.user_id && m.status === 'active').map((m) => ({ id: 'm', ...m })),
  },
  refresh_tokens: { create: async () => ({ id: 'session' }) },
  $transaction: async (operation) => operation(prisma),
};
function load(file, mocks) {
  const filename = path.resolve(__dirname, file);
  const originalRequire = createRequire(filename);
  const module = { exports: {} };
  const requireMock = (name) => (Object.hasOwn(mocks, name) ? mocks[name] : originalRequire(name));
  vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(filename, 'utf8')}\n})`, { filename })(requireMock, module, module.exports);
  return module.exports;
}
const log = { info() {}, warn() {}, error() {} };
const apple = require('../../utils/appleIdentity');
const controller = load('../authController.js', {
  '../configs/database': { prisma }, '../configs/cloudinary': {}, '../utils/logger': log,
  'express-validator': { validationResult: () => ({ isEmpty: () => true }) },
  '../utils/emailService': { sendVerificationEmail: async () => ({ success: true }) },
  '../utils/passwordBreach': { isPasswordPwned: async () => false },
  '../utils/tokens': {
    generateAccessToken: () => 'test-only-access-token',
    generateRefreshToken: () => ({ raw: 'test-only-refresh', hash: 'test-only-hash', expiresAt: new Date(Date.now() + 60000) }),
    hashRefreshToken: () => 'test-only-hash',
  },
  '../utils/cookieOptions': { buildCookieOptions: () => ({}) },
  '../utils/appleIdentity': apple,
});
function response() { return { statusCode: 200, body: null, headers: {}, set(k, v) { this.headers[k] = v; return this; }, cookie() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }
async function call(method, body, user) {
  const res = response(); let error;
  await controller[method]({ headers: {}, body, user }, res, (failure) => { error = failure; });
  if (error) throw error;
  return res;
}
async function rejects(promise, status, pattern) {
  await assert.rejects(promise, (error) => { assert.equal(error.statusCode, status); if (pattern) assert.match(error.message, pattern); return true; });
}

server.listen(0, '127.0.0.1', async () => {
  try {
    // ── Not configured: 503, and the pages hide the button.
    delete process.env.APPLE_CLIENT_ID;
    assert.deepEqual(apple.appleWebConfig(), { enabled: false });
    let res = await call('appleLogin', { id_token: token(), nonce: RAW_NONCE, terms_agreed: true });
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, 'APPLE_NOT_CONFIGURED');
    console.log('PASS Apple disabled until APPLE_CLIENT_ID is set');

    process.env.APPLE_CLIENT_ID = CLIENT_ID;
    process.env.APPLE_JWKS_URL = `http://127.0.0.1:${server.address().port}/auth/keys`;
    process.env.FRONTEND_URL = 'https://revluma.vercel.app';
    apple.resetAppleKeyCache();
    assert.deepEqual(apple.appleWebConfig(), { enabled: true, client_id: CLIENT_ID, redirect_uri: 'https://revluma.vercel.app/auth/login', scope: 'name email' });
    res = await call('appleConfig', {});
    assert.equal(res.body.data.client_id, CLIENT_ID);

    // ── Token verification.
    const ok = await apple.verifyAppleIdentityToken(token(), RAW_NONCE);
    assert.deepEqual(ok, { sub: 'apple-sub-1', email: 'merchant@example.test', isPrivateEmail: false });
    await rejects(apple.verifyAppleIdentityToken(token({}, { key: strangerKey }), RAW_NONCE), 401);
    await rejects(apple.verifyAppleIdentityToken(token({ aud: 'com.someone.else' }), RAW_NONCE), 401);
    await rejects(apple.verifyAppleIdentityToken(token({ iss: 'https://evil.example' }), RAW_NONCE), 401);
    await rejects(apple.verifyAppleIdentityToken(token({}, { expiresIn: -120 }), RAW_NONCE), 401, /expired/);
    await rejects(apple.verifyAppleIdentityToken(token(), 'a-different-nonce-value'), 401, /could not be confirmed/);
    await rejects(apple.verifyAppleIdentityToken(token({ nonce: RAW_NONCE }), RAW_NONCE), 401, /could not be confirmed/);
    await rejects(apple.verifyAppleIdentityToken(token({ email_verified: 'false' }), RAW_NONCE), 401, /not verified/);
    await rejects(apple.verifyAppleIdentityToken(token(), ''), 400);
    await rejects(apple.verifyAppleIdentityToken('not-a-token', RAW_NONCE), 400);
    const hs = jwt.sign({ iss: 'https://appleid.apple.com', aud: CLIENT_ID, sub: 'x', nonce: sha(RAW_NONCE) }, 'shared-secret', { keyid: KID });
    await rejects(apple.verifyAppleIdentityToken(hs, RAW_NONCE), 401);
    const before = jwksHits;
    await rejects(apple.verifyAppleIdentityToken(token({}, { kid: 'unknown-kid' }), RAW_NONCE), 401);
    await rejects(apple.verifyAppleIdentityToken(token({}, { kid: 'unknown-kid' }), RAW_NONCE), 401);
    assert.ok(jwksHits - before <= 1, 'unknown key ids must not hammer Apple');
    const relay = await apple.verifyAppleIdentityToken(token({ email: 'Abc123@privaterelay.appleid.com', is_private_email: true }), RAW_NONCE);
    assert.equal(relay.email, 'abc123@privaterelay.appleid.com');
    assert.equal(relay.isPrivateEmail, true);
    console.log('PASS identity token: signature, issuer, audience, expiry, nonce, email_verified, alg pinning, key cache');

    // ── New account: terms are required, the name arrives only the first time.
    res = await call('appleLogin', { id_token: token(), nonce: RAW_NONCE });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'TERMS_REQUIRED');
    assert.equal(users.length, 0);
    res = await call('appleLogin', { id_token: token(), nonce: RAW_NONCE, terms_agreed: true, user: { name: { firstName: 'Ada', lastName: '<b>Obi</b>' } } });
    assert.equal(res.statusCode, 200);
    assert.equal(users.length, 1);
    assert.equal(users[0].apple_id, 'apple-sub-1');
    assert.equal(users[0].full_name, 'Ada bObi/b');
    assert.equal(users[0].email_verified, true);
    assert.equal(users[0].password_hash, null);
    assert.equal(users[0].onboarding_completed, false);
    assert.equal(organisations[0].company_name, "Ada's store");
    assert.equal(organisations[0].country, 'Unspecified');
    assert.equal(organisations[0].store_url, null);
    assert.equal(memberships[0].role, 'owner');
    assert.equal(res.body.data.user.role, 'owner');
    console.log('PASS new Apple account: user, provisional workspace and owner membership');

    // ── Returning: matched by Apple subject even without an email claim.
    res = await call('appleLogin', { id_token: token({ email: undefined, email_verified: undefined }), nonce: RAW_NONCE });
    assert.equal(res.statusCode, 200);
    assert.equal(users.length, 1);
    console.log('PASS returning Apple user signs in by subject');

    // ── Private relay sign-up gets a neutral name, not the relay mailbox.
    res = await call('appleLogin', { id_token: token({ sub: 'apple-sub-2', email: 'x7k2@privaterelay.appleid.com', is_private_email: 'true' }), nonce: RAW_NONCE, terms_agreed: true });
    assert.equal(res.statusCode, 200);
    assert.equal(users[1].full_name, 'Revluma merchant');
    assert.equal(organisations[1].company_name, 'My store');
    console.log('PASS Hide My Email sign-up');

    // ── No email on a first sign-in cannot create an account.
    res = await call('appleLogin', { id_token: token({ sub: 'apple-sub-3', email: undefined, email_verified: undefined }), nonce: RAW_NONCE, terms_agreed: true });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'APPLE_EMAIL_REQUIRED');

    // ── Existing password account: linking requires a signed-in session.
    users.push({ id: 'pw-user', email: 'owner@example.test', status: 'active', password_hash: 'hash', apple_id: null });
    memberships.push({ user_id: 'pw-user', organization_id: 'org-pw', role: 'owner', status: 'active' });
    const ownerToken = () => token({ sub: 'apple-sub-owner', email: 'Owner@Example.test' });
    res = await call('appleLogin', { id_token: ownerToken(), nonce: RAW_NONCE, terms_agreed: true });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'APPLE_ACCOUNT_LINK_REQUIRED');
    assert.equal(users.find((u) => u.id === 'pw-user').apple_id, null);
    res = await call('linkAppleAccount', { id_token: token({ sub: 'apple-sub-owner', email: 'someone@else.test' }), nonce: RAW_NONCE }, { id: 'pw-user' });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'APPLE_EMAIL_MISMATCH');
    res = await call('linkAppleAccount', { id_token: token({ sub: 'apple-sub-1', email: 'owner@example.test' }), nonce: RAW_NONCE }, { id: 'pw-user' });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'APPLE_ACCOUNT_CONFLICT');
    res = await call('linkAppleAccount', { id_token: ownerToken(), nonce: RAW_NONCE }, { id: 'pw-user' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.apple_linked, true);
    assert.equal(users.find((u) => u.id === 'pw-user').apple_id, 'apple-sub-owner');
    res = await call('appleLogin', { id_token: ownerToken(), nonce: RAW_NONCE });
    assert.equal(res.statusCode, 200);
    console.log('PASS existing account: link required, email must match, no double linking, then Apple sign-in works');

    // ── Suspended accounts stay out.
    users[0].status = 'suspended';
    res = await call('appleLogin', { id_token: token(), nonce: RAW_NONCE });
    assert.equal(res.statusCode, 403);

    // ── Bad credentials are rejected before any lookup.
    res = await call('appleLogin', { id_token: token({ aud: 'nope' }), nonce: RAW_NONCE, terms_agreed: true });
    assert.equal(res.statusCode, 401);

    console.log('auth.apple.test.js: all assertions passed');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
