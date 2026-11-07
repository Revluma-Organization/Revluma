'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveFindingChatContext } = require('../services/findingChatContext');
const { TRUSTED_SOURCE } = require('../services/intelligenceOrderCoverage');
const fs = require('node:fs');
const path = require('node:path');

const ID = '123e4567-e89b-42d3-a456-426614174000';
const ORG = 'org-a';
function certifiedFinding() {
  return { id: ID, store_id: 'store-a', type: 'revenue_change', title: 'Revenue changed',
    description: 'Review the recent change', detected_at: '2026-10-15T00:00:00Z',
    evidence: { verified: true, complete: true, coverage_source: TRUSTED_SOURCE,
      coverage_run_id: 'sync-123', currency: 'USD', previousStart: '2026-10-01T00:00:00Z',
      previousEnd: '2026-10-08T00:00:00Z', currentStart: '2026-10-08T00:00:00Z',
      currentEnd: '2026-10-15T00:00:00Z', previousCount: 10, currentCount: 7,
      previousRevenue: 300, currentRevenue: 200 } };
}

test('authorized finding resolution selects and passes the exact UUID to Python context', async () => {
  const calls = [];
  const prisma = {
    intelligence_findings: { findFirst: async query => {
      calls.push(query);
      assert.equal(query.where.id, ID);
      assert.equal(query.where.organization_id, ORG);
      assert.equal(query.select.id, true);
      return certifiedFinding();
    } },
    stores: { findFirst: async query => {
      calls.push(query);
      assert.deepEqual(query.where, { id: 'store-a', organization_id: ORG });
      return { id: 'store-a' };
    } },
  };
  const resolved = await resolveFindingChatContext(prisma, ORG, ID, 'Why high priority?');
  assert.equal(resolved.status, 'ok');
  assert.equal(resolved.selected_finding.finding_id, ID);
  assert.equal(resolved.selected_finding.selection_source, 'explicit_selection');
  assert.equal(resolved.context, undefined);
  assert.equal(calls.length, 2);
});

test('both JSON and streaming chat controllers use the authorized resolver', () => {
  const source = fs.readFileSync(path.join(__dirname, '../controller/revController.js'), 'utf8');
  assert.equal((source.match(/resolveFindingChatContext\(prisma/g) || []).length, 2);
  assert.equal(source.includes('buildFindingContext(message, finding)'), false);
});

test('invalid and cross-store references fail closed; unverified evidence remains qualified context', async () => {
  let findingCalls = 0;
  const prisma = {
    intelligence_findings: { findFirst: async () => { findingCalls += 1; return certifiedFinding(); } },
    stores: { findFirst: async () => null },
  };
  assert.deepEqual(await resolveFindingChatContext(prisma, ORG, 'bad', 'Explain'), { status: 'invalid' });
  assert.equal(findingCalls, 0);
  assert.deepEqual(await resolveFindingChatContext(prisma, ORG, ID, 'Explain'), { status: 'not_found' });
  prisma.stores.findFirst = async () => ({ id: 'store-a' });
  prisma.intelligence_findings.findFirst = async () => ({ ...certifiedFinding(), evidence: { verified: false } });
  const partial = await resolveFindingChatContext(prisma, ORG, ID, 'Explain');
  assert.equal(partial.status, 'ok');
  assert.equal(partial.selected_finding.finding_id, ID);
  assert.equal(partial.selected_finding.evidence, undefined);
});
