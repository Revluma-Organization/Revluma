'use strict';
const assert = require('node:assert/strict');
const { fetchTenantOperations } = require('./operationalOverviewRepository');
(async () => {
  const calls = [];
  const mock = (name, result) => async args => { calls.push({ name, args }); return result; };
  const prisma = {
    stores: { findMany: mock('stores', [{ id: 'store-owned' }]) },
    sequences: { findMany: mock('sequences', []) },
    sequence_sends: { findMany: mock('sequence_sends', []) },
    alert_queue: { findMany: mock('alert_queue', []) },
    abandoned_carts: { groupBy: mock('abandoned_carts', []) },
  };
  const result = await fetchTenantOperations(prisma, 'org-owned');
  assert.equal(result.storeCount, 1);
  assert.deepEqual(calls.find(c => c.name === 'stores').args.where, { organization_id: 'org-owned', status: { not: 'deleted' } });
  for (const name of ['sequences', 'sequence_sends', 'abandoned_carts']) {
    assert.deepEqual(calls.find(c => c.name === name).args.where.store_id, { in: ['store-owned'] });
  }
  assert.equal(calls.find(c => c.name === 'alert_queue').args.where.organization_id, 'org-owned');
  calls.length = 0;
  prisma.stores.findMany = mock('stores', []);
  await fetchTenantOperations(prisma, 'org-empty');
  for (const name of ['sequences', 'sequence_sends', 'abandoned_carts']) {
    assert.deepEqual(calls.find(c => c.name === name).args.where.store_id, { in: [] });
  }
  assert.equal(calls.find(c => c.name === 'alert_queue').args.where.organization_id, 'org-empty');
  console.log('operationalOverviewRepository tenant isolation tests passed');
})().catch(err => { console.error(err); process.exitCode = 1; });
