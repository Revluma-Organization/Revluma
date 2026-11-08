// src/services/operationalActivity.js
// Task 218 — operational activity feed (rev-operational-activity-v1).
//
// A PERSISTED, DEDUPLICATED, ORDERED feed of operational events for the Command
// Center. It is a PURE composition of persisted records; it never fabricates an
// event and never re-processes one into a duplicate:
//   • intelligence_findings          -> findings (lifecycle: open/ack/resolved/dismissed)
//   • integration_lifecycle_events   -> integration changes + webhook events
//   • store_sync_domain_states       -> synchronization completed / failed / partial
//
// Invariants (Task 218 §9, §11, §12):
//   • Occurrence vs processing time: every item carries `occurred_at` (when the
//     thing happened, business time) and `received_at` (when it was persisted).
//     Ordering is by occurrence time, not by processing time, so late-arriving
//     or out-of-order records slot in correctly.
//   • Idempotent / deduped: each item has a STABLE `event_id` derived from the
//     record's dedup key. Re-processing the same logical event (e.g. a webhook
//     retry) yields the same event_id and is therefore collapsed, never
//     duplicated.
//   • No sensitive data: titles/details use only closed enums, domain names and
//     reason codes — no tokens, payloads, or customer PII.
//   • Bounded: only events within a documented recent window are surfaced, and
//     the feed is paginated (keyset on occurred_at + event_id).

'use strict';

const OPERATIONAL_ACTIVITY_CONTRACT_VERSION = 'rev-operational-activity-v1';

// Only recent operational events are surfaced; older records remain queryable
// elsewhere but do not clutter the live Command Center feed.
const FEED_WINDOW_DAYS = 14;
const LIMIT_DEFAULT = 20;
const LIMIT_MAX = 100;
const DAY_MS = 24 * 3600 * 1000;

// Closed severity set (business/operational attention level, independent of the
// data-quality axis). Not a business-health classification.
const SEVERITY = { CRITICAL: 'critical', WARNING: 'warning', ATTENTION: 'attention', INFO: 'info' };

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v) => typeof v === 'string';
const iso = (value) => {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};
const ts = (value) => {
  const d = value == null ? null : (value instanceof Date ? value : new Date(value));
  return d && Number.isFinite(d.getTime()) ? d.getTime() : null;
};
const clip = (s, n) => {
  const str = isStr(s) ? s : '';
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
};

// Map a persisted finding severity (free text) onto the closed set.
function findingSeverity(sev) {
  const s = String(sev || '').toLowerCase();
  if (s === 'critical') return SEVERITY.CRITICAL;
  if (s === 'high' || s === 'warning') return SEVERITY.WARNING;
  if (s === 'medium' || s === 'moderate' || s === 'attention') return SEVERITY.ATTENTION;
  return SEVERITY.INFO;
}

// Map an integration to_state onto the closed set.
function integrationSeverity(toState) {
  const s = String(toState || '').toLowerCase();
  if (['disconnected', 'authorization_revoked', 'authorization_expired', 'authorization_required'].includes(s)) return SEVERITY.CRITICAL;
  if (s === 'sync_failed') return SEVERITY.WARNING;
  if (['needs_attention', 'sync_partial', 'synchronizing'].includes(s)) return SEVERITY.ATTENTION;
  if (s === 'connected') return SEVERITY.INFO;
  return SEVERITY.INFO;
}

// Map a sync domain status onto the closed set.
function syncSeverity(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'failed') return SEVERITY.WARNING;
  if (s === 'degraded' || s === 'partial') return SEVERITY.ATTENTION;
  return SEVERITY.INFO;
}

function findingItemType(eventType) {
  const s = String(eventType || '').toLowerCase();
  if (s.includes('webhook')) return 'webhook';
  if (s.includes('sync')) return 'sync';
  return 'integration_change';
}

// --- Item builders (pure; each yields a normalized item or null) ------------

function findingItem(row) {
  if (!isObj(row)) return null;
  const occurredAt = iso(row.detected_at);
  if (!occurredAt) return null;
  const key = isStr(row.dedupe_key) && row.dedupe_key ? row.dedupe_key : row.id;
  return {
    event_id: `finding:${key}`,
    type: 'finding',
    category: 'finding',
    severity: findingSeverity(row.severity),
    title: clip(row.title, 140) || 'Finding detected',
    // Detail uses only the closed finding type code, NOT the free-text
    // description, so no payload/PII can leak into the feed. Full detail is
    // reached via the navigation link (progressive disclosure).
    detail: isStr(row.type) && row.type ? `finding type: ${clip(row.type, 80)}` : '',
    status: isStr(row.status) ? row.status : null,
    occurred_at: occurredAt,
    received_at: iso(row.updated_at) || occurredAt,
    source: 'intelligence_findings',
    finding_id: isStr(row.id) ? row.id : null,
    link: '/findings',
  };
}

