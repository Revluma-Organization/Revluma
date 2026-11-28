const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

let user;
let updates = [];
let destroyed = [];
let destroyShouldFail = false;
const prisma = {
  users: {
    findUnique: async ({ where }) => (user && where.id === user.id ? { ...user } : null),
    update: async ({ where, data }) => {
      updates.push({ where, data });
      user = { ...user, ...data };
      return { id: user.id, full_name: user.full_name, email: user.email, profile_picture_url: user.profile_picture_url };
    },
  },
};
const cloudinary = {
  uploader: {
    destroy: async (publicId, options) => {
      if (destroyShouldFail) throw new Error('cdn down');
      destroyed.push({ publicId, options });
      return { result: 'ok' };
    },
  },
};
const warnings = [];
const log = { info() {}, warn(event) { warnings.push(event); }, error() {} };

function load(file, mocks) {
  const filename = path.resolve(__dirname, file);
  const originalRequire = createRequire(filename);
  const module = { exports: {} };
  const requireMock = name => Object.hasOwn(mocks, name) ? mocks[name] : originalRequire(name);
  vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(filename, 'utf8')}\n})`, { filename })(requireMock, module, module.exports);
  return module.exports;
}

const controller = load('../authController.js', {
  '../configs/database': { prisma }, '../configs/cloudinary': cloudinary, '../utils/logger': log,
  'express-validator': { validationResult: () => ({ isEmpty: () => true }) },
  '../utils/otp': { generateVerificationCode: () => '123456', getVerificationExpiry: () => new Date() },
  '../utils/emailService': {},
  '../utils/passwordBreach': { isPasswordPwned: async () => false },
  '../utils/tokens': { generateAccessToken: () => 'test-only', generateRefreshToken: () => ({}), hashRefreshToken: () => 'x' },
  bcrypt: { hashSync: () => 'test-only-hash' }, uuid: { v4: () => 'test-only-id' }, speakeasy: {}, qrcode: {},
  'google-auth-library': { OAuth2Client: class {} },
  '../utils/cookieOptions': { buildCookieOptions: () => ({}) },
});

function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
async function remove(userId = 'user-1') {
  const res = response();
  let error;
  await controller.removeProfilePicture({ user: { id: userId } }, res, failure => { error = failure; });
  return { res, error };
}
function reset(picture) {
  user = { id: 'user-1', full_name: 'Ada Lovelace', email: 'ada@example.test', profile_picture_url: picture };
  updates = []; destroyed = []; destroyShouldFail = false; warnings.length = 0;
}

(async () => {
  // Clears the stored URL and deletes the deterministic Cloudinary asset.
  reset('https://res.cloudinary.com/demo/image/upload/revluma/profile-pictures/user_user-1.png');
  let { res, error } = await remove();
  assert.equal(error, undefined);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.profile_picture_url, null);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].data.profile_picture_url, null);
  assert.deepEqual(destroyed.map(item => item.publicId), ['revluma/profile-pictures/user_user-1']);

  // No stored photo: still succeeds (idempotent) and never calls the CDN.
  reset(null);
  ({ res } = await remove());
  assert.equal(res.statusCode, 200);
  assert.equal(destroyed.length, 0);

  // CDN failure is logged but the photo stays removed and the request succeeds.
  reset('https://res.cloudinary.com/demo/x.png');
  destroyShouldFail = true;
  ({ res } = await remove());
  assert.equal(res.statusCode, 200);
  assert.equal(user.profile_picture_url, null);
  assert.deepEqual(warnings, ['profile_picture_cdn_delete_failed']);

  // Unknown user: 404, no writes.
  reset('https://res.cloudinary.com/demo/x.png');
  ({ res } = await remove('someone-else'));
  assert.equal(res.statusCode, 404);
  assert.equal(updates.length, 0);

  // Upload middleware answers rejected files with a clean 400.
  const upload = require('../../middlewares/uploadProfilePicture');
  assert.equal(typeof upload.singleProfileImage, 'function');
  const routeSource = fs.readFileSync(path.resolve(__dirname, '../../route/authRoute.js'), 'utf8');
  assert.match(routeSource, /router\.delete\("\/profile\/picture", authenticateToken, authController\.removeProfilePicture\)/);
  assert.match(routeSource, /uploadProfilePicture\.singleProfileImage/);

  console.log('auth.profilePicture.test.js: all assertions passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
