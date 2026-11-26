'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// Phase 5C: contextual investigation E2E at the Node boundary. The controller
// cannot be required directly (heavy boot-time deps), so the real shipped
// sources of the persistence mapper and the finding-context writer are
// evaluated in a sandbox (the revPersistence pattern) — the tests fail if the
// functions are renamed or the fields are dropped again. The recommendation
// boundary validator is a pure module and is exercised directly.
const source = fs.readFileSync(path.join(__dirname, '..', 'revController.js'), 'utf8');
const { validateRecommendationBoundary } = require('../../services/revRecommendations');

function evalShipped(startMarker, endMarker, sandbox) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start > 0 && end > start, `${startMarker} must exist in revController`);
  const context = vm.createContext({ ...sandbox });
  return { context, fnSource: source.slice(start, end) };
}

const ORG = '11111111-1111-4111-8111-111111111111';
const STORE = '22222222-2222-4222-8222-222222222222';
const FINDING = '123e4567-e89b-42d3-a456-426614174000';
const CONV = '44444444-4444-4444-8444-444444444444';

// A Python-shaped selected_finding echo: authoritative identifier, tenant,
// authorized evidence references with provenance, and qualification fields.
function pythonEcho() {
  return {
    contract_version: 'rev-selected-finding-v1',
    finding_id: FINDING,
    finding_version: '2026-11-07T11:00:00Z',
    tenant: { organization_id: ORG, store_ids: [STORE] },
    investigation_id: '99999999-9999-4999-8999-999999999999',
    title: 'Verified revenue decreased', type: 'revenue_change',
    lifecycle_state: 'open', current_validity: 'current_evidence_verified',
    evidence_references: ['ev-finding-1'], evidence_quality: 'verified',
    confidence: 'high', limitations: [], selection_source: 'explicit_selection',
    selected_at: '2026-11-07T11:30:00Z',
  };
}
function pythonRecommendation() {
  return {
    contract_version: 'rev-recommendation-v1',
    recommendation_id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
    finding_id: FINDING, finding_version: '2026-11-07T11:00:00Z',
    tenant: { organization_id: ORG, store_ids: [STORE] },
    lifecycle_state: 'proposed', executed: false, read_only: true,
    step: 'Compare order count and average order value for the two recorded periods.',
    why_it_matters: 'The verified revenue movement identifies where to investigate.',
    validation_method: 'Repeat the same comparison after the next equivalent period.',
    evidence_references: ['ev-finding-1'],
  };
}

// ── The persistence mapper keeps the echo and its evidence ─────────────────
const boundedEval = evalShipped('function _boundedResultForPersistence', 'async function _insertRevMessage', {
  MAX_PERSISTED_EVIDENCE_ITEMS: 60, exports: {},
});
const bounded = vm.runInContext(`${boundedEval.fnSource}; _boundedResultForPersistence;`, boundedEval.context);

test('the persisted turn keeps the selected-finding echo verbatim', () => {
  const echo = pythonEcho();
  const persisted = bounded({
    response_type: 'analysis', text: 'Finding answer', selected_finding: echo,
    recommendations: [pythonRecommendation()],
    evidence: { items: [{ id: 'ev-finding-1' }] },
  });
  assert.deepEqual(persisted.selected_finding, echo);
  assert.equal(persisted.selected_finding.finding_id, FINDING);
  assert.deepEqual(persisted.selected_finding.evidence_references, ['ev-finding-1']);
  assert.equal(persisted.selected_finding.evidence_quality, 'verified');
});

test('an explicit null echo persists as null, never as a resurrected reference', () => {
  assert.equal(bounded({ text: 'x', selected_finding: null }).selected_finding, null);
  assert.equal(bounded({ text: 'x' }).selected_finding, null);
});

test('finding evidence items stay bounded on their way into the database', () => {
  const many = Array.from({ length: 200 }, (_, i) => ({ id: `ev-${i}` }));
  const persisted = bounded({ text: 'x', selected_finding: pythonEcho(), evidence: { items: many } });
  assert.ok(persisted.evidence.items.length <= 60);
});

// ── The recommendation boundary re-validates echo and references ───────────
test('a matching echo and recommendation pass the Node boundary', () => {
  const errors = validateRecommendationBoundary(pythonEcho(), [pythonRecommendation()], {
    organizationId: ORG, evidenceIds: new Set(['ev-finding-1']),
  });
  assert.deepEqual(errors, []);
});

test('an orphan recommendation that cites a different finding fails closed', () => {
  const rec = { ...pythonRecommendation(), finding_id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb' };
  const errors = validateRecommendationBoundary(pythonEcho(), [rec], {
    organizationId: ORG, evidenceIds: new Set(['ev-finding-1']),
  });
  assert.ok(errors.includes('recommendation_finding_reference'));
});

test('an echo citing unauthorized evidence fails closed', () => {
  const echo = { ...pythonEcho(), evidence_references: ['ev-forged'] };
  const errors = validateRecommendationBoundary(echo, [], {
    organizationId: ORG, evidenceIds: new Set(['ev-finding-1']),
  });
  assert.ok(errors.includes('selected_finding_evidence_reference'));
});

test('a cross-tenant echo fails closed', () => {
  const echo = { ...pythonEcho(), tenant: { organization_id: 'other-org', store_ids: [STORE] } };
  const errors = validateRecommendationBoundary(echo, [], {
    organizationId: ORG, evidenceIds: new Set(['ev-finding-1']),
  });
  assert.ok(errors.includes('selected_finding_tenant'));
});

// ── The finding-context writer persists the reference org-scoped ───────────
const persistEval = evalShipped('async function _persistFindingContext', 'exports._persistFindingContext', {});
function persistWithFakePrisma(data) {
  const calls = [];
  const prisma = {
    $executeRaw: async (...args) => { calls.push(args); return 1; },
  };
  const context = vm.createContext({ prisma, JSON, Date });
  vm.runInContext(persistEval.fnSource, context);
  return vm.runInContext('_persistFindingContext', context)(CONV, ORG, data).then(() => calls);
}

test('the writer stores the authorized reference scoped to conversation and org', async () => {
  const calls = await persistWithFakePrisma({ selected_finding: pythonEcho(), recommendations: [] });
  assert.equal(calls.length, 1);
  const values = calls[0].slice(1);
  assert.ok(values.includes(CONV));
  assert.ok(values.includes(ORG));
  const reference = JSON.parse(values.find((v) => typeof v === 'string' && v.includes(FINDING)));
  assert.equal(reference.finding_id, FINDING);
  assert.equal(reference.selection_source, 'explicit_selection');
  assert.equal(typeof reference.selected_at, 'string');
  assert.equal('title' in reference, false);
});

test('an explicit null echo clears the persisted reference', async () => {
  const calls = await persistWithFakePrisma({ selected_finding: null });
  assert.equal(calls.length, 1);
  const values = calls[0].slice(1);
  assert.ok(values.includes('null'));
});

test('a result without the key leaves the persisted reference untouched', async () => {
  const calls = await persistWithFakePrisma({ text: 'no echo key' });
  assert.equal(calls.length, 0);
});

// ── Both chat handlers persist finding context ─────────────────────────────
test('JSON and streaming chat both persist finding context after success', () => {
  assert.equal((source.match(/await _persistFindingContext\(activeConvId, org\.id, /g) || []).length, 2);
});
