'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { persistVerifiedFindings, listFindings, changeFindingStatus } = require('../services/intelligenceFindingsRepository');
const org = '11111111-1111-4111-8111-111111111111';
const storeId = '22222222-2222-4222-8222-222222222222';
const findingId = '33333333-3333-4333-8333-333333333333';
test('rejects cross-tenant and unverified candidates before database writes', async () => {
  let writes = 0;
  const db = { stores: { findFirst: async () => ({ id: storeId }) },
    intelligence_findings: { upsert: async () => { writes++; } } };
  const candidate = { type: 'integration_failure', severity: 'high',
    scope: { organizationId: 'another-org', storeId },
    evidence: { verified: true } };
  assert.equal(await persistVerifiedFindings(db, org, [candidate]), 0);
  assert.equal(await persistVerifiedFindings(db, org, [{ ...candidate, scope: { organizationId: org, storeId }, evidence: { verified: false } }]), 0);
  assert.equal(writes, 0);
});
test('lifecycle mutation enforces organization ownership and legal status', async () => {
  let observed;
  const db = { intelligence_findings: { updateMany: async args => { observed = args; return { count: 1 }; } } };
  assert.deepEqual(await changeFindingStatus(db, org, findingId, 'reopened'), { invalid: true });
  assert.deepEqual(await changeFindingStatus(db, org, findingId, 'resolved'), { changed: true });
  assert.equal(observed.where.organization_id, org);
  assert.deepEqual(observed.where.status.in, ['open', 'acknowledged']);
});
test('finding list defaults to open and caps page size', async () => {
  let observed;
  const db = { intelligence_findings: { findMany: async args => { observed = args; return []; } } };
  await listFindings(db, org, { limit: 10000 });
  assert.equal(observed.where.organization_id, org);
  assert.equal(observed.where.status, 'open');
  assert.equal(observed.take, 100);
});
