#!/usr/bin/env node
/**
 * Re-encrypt stored Shopify access tokens from legacy AES-256-CBC to v2 AES-256-GCM.
 *
 * DRY-RUN BY DEFAULT: prints how many rows would be migrated (counts and store
 * ids only — never tokens, never plaintext). `--apply` additionally requires
 *   REVLUMA_REKEY_CONFIRM=REENCRYPT-ALL-SHOPIFY-TOKENS
 *
 * Safety properties:
 *   * Rows already in v2 format are skipped.
 *   * Rows whose format cannot be classified are reported and skipped (never
 *     "helpfully" overwritten).
 *   * Decrypt failure for one store does NOT stop the batch; the store is
 *     reported as `decrypt_failed` and left untouched.
 *   * The update writes exactly one row per store and never logs token material.
 *   * Reversible until the first apply: v1 ciphertexts are only replaced after
 *     a successful v2 re-encryption of the same value.
 *
 * Usage:
 *   node scripts/reencryptStoreTokens.js            # dry-run
 *   node scripts/reencryptStoreTokens.js --apply    # requires the confirmation env
 */
'use strict';
const { encrypt, decrypt, encryptionFormat } = require('../src/utils/encryption');

const APPLY_PHRASE = 'REENCRYPT-ALL-SHOPIFY-TOKENS';

function planReencryption(rows) {
  const plan = [];
  for (const row of rows || []) {
    const format = encryptionFormat(row.access_token);
    if (format === 'v2-gcm') plan.push({ id: row.id, action: 'skip_already_v2' });
    else if (format === 'v1-cbc') plan.push({ id: row.id, action: 'reencrypt' });
    else plan.push({ id: row.id, action: 'skip_unrecognized_format' });
  }
  return plan;
}

async function main() {
  const { prisma } = require('../src/configs/database');
  const apply = process.argv.includes('--apply');
  if (apply && process.env.REVLUMA_REKEY_CONFIRM !== APPLY_PHRASE) {
    process.stderr.write('apply requires REVLUMA_REKEY_CONFIRM=REENCRYPT-ALL-SHOPIFY-TOKENS\n');
    process.exit(2);
  }
  const rows = await prisma.stores.findMany({
    where: { platform: 'shopify', access_token: { not: null } },
    select: { id: true, access_token: true },
  });
  const plan = planReencryption(rows);
  const summary = {
    generated_at: new Date().toISOString(),
    mode: apply ? 'apply' : 'dry_run',
    total_shopify_stores_with_tokens: rows.length,
    to_reencrypt: plan.filter((item) => item.action === 'reencrypt').length,
    already_v2: plan.filter((item) => item.action === 'skip_already_v2').length,
    skipped_unrecognized: plan.filter((item) => item.action === 'skip_unrecognized_format').length,
    results: [],
  };
  if (apply) {
    for (const item of plan) {
      if (item.action !== 'reencrypt') continue;
      const row = rows.find((candidate) => candidate.id === item.id);
      try {
        const plaintext = decrypt(row.access_token);
        const upgraded = encrypt(plaintext);
        await prisma.stores.update({
          where: { id: row.id },
          data: { access_token: upgraded, updated_at: new Date() },
        });
        summary.results.push({ id: row.id, outcome: 'reencrypted' });
      } catch (error) {
        summary.results.push({ id: row.id, outcome: 'decrypt_failed_left_unchanged', error_code: error.code || error.name || 'decrypt_error' });
      }
    }
  }
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  process.exit(0);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(JSON.stringify({ error: error.code || error.name || 'rekey_failed' }) + '\n');
    process.exit(2);
  });
}

module.exports = { planReencryption, APPLY_PHRASE };
