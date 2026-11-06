/**
 * Fixture verification for the source-absent reconciliation path.
 * The live apply mode is approval-gated and is NOT exercised against production here.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CONFIRMATION_PHRASE,
  ALLOW_EMPTY_SOURCE_PHRASE,
  diffProductCatalogue,
  externalNumericId,
  planSourceAbsentDeletion,
} = require('../services/productReconciliation');

const dbRows = [
  { external_id: '1001', status: 'active' },
  { external_id: '1002', status: 'active' },
  { external_id: '1003', status: 'archived' }, // source-absent
  { external_id: 'gid-ignored', status: 'draft' },
];

test('externalNumericId normalizes gids and bare ids', () => {
  assert.equal(externalNumericId('gid://shopify/Product/1001'), '1001');
  assert.equal(externalNumericId('1001'), '1001');
  assert.equal(externalNumericId('  1002  '), '1002');
});

test('diff separates missing-in-db from absent-from-source', () => {
  const diff = diffProductCatalogue({ sourceIds: ['gid://shopify/Product/1001', '1002', '1004'], dbRows });
  assert.equal(diff.source_count, 3);
  assert.equal(diff.db_count, 4);
  assert.equal(diff.matched_count, 2);
  assert.deepEqual(diff.missing_in_db, ['1004']);
  assert.deepEqual(diff.absent_from_source, ['1003', 'gid-ignored']);
});

test('dry-run never plans deletions', () => {
  const diff = diffProductCatalogue({ sourceIds: ['1001'], dbRows });
  const plan = planSourceAbsentDeletion({ diff, apply: false });
  assert.equal(plan.apply, false);
  assert.deepEqual(plan.deletable_external_ids, []);
});

test('apply mode refuses without the exact confirmation phrase', () => {
  const diff = diffProductCatalogue({ sourceIds: ['1001'], dbRows });
  assert.throws(() => planSourceAbsentDeletion({ diff, apply: true, confirmToken: 'yes' }), /RECONCILE_CONFIRMATION_REQUIRED|confirmation phrase/);
  assert.throws(() => planSourceAbsentDeletion({ diff, apply: true, confirmToken: undefined }));
});

test('apply mode refuses an empty source unless a second phrase is present', () => {
  const diff = diffProductCatalogue({ sourceIds: [], dbRows });
  assert.throws(
    () => planSourceAbsentDeletion({ diff, apply: true, confirmToken: CONFIRMATION_PHRASE }),
    /RECONCILE_EMPTY_SOURCE_REFUSED|refusing/,
  );
  const plan = planSourceAbsentDeletion({
    diff,
    apply: true,
    confirmToken: CONFIRMATION_PHRASE,
    allowEmptySourceToken: ALLOW_EMPTY_SOURCE_PHRASE,
  });
  assert.equal(plan.deletable_external_ids.length, dbRows.length);
});

test('apply mode plans exactly the absent_from_source set', () => {
  const diff = diffProductCatalogue({ sourceIds: ['1001', '1002'], dbRows });
  const plan = planSourceAbsentDeletion({ diff, apply: true, confirmToken: CONFIRMATION_PHRASE });
  assert.deepEqual(plan.deletable_external_ids, ['1003', 'gid-ignored']);
});

test('empty local table plans zero deletions even with full confirmation', () => {
  const diff = diffProductCatalogue({ sourceIds: ['1001'], dbRows: [] });
  const plan = planSourceAbsentDeletion({ diff, apply: true, confirmToken: CONFIRMATION_PHRASE });
  assert.deepEqual(plan.deletable_external_ids, []);
  assert.deepEqual(diff.missing_in_db, ['1001']);
});
