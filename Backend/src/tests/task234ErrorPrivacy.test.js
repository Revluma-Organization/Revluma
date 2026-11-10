'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const loggerPath = require.resolve('../utils/logger');
const logs = [];
require.cache[loggerPath] = { id: loggerPath, filename: loggerPath, loaded: true, exports: { error: (...args) => logs.push(args) } };
const handler = require('../middlewares/globalHandler');
test('production errors suppress exception and stack even if legacy debug flag is enabled', () => {
  const env = { ...process.env }; process.env.NODE_ENV = 'production'; process.env.EXPOSE_ERROR_DETAILS = 'true';
  try {
    const secret = 'fixture-private-provider-value'; const error = Object.assign(new Error(secret), { statusCode: 503, stack: secret });
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    handler(error, { method: 'POST', route: { path: '/test' }, baseUrl: '', user: null }, res, () => {});
    assert.equal(res.code, 503); assert.equal(res.body.error, 'An unexpected server error occurred');
    assert.equal(JSON.stringify({body:res.body,logs}).includes(secret), false);
  } finally { process.env.NODE_ENV = env.NODE_ENV; if (env.EXPOSE_ERROR_DETAILS === undefined) delete process.env.EXPOSE_ERROR_DETAILS; else process.env.EXPOSE_ERROR_DETAILS = env.EXPOSE_ERROR_DETAILS; }
});