function lifecycleItem(row) {
  if (!isObj(row)) return null;
  const occurredAt = iso(row.observed_at);
  if (!occurredAt) return null;
  const ref = isStr(row.event_reference) && row.event_reference ? row.event_reference : row.id;
  const type = findingItemType(row.event_type);
  const toState = isStr(row.to_state) ? row.to_state : 'unknown';
  const fromState = isStr(row.from_state) ? row.from_state : null;
  const title = type === 'webhook'
    ? `Webhook event: ${clip(row.event_type, 80) || 'event'}`
    : type === 'sync'
      ? `Synchronization ${fromState ? `moved ${fromState} → ` : ''}${toState}`
      : `Integration ${fromState ? `moved ${fromState} → ` : ''}${toState}`;
  return {
    event_id: `lifecycle:${isStr(row.source) ? row.source : 'unknown'}:${ref}`,
    type,
    category: type === 'webhook' ? 'webhook' : (type === 'sync' ? 'sync' : 'integration'),
    severity: type === 'webhook' ? SEVERITY.ATTENTION : integrationSeverity(toState),
    title: clip(title, 140),
    detail: isStr(row.reason_code) ? `reason: ${clip(row.reason_code, 120)}` : '',
    status: toState,
    occurred_at: occurredAt,
    received_at: iso(row.created_at) || occurredAt,
    source: 'integration_lifecycle_events',
    link: '/integrations',
  };
}

// One item per sync domain representing its LATEST outcome (completed/failed/
// partial). Only meaningful outcomes are surfaced; a domain that has never run
// or is merely queued is not an "event".
function syncDomainItem(row) {
  if (!isObj(row)) return null;
  const domain = isStr(row.domain) ? row.domain : null;
  if (!domain) return null;
  const status = isStr(row.status) ? row.status : null;
  if (!status || status === 'never_run' || status === 'running' || status === 'queued') return null;
  const occurredAt = iso(row.last_attempted_at || row.last_succeeded_at);
  if (!occurredAt) return null;
  const verb = status === 'succeeded' ? 'completed'
    : status === 'failed' ? 'failed'
      : status === 'degraded' ? 'partially completed'
        : 'updated';
  const errorNote = isStr(row.error_code) && row.error_code ? ` (${clip(row.error_code, 80)})` : '';
  return {
    event_id: `sync:${domain}:${status}:${occurredAt}`,
    type: 'sync',
    category: 'sync',
    severity: syncSeverity(status),
    title: clip(`Synchronization ${verb} for ${domain}${errorNote}`, 140),
    detail: row.retry_count ? `attempts: ${row.retry_count}` : '',
    status,
    occurred_at: occurredAt,
    received_at: iso(row.updated_at) || occurredAt,
    source: 'store_sync_domain_states',
    link: '/integrations',
  };
}

// ---------------------------------------------------------------------------
// Feed assembly: build, dedup by stable event_id, filter to the recent window,
// order by occurrence time (tie-break event_id).
// ---------------------------------------------------------------------------

function dedupeByEventId(items) {
  const byId = new Map();
  for (const item of items) {
    if (!item || !item.event_id) continue;
    const existing = byId.get(item.event_id);
    if (!existing) { byId.set(item.event_id, item); continue; }
    // Keep the most recently processed (received_at) representation.
    const a = ts(item.received_at) || 0;
    const b = ts(existing.received_at) || 0;
    if (a > b) byId.set(item.event_id, item);
  }
  return [...byId.values()];
}

function compareFeed(a, b) {
  const ao = ts(a.occurred_at) || 0;
  const bo = ts(b.occurred_at) || 0;
  if (ao !== bo) return bo - ao; // newest first
  if (a.event_id < b.event_id) return -1;
  if (a.event_id > b.event_id) return 1;
  return 0;
}

function buildFeedItems(bundle, now = new Date()) {
  const b = bundle || {};
  const nowD = now instanceof Date ? now : new Date(now);
  const cutoff = nowD.getTime() - FEED_WINDOW_DAYS * DAY_MS;
  const raw = []
    .concat((Array.isArray(b.findings) ? b.findings : []).map(findingItem))
    .concat((Array.isArray(b.lifecycle) ? b.lifecycle : []).map(lifecycleItem))
    .concat((Array.isArray(b.syncDomains) ? b.syncDomains : []).map(syncDomainItem))
    .filter(Boolean);

  const deduped = dedupeByEventId(raw)
    .filter((item) => {
      const t = ts(item.occurred_at);
      return t != null && t <= nowD.getTime() && t >= cutoff;
    })
    .sort(compareFeed);
  return deduped;
}

