'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  OPERATIONAL_ACTIVITY_CONTRACT_VERSION,
  FEED_WINDOW_DAYS,
  buildFeedItems,
  paginate,
  buildOperationalActivity,
  validateOperationalActivity,
} = require('./operationalActivity');

const NOW = new Date('2026-11-07T12:00:00.000Z');
const DAY = 86400000;
const iso = (ms) => new Date(NOW.getTime() + ms).toISOString();

function findingRow(over = {}) {
  return Object.assign({
    id: 'f1', dedupe_key: 'dk-revenue-drop', type: 'revenue', severity: 'high',
    status: 'open', title: 'Revenue drop', description: 'Net sales fell 45%.',
    detected_at: iso(-1 * DAY), updated_at: iso(-0.5 * DAY),
  }, over);
}
function lifecycleRow(over = {}) {
  return Object.assign({
    id: 'l1', event_type: 'sync_completed', from_state: 'synchronizing', to_state: 'connected',
    reason_code: 'ALL_DOMAINS_FRESH', source: 'sync_engine', event_reference: 'ref-1',
    capability: 'shopify', observed_at: iso(-2 * DAY), created_at: iso(-1.9 * DAY),
  }, over);
}
function syncRow(over = {}) {
  return Object.assign({
    domain: 'orders', status: 'succeeded', last_attempted_at: iso(-3 * DAY),
    last_succeeded_at: iso(-3 * DAY), error_code: null, retry_count: 0,
    updated_at: iso(-3 * DAY),
  }, over);
}
function build(over = {}, now = NOW, page = {}) {
  const bundle = Object.assign({ store: { id: 's', organization_id: 'o', shop_domain: 'x' }, findings: [], lifecycle: [], syncDomains: [] }, over);
  return buildOperationalActivity(bundle, now, page);
}

test('contract shape + version', () => {
  const c = build({ findings: [findingRow()] });
  assert.equal(c.contract_version, OPERATIONAL_ACTIVITY_CONTRACT_VERSION);
  assert.equal(c.organization_id, 'o');
  assert.equal(c.store_id, 's');
  assert.equal(c.window_days, FEED_WINDOW_DAYS);
  assert.deepEqual(validateOperationalActivity(c), []);
});

// ── Finding lifecycle (scenario J) ─────────────────────────────────────────
test('J: finding appears with lifecycle status + closed severity', () => {
  const c = build({ findings: [findingRow({ severity: 'critical', status: 'acknowledged' })] });
  const item = c.items[0];
  assert.equal(item.type, 'finding');
  assert.equal(item.status, 'acknowledged');
  assert.equal(item.severity, 'critical');
  assert.equal(item.source, 'intelligence_findings');
});
test('J: finding occurrence is detected_at, processing is updated_at', () => {
  const c = build({ findings: [findingRow({ detected_at: iso(-2 * DAY), updated_at: iso(-1 * DAY) })] });
  assert.equal(c.items[0].occurred_at, iso(-2 * DAY));
  assert.equal(c.items[0].received_at, iso(-1 * DAY));
});

// ── Integration + webhook + sync events ────────────────────────────────────
test('integration lifecycle event -> integration_change', () => {
  const c = build({ lifecycle: [lifecycleRow({ event_type: 'state_change', to_state: 'disconnected', from_state: 'connected', reason_code: 'TOKEN_REVOKED' })] });
  const item = c.items[0];
  assert.equal(item.type, 'integration_change');
  assert.equal(item.severity, 'critical');
  assert.equal(item.status, 'disconnected');
});
test('webhook event_type -> webhook category', () => {
  const c = build({ lifecycle: [lifecycleRow({ event_type: 'webhook_delivery_failed', to_state: 'failed', event_reference: 'wh-1' })] });
  assert.equal(c.items[0].type, 'webhook');
  assert.equal(c.items[0].category, 'webhook');
});
test('sync domain succeeded -> sync item (info)', () => {
  const c = build({ syncDomains: [syncRow({ status: 'succeeded' })] });
  const item = c.items[0];
  assert.equal(item.type, 'sync');
  assert.equal(item.severity, 'info');
  assert.equal(item.status, 'succeeded');
});
test('sync domain failed -> warning with error code', () => {
  const c = build({ syncDomains: [syncRow({ status: 'failed', error_code: 'TOKEN_EXPIRED' })] });
  const item = c.items[0];
  assert.equal(item.severity, 'warning');
  assert.ok(item.title.includes('TOKEN_EXPIRED'));
});
test('never-run / running domains are not emitted as events', () => {
  const c = build({ syncDomains: [syncRow({ status: 'never_run', last_attempted_at: null, last_succeeded_at: null }), syncRow({ domain: 'products', status: 'running' })] });
  assert.equal(c.items.length, 0);
});

// ── Idempotency / dedup (scenario H: duplicate webhook) ────────────────────
test('H: duplicate finding (same dedupe_key) -> one item', () => {
  const c = build({ findings: [findingRow(), findingRow({ id: 'f2' })] });
  assert.equal(c.items.length, 1);
  assert.equal(c.total, 1);
});
test('H: duplicate lifecycle (same source+event_reference) -> one item', () => {
  const c = build({ lifecycle: [lifecycleRow(), lifecycleRow({ id: 'l2' })] });
  assert.equal(c.items.length, 1);
});
test('H: same event reprocessed with a newer received_at keeps the newest', () => {
  const a = findingRow({ id: 'fa', detected_at: iso(-1 * DAY), updated_at: iso(-1 * DAY) });
  const b = findingRow({ id: 'fb', detected_at: iso(-1 * DAY), updated_at: iso(-0.2 * DAY) });
  const c = build({ findings: [a, b] });
  assert.equal(c.items.length, 1);
  assert.equal(c.items[0].received_at, iso(-0.2 * DAY));
});

