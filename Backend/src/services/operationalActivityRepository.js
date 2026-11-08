// src/services/operationalActivityRepository.js
// Task 218 — thin, tenant-scoped I/O layer for the operational activity feed.
//
// Invariants mirror businessHealthRepository.js: tenant + store scoped (store
// resolved by id + organization_id from the authenticated membership; a
// cross-tenant / unknown store id -> null -> 404), efficient + bounded (each
// source is one bounded findMany, run in parallel, no N+1), graceful partial
// responses (each source degrades to an empty list on failure), no secrets
// (only closed enums / domain names / reason codes / timestamps are read).

'use strict';

const { FEED_WINDOW_DAYS } = require('./operationalActivity');

const DAY_MS = 24 * 3600 * 1000;
// Bound the raw fetch well above the largest reasonable page; the pure builder
// then windows, dedupes, and paginates.
const MAX_FETCH = 500;

async function safe(promise, fallback) {
  try {
    const value = await promise;
    return Array.isArray(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Fetch the operational-activity bundle for ONE tenant-scoped store.
 * Returns null when the store id does not belong to the organization.
 */
async function fetchOperationalActivityBundle(prisma, organizationId, storeId, now = new Date()) {
  if (!organizationId) throw new Error('Authenticated organization is required');
  const nowD = now instanceof Date ? now : new Date(now);

  const store = await prisma.stores.findFirst({
    where: { id: storeId, organization_id: organizationId },
    select: { id: true, organization_id: true, shop_domain: true },
  });
  if (!store) return null;

  const since = new Date(nowD.getTime() - FEED_WINDOW_DAYS * DAY_MS - DAY_MS);

  const [findings, lifecycle, syncDomains] = await Promise.all([
    safe(prisma.intelligence_findings.findMany({
      where: { store_id: store.id, organization_id: organizationId, detected_at: { gte: since } },
      orderBy: { detected_at: 'desc' },
      take: MAX_FETCH,
      select: {
        id: true, type: true, severity: true, status: true, title: true, description: true,
        dedupe_key: true, detected_at: true, updated_at: true,
      },
    }), []),
    safe(prisma.integration_lifecycle_events.findMany({
      where: { store_id: store.id, observed_at: { gte: since } },
      orderBy: { observed_at: 'desc' },
      take: MAX_FETCH,
      select: {
        id: true, event_type: true, from_state: true, to_state: true, reason_code: true,
        source: true, event_reference: true, capability: true, observed_at: true, created_at: true,
      },
    }), []),
    // All sync domains for the store (bounded: a fixed, small set of domains).
    safe(prisma.store_sync_domain_states.findMany({
      where: { store_id: store.id },
      select: {
        domain: true, status: true, last_attempted_at: true, last_succeeded_at: true,
        error_code: true, retry_count: true, updated_at: true,
      },
    }), []),
  ]);

  return { store, findings, lifecycle, syncDomains };
}

module.exports = { fetchOperationalActivityBundle };