// Keyset pagination on (occurred_at DESC, event_id ASC).
function parseCursor(cursor) {
  if (!isStr(cursor)) return null;
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf8');
    const [occurredAt, eventId] = decoded.split('|');
    if (!occurredAt || !eventId) return null;
    return { occurredAt, eventId };
  } catch { return null; }
}
function encodeCursor(occurredAt, eventId) {
  return Buffer.from(`${occurredAt}|${eventId}`).toString('base64');
}

function paginate(items, { limit = LIMIT_DEFAULT, cursor = null } = {}) {
  const safeLimit = Math.max(1, Math.min(LIMIT_MAX, Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : LIMIT_DEFAULT));
  const parsed = parseCursor(cursor);
  let page = items;
  if (parsed) {
    const cOcc = ts(parsed.occurredAt) || 0;
    page = items.filter((item) => {
      const t = ts(item.occurred_at) || 0;
      if (t < cOcc) return true;
      if (t === cOcc) return item.event_id > parsed.eventId;
      return false;
    });
  }
  const slice = page.slice(0, safeLimit);
  const hasMore = page.length > slice.length;
  const last = slice[slice.length - 1];
  return {
    items: slice,
    total: items.length,
    returned: slice.length,
    has_more: hasMore,
    next_cursor: hasMore && last ? encodeCursor(last.occurred_at, last.event_id) : null,
    limit: safeLimit,
  };
}

function buildOperationalActivity(bundle, now = new Date(), pageOptions = {}) {
  const b = bundle || {};
  const nowD = now instanceof Date ? now : new Date(now);
  const all = buildFeedItems(b, nowD);
  const page = paginate(all, pageOptions);
  return {
    contract_version: OPERATIONAL_ACTIVITY_CONTRACT_VERSION,
    organization_id: (b.store && b.store.organization_id) || null,
    store_id: (b.store && b.store.id) || null,
    shop_domain: (b.store && b.store.shop_domain) || null,
    generated_at: iso(nowD),
    window_days: FEED_WINDOW_DAYS,
    total: page.total,
    returned: page.returned,
    has_more: page.has_more,
    next_cursor: page.next_cursor,
    limit: page.limit,
    items: page.items,
  };
}

// Fail-closed validator (API boundary).
const VALID_TYPES = new Set(['finding', 'integration_change', 'webhook', 'sync']);
const VALID_SEVERITY = new Set(Object.values(SEVERITY));

function validateOperationalActivity(obj) {
  const problems = [];
  if (!isObj(obj)) return ['operational activity is not an object'];
  if (obj.contract_version !== OPERATIONAL_ACTIVITY_CONTRACT_VERSION) problems.push('contract_version invalid');
  if (!Array.isArray(obj.items)) problems.push('items must be an array');
  else {
    const seen = new Set();
    for (const item of obj.items) {
      if (!isObj(item)) { problems.push('item is not an object'); continue; }
      if (!isStr(item.event_id) || !item.event_id) problems.push('item.event_id missing');
      else if (seen.has(item.event_id)) problems.push(`duplicate event_id ${item.event_id}`);
      if (seen.has(item.event_id) === false && item.event_id) seen.add(item.event_id);
      if (!VALID_TYPES.has(item.type)) problems.push(`item.type invalid: ${item.type}`);
      if (!VALID_SEVERITY.has(item.severity)) problems.push(`item.severity invalid: ${item.severity}`);
      if (!isStr(item.title)) problems.push('item.title missing');
      if (!isStr(item.occurred_at)) problems.push('item.occurred_at missing');
      if (!isStr(item.received_at)) problems.push('item.received_at missing');
    }
  }
  if (typeof obj.has_more !== 'boolean') problems.push('has_more must be boolean');
  if (typeof obj.total !== 'number') problems.push('total must be number');
  return problems;
}

module.exports = {
  OPERATIONAL_ACTIVITY_CONTRACT_VERSION,
  FEED_WINDOW_DAYS,
  LIMIT_DEFAULT,
  LIMIT_MAX,
  SEVERITY,
  buildFeedItems,
  paginate,
  buildOperationalActivity,
  validateOperationalActivity,
};
