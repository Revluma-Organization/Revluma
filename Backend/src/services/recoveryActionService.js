const { prisma } = require('../configs/database');

const DEFAULT_POLICY = Object.freeze({
  enabled: false,
  allowed_actions: [],
  allowed_channels: [],
  max_discount_pct: 0,
  max_messages_per_customer_24h: 0,
  max_actions_per_store_24h: 0,
  kill_switch: true,
});

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum
    ? number
    : fallback;
}

function normalizePolicy(settings) {
  const value = settings && typeof settings === 'object' && !Array.isArray(settings)
    ? settings
    : {};
  return {
    enabled: value.enabled === true,
    allowed_actions: Array.isArray(value.allowed_actions) ? value.allowed_actions.filter((item) => typeof item === 'string') : [],
    allowed_channels: Array.isArray(value.allowed_channels) ? value.allowed_channels.filter((item) => typeof item === 'string') : [],
    max_discount_pct: boundedInteger(value.max_discount_pct, 0, 0, 25),
    max_messages_per_customer_24h: boundedInteger(value.max_messages_per_customer_24h, 0, 0, 10),
    max_actions_per_store_24h: boundedInteger(value.max_actions_per_store_24h, 0, 0, 1000),
    kill_switch: value.kill_switch !== false,
  };
}

async function getBetaPolicy(storeId) {
  const row = await prisma.store_settings.findUnique({
    where: { store_id_settings_group: { store_id: storeId, settings_group: 'beta_automation' } },
  });
  return row ? normalizePolicy(row.settings) : { ...DEFAULT_POLICY };
}

// Legacy settings and environment flags cannot authorize customer messaging.
function automationPermitted() { return false; }

function timingPolicyGroup(actionKey) {
  return parseInt(actionKey.slice(0, 8), 16) % 5 === 0 ? 'control' : 'candidate';
}

// Preserve existing queued records; do not claim, mutate or send them.
async function enqueueRecoveryAction() { return { queued: false, reason: 'read_only_mvp' }; }

function safeRecoveryUrl(store, cart) {
  try {
    const candidate = new URL(cart.recovery_url);
    const expectedHost = String(store.shop_domain || '').trim().toLowerCase();
    const isShopDomain = candidate.hostname.toLowerCase() === expectedHost;
    const isShopifyRecoveryPath = candidate.pathname.includes('/checkouts/') &&
      candidate.pathname.endsWith('/recover') && candidate.searchParams.has('key');
    return candidate.protocol === 'https:' && (isShopDomain || isShopifyRecoveryPath)
      ? candidate.toString()
      : null;
  } catch {
    return null;
  }
}

async function processRecoverySend() { return { sent: false, reason: 'read_only_mvp' }; }
async function runRecoveryActions() {
  // This is internal lifecycle bookkeeping, not a merchant action. Preserve
  // the existing inactivity transition independently of disabled messaging.
  await prisma.abandoned_carts.updateMany({
    where: { status: 'pending', recovered_at: null, updated_at: { lte: new Date(Date.now() - 15 * 60 * 1000) } },
    data: { status: 'abandoned' },
  });
  return { processed: 0, failed: 0, disabled: true, reason: 'read_only_mvp' };
}

module.exports = {
  DEFAULT_POLICY,
  automationPermitted,
  enqueueRecoveryAction,
  getBetaPolicy,
  normalizePolicy,
  processRecoverySend,
  runRecoveryActions,
  safeRecoveryUrl,
  timingPolicyGroup,
};
