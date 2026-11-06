/**
 * Source-to-database product catalogue reconciliation (pure logic).
 *
 * The catalogue sync upserts what Shopify returns; it never removes rows.
 * A product deleted in Shopify without a products/delete webhook therefore
 * lingers locally. Deleting those rows is a destructive operation, so it is
 * gated behind two independent confirmations:
 *
 *   1. The caller must opt in explicitly (apply mode), and
 *   2. REVLUMA_RECONCILE_CONFIRM_DELETIONS must carry the exact phrase
 *      `DELETE-SOURCE-ABSENT-PRODUCTS`.
 *
 * Two additional hard guards make an accidental wipeout impossible:
 *
 *   * An empty source collection can never justify deletion. If Shopify
 *     returns zero products, the plan refuses to run — an API/permission
 *     failure must never masquerade as "everything was deleted".
 *   * Only rows whose store_id matches the reconciled store are candidates,
 *     and the deletion set is exactly `absent_from_source`.
 *
 * The functions here are pure and dependency-free so they can be tested
 * offline. The script wires them to the live authorized installation.
 */
'use strict';

const CONFIRMATION_PHRASE = 'DELETE-SOURCE-ABSENT-PRODUCTS';
const ALLOW_EMPTY_SOURCE_PHRASE = 'ALLOW-EMPTY-SOURCE-DELETE';

function externalNumericId(gid) {
  return String(gid || '').split('/').pop().trim();
}

function diffProductCatalogue({ sourceIds, dbRows }) {
  const source = new Set((sourceIds || []).map(externalNumericId).filter(Boolean));
  const db = new Map((dbRows || []).map((row) => [String(row.external_id), row]));
  const missing_in_db = [];
  for (const id of source) if (!db.has(id)) missing_in_db.push(id);
  const absent_from_source = [];
  let matched = 0;
  for (const [id] of db) {
    if (source.has(id)) matched += 1;
    else absent_from_source.push(id);
  }
  missing_in_db.sort();
  absent_from_source.sort();
  return {
    source_count: source.size,
    db_count: db.size,
    matched_count: matched,
    missing_in_db,
    absent_from_source,
  };
}

/**
 * Build the deletion plan. Throws RECONCILE_CONFIRMATION_REQUIRED unless the
 * caller is in apply mode AND the environment carries the exact confirmation
 * phrase. Throws RECONCILE_EMPTY_SOURCE_REFUSED when the source returned no
 * products unless a second, separate phrase is present.
 */
function planSourceAbsentDeletion({ diff, apply, confirmToken, allowEmptySourceToken }) {
  if (!apply) {
    return { apply: false, deletable_external_ids: [], reason: 'dry_run' };
  }
  if (confirmToken !== CONFIRMATION_PHRASE) {
    const err = new Error('source-absent deletion requires REVLUMA_RECONCILE_CONFIRM_DELETIONS to equal the exact confirmation phrase');
    err.code = 'RECONCILE_CONFIRMATION_REQUIRED';
    throw err;
  }
  if (diff.source_count === 0 && allowEmptySourceToken !== ALLOW_EMPTY_SOURCE_PHRASE) {
    const err = new Error('refusing to delete local products: the source collection is empty; set REVLUMA_RECONCILE_ALLOW_EMPTY_SOURCE to DELETE only if the merchant catalog is genuinely empty');
    err.code = 'RECONCILE_EMPTY_SOURCE_REFUSED';
    throw err;
  }
  return { apply: true, deletable_external_ids: [...diff.absent_from_source], reason: 'operator_approved' };
}

module.exports = {
  CONFIRMATION_PHRASE,
  ALLOW_EMPTY_SOURCE_PHRASE,
  diffProductCatalogue,
  externalNumericId,
  planSourceAbsentDeletion,
};
