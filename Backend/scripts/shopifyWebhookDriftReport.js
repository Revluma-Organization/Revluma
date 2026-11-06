'use strict';
/**
 * Operator-run, READ-ONLY Shopify webhook drift report.
 *
 * Lists the LIVE subscriptions of one store through the authorized
 * installation and diffs them against REQUIRED_SUBSCRIPTIONS. This script
 * never creates, updates or deletes anything — locally or at Shopify. It
 * exists so an operator can see the exact remote state before approving any
 * remediation (duplicate cleanup, products-topic registration).
 *
 * Usage:
 *   node scripts/shopifyWebhookDriftReport.js --store <store-uuid-or-myshopify-domain>
 *
 * Environment: DATABASE_URL (or repo .env), SHOPIFY_TOKEN_ENCRYPTION_KEY,
 * BACKEND_URL (expected delivery base, e.g. https://revluma-backend-vrsd.onrender.com).
 *
 * Exit codes: 0 = no drift; 1 = drift detected; 2 = configuration/access failure.
 */
const { prisma } = require('../configs/database');
const { shopifyGraphql } = require('../services/shopifyGraphql');
const { diffSubscriptions } = require('../services/shopifyWebhookDrift');

async function main() {
  const argIndex = process.argv.indexOf('--store');
  const storeRef = argIndex > -1 ? String(process.argv[argIndex + 1] || '').trim() : '';
  const expectedBase = String(process.env.BACKEND_URL || '').replace(/\/+$/, '');
  if (!storeRef || !/^https:\/\//.test(expectedBase)) {
    console.error('Usage: node scripts/shopifyWebhookDriftReport.js --store <uuid|domain>  (requires BACKEND_URL=https://…)');
    process.exit(2);
  }
  const store = await prisma.stores.findFirst({
    where: /^[0-9a-f-]{36}$/i.test(storeRef)
      ? { id: storeRef }
      : { shop_domain: storeRef.toLowerCase() },
    select: { id: true, platform: true, shop_domain: true, status: true, access_token: true },
  });
  if (!store) {
    console.error('Store not found');
    process.exit(2);
  }
  if (store.platform !== 'shopify') {
    console.error('Store is not a Shopify store');
    process.exit(2);
  }
  const data = await shopifyGraphql(store, `query WebhookSubscriptions {
    webhookSubscriptions(first: 250) { nodes { id topic uri } }
  }`);
  const remote = Array.isArray(data?.webhookSubscriptions?.nodes) ? data.webhookSubscriptions.nodes : [];
  const report = diffSubscriptions(remote, expectedBase);
  // Never print access tokens, ciphertext, or payload values.
  console.log(JSON.stringify({
    store_id: store.id,
    shop_domain: store.shop_domain,
    store_status: store.status,
    expected_base_url: expectedBase,
    ...report,
  }, null, 2));
  process.exit(report.drift ? 1 : 0);
}

main().catch((error) => {
  console.error(JSON.stringify({ error: error.code || error.name || 'drift_report_failed' }));
  process.exit(2);
});
