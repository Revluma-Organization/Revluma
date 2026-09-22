const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

process.env.PYTHON_SERVICE_URL = 'https://python.test';
process.env.ML_INTERNAL_KEY = 'test-internal-key';
process.env.PYTHON_ALLOWED_MODEL_STATUSES = 'beta_ready';
process.env.BETA_AUTOMATION_KILL_SWITCH = 'false';

const axios = require('axios');
const mlService = require('../mlService');
const { normalizePolicy, automationPermitted, safeRecoveryUrl } = require('../recoveryActionService');
const { verifySendGridSignature } = require('../messageWebhookService');
const { toPythonEvent, FEATURE_FIELDS } = require('../featureWorkerService');

(async () => {
  const originalGet = axios.get;
  axios.get = async () => ({
    status: 200,
    data: {
      status: 'ok',
      model_status: 'beta_ready',
      models_ready: true,
      models_missing: [],
      model_channels: { abandonment: 'beta' },
    },
  });
  const health = await mlService.checkPythonHealth();
  assert.strictEqual(health.healthy, true, 'beta-ready Python health should be accepted when allowlisted');
  assert.strictEqual(health.modelStatus, 'beta_ready');

  axios.get = async () => ({
    status: 200,
    data: { status: 'ok', model_status: 'partial_fallback', models_ready: false, models_missing: ['send_time'] },
  });
  const unhealthy = await mlService.checkPythonHealth();
  assert.strictEqual(unhealthy.healthy, false, 'HTTP 200 must not hide missing models');
  axios.get = originalGet;

  const policy = normalizePolicy({
    enabled: true,
    allowed_actions: ['cart_recovery_message', 'percentage_discount'],
    allowed_channels: ['email'],
    max_discount_pct: 10,
    max_messages_per_customer_24h: 1,
    max_actions_per_store_24h: 100,
    kill_switch: false,
  });
  assert.strictEqual(automationPermitted(policy, { consent_email: true }, 10), true);
  assert.strictEqual(automationPermitted(policy, { consent_email: false }, 10), false);
  delete process.env.BETA_AUTOMATION_KILL_SWITCH;
  assert.strictEqual(
    automationPermitted(policy, { consent_email: true }, 10),
    false,
    'automation must remain disabled unless the global gate is explicitly opened'
  );
  process.env.BETA_AUTOMATION_KILL_SWITCH = 'false';

  const store = { shop_domain: 'example-store.myshopify.com' };
  assert.strictEqual(
    safeRecoveryUrl(store, { recovery_url: 'https://shop.example/checkouts/ac/token/recover?key=secret' }),
    'https://shop.example/checkouts/ac/token/recover?key=secret'
  );
  assert.strictEqual(
    safeRecoveryUrl(store, { recovery_url: 'https://attacker.test/login?key=secret' }),
    null
  );

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const body = Buffer.from('[{"event":"delivered"}]');
  const timestamp = '1758535200';
  const signature = crypto.sign(
    'sha256',
    Buffer.concat([Buffer.from(timestamp), body]),
    privateKey
  ).toString('base64');
  const exportedKey = publicKey.export({ type: 'spki', format: 'pem' });
  assert.strictEqual(verifySendGridSignature(body, signature, timestamp, exportedKey), true);
  assert.strictEqual(verifySendGridSignature(Buffer.from('changed'), signature, timestamp, exportedKey), false);

  const event = toPythonEvent({
    id: 'event-db-id',
    source_event_id: 'event-source-id',
    event_type: 'PAGE_VIEW',
    session_id: 'session-1',
    customer_id: null,
    anonymous_id: 'anonymous-1',
    created_at: new Date('2026-09-22T10:00:00Z'),
    payload: { platform: 'shopify', page_url: '/products/1', referrer: 'https://example.test' },
  }, 'store-1');
  assert.strictEqual(event.timestamp, '2026-09-22T10:00:00.000Z');
  assert.strictEqual(event.store_id, 'store-1');
  assert.strictEqual(event.page.referrer, 'https://example.test');
  assert.strictEqual(FEATURE_FIELDS.length, 34);

  const mlSource = fs.readFileSync(path.join(__dirname, '..', 'mlService.js'), 'utf8');
  for (const endpoint of [
    '/internal/features/compute',
    '/predict/abandonment-probability',
    '/predict/shopper-sensitivity',
    '/predict/offer-value',
    '/predict/send-time',
    '/predict/churn-risk',
  ]) {
    assert.ok(mlSource.includes(endpoint), `ML gateway must include ${endpoint}`);
  }

  console.log('intelligence.contract.test.js: all assertions passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