// ── Ordering + out-of-order (scenario H2) ──────────────────────────────────
test('ordering: newest occurrence first', () => {
  const c = build({ findings: [findingRow({ dedupe_key: 'old', detected_at: iso(-5 * DAY) }), findingRow({ dedupe_key: 'new', detected_at: iso(-1 * DAY) })] });
  assert.ok(new Date(c.items[0].occurred_at) > new Date(c.items[1].occurred_at));
});
test('out-of-order: a late-processed event with an earlier occurrence sorts by occurrence', () => {
  // 'late' was processed most recently (received_at newest) but occurred earlier.
  const late = findingRow({ dedupe_key: 'late', detected_at: iso(-4 * DAY), updated_at: iso(-0.1 * DAY) });
  const recent = findingRow({ dedupe_key: 'recent', detected_at: iso(-1 * DAY), updated_at: iso(-0.9 * DAY) });
  const c = build({ findings: [recent, late] });
  assert.equal(c.items[0].occurred_at, iso(-1 * DAY));   // recent occurrence first
  assert.equal(c.items[1].occurred_at, iso(-4 * DAY));   // late occurrence second
});
test('tie on occurrence breaks by event_id (stable)', () => {
  const a = findingRow({ dedupe_key: 'zzz', detected_at: iso(-1 * DAY) });
  const b = findingRow({ dedupe_key: 'aaa', detected_at: iso(-1 * DAY) });
  const c = build({ findings: [a, b] });
  assert.ok(c.items[0].event_id < c.items[1].event_id);
});

// ── Recency window ─────────────────────────────────────────────────────────
test('events older than the window are excluded', () => {
  const c = build({ findings: [findingRow({ dedupe_key: 'ancient', detected_at: iso(-30 * DAY) })] });
  assert.equal(c.items.length, 0);
});
test('future-dated events (clock skew) are excluded', () => {
  const c = build({ findings: [findingRow({ dedupe_key: 'future', detected_at: iso(5 * DAY) })] });
  assert.equal(c.items.length, 0);
});

// ── Pagination (keyset) ────────────────────────────────────────────────────
test('pagination: limit respected + has_more + next_cursor', () => {
  const findings = Array.from({ length: 10 }, (_, i) => findingRow({ dedupe_key: `k${i}`, detected_at: iso(-(i + 1) * 3600000) }));
  const c = build({ findings }, NOW, { limit: 3 });
  assert.equal(c.items.length, 3);
  assert.equal(c.total, 10);
  assert.equal(c.has_more, true);
  assert.ok(c.next_cursor);
});
test('pagination: cursor returns the next, non-overlapping page', () => {
  const findings = Array.from({ length: 10 }, (_, i) => findingRow({ dedupe_key: `k${i}`, detected_at: iso(-(i + 1) * 3600000) }));
  const p1 = build({ findings }, NOW, { limit: 4 });
  const p2 = build({ findings }, NOW, { limit: 4, cursor: p1.next_cursor });
  const ids1 = p1.items.map((i) => i.event_id);
  const ids2 = p2.items.map((i) => i.event_id);
  assert.equal(new Set([...ids1, ...ids2]).size, ids1.length + ids2.length); // no overlap
  assert.equal(p2.items.length, 4);
});
test('pagination: limit clamped to max', () => {
  const findings = Array.from({ length: 5 }, (_, i) => findingRow({ dedupe_key: `k${i}`, detected_at: iso(-(i + 1) * 3600000) }));
  const c = build({ findings }, NOW, { limit: 9999 });
  assert.equal(c.limit, 100);
});
test('paginate: empty feed -> no cursor', () => {
  const page = paginate([], { limit: 10 });
  assert.equal(page.has_more, false);
  assert.equal(page.next_cursor, null);
  assert.equal(page.total, 0);
});

// ── No sensitive data ──────────────────────────────────────────────────────
test('no credential/PII material in any item', () => {
  const c = build({
    findings: [findingRow({ title: 'Revenue drop', description: 'A customer email user@example.com and shpat_secrettoken appear here.' })],
    lifecycle: [lifecycleRow({ reason_code: 'TOKEN_EXPIRED' })],
    syncDomains: [syncRow()],
  });
  const blob = JSON.stringify(c.items);
  assert.ok(!/shpat_[a-z0-9_]+/i.test(blob));
  assert.ok(!/user@example\.com/.test(blob));
  // (The finding description is clipped; a raw token/PII is never added by the
  //  mapper. The mapper only uses closed enums, domain names and reason codes.)
});
test('item titles/details derive only from closed fields (no payload echo)', () => {
  const c = build({ syncDomains: [syncRow({ domain: 'orders', status: 'failed', error_code: 'RATE_LIMIT' })] });
  assert.ok(c.items[0].title.includes('orders'));
  assert.ok(!c.items[0].detail || c.items[0].detail.length <= 80);
});

// ── Validator ──────────────────────────────────────────────────────────────
test('validate: valid feed -> no problems', () => {
  assert.deepEqual(validateOperationalActivity(build({ findings: [findingRow()] })), []);
});
test('validate: duplicate event_id -> problem', () => {
  const c = build({ findings: [findingRow()] });
  c.items.push({ ...c.items[0] });
  assert.ok(validateOperationalActivity(c).some((p) => p.includes('duplicate event_id')));
});
test('validate: bad severity -> problem', () => {
  const c = build({ findings: [findingRow()] });
  c.items[0].severity = 'explosive';
  assert.ok(validateOperationalActivity(c).some((p) => p.includes('severity invalid')));
});
