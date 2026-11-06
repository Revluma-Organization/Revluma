'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

function cache(path, exports) {
  const resolved = require.resolve(path);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const authenticateToken = (req, res, next) => next();
const attachOrgMembership = (req, res, next) => next();
const privileged = (req, res, next) => next();
const noop = () => {};
cache('../middlewares/authMiddleware', { authenticateToken });
cache('../middlewares/orgAuth', { attachOrgMembership, requireRole: (...roles) => { assert.deepEqual(roles, ['owner', 'admin']); return privileged; } });
cache('../controller/commerceActionController', { createPreview: noop, confirm: noop, rollback: noop, reconcile: noop, get: noop, list: noop });
cache('../controller/merchantCapabilityController', { coverage: noop, collections: noop, sidekickFoundation: noop });

test('all commerce mutations require owner/admin after authentication and tenant membership', () => {
  const router = require('../route/commerceActionRoute');
  for (const [path, method] of [['/preview', 'post'], ['/:id/confirm', 'post'], ['/:id/rollback', 'post'], ['/:id/reconcile', 'post']]) {
    const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
    assert.ok(layer, `${method} ${path} exists`);
    assert.equal(layer.route.stack[0].handle, privileged, `${path} applies role guard before controller`);
  }
  const globalMiddleware = router.stack.filter(item => !item.route).map(item => item.handle);
  assert.ok(globalMiddleware.includes(authenticateToken));
  assert.ok(globalMiddleware.includes(attachOrgMembership));
});

test('capability reads require authentication and tenant membership', () => {
  const router = require('../route/merchantCapabilityRoute');
  const globalMiddleware = router.stack.filter(item => !item.route).map(item => item.handle);
  assert.deepEqual(globalMiddleware, [authenticateToken, attachOrgMembership]);
  for (const path of ['/sidekick/extension-foundation', '/shopify/stores/:storeId/capabilities', '/shopify/stores/:storeId/collections']) {
    assert.ok(router.stack.some(item => item.route?.path === path && item.route.methods.get), `${path} exists`);
  }
});
