'use strict';

const crypto = require('crypto');
const { prisma: defaultDb } = require('../configs/database');
const { shopifyGraphql } = require('./shopifyGraphql');
const shopify = require('./shopifyProductAction');
const { getAuthorizedResource } = require('./authorizedResourceCatalog');
const { getResource } = require('./resourceRegistry');
const { CommerceActionError } = require('./commerceActionPolicy');
const { organizationStore } = require('./merchantCapabilityService');
const ledger = require('./syncDomainState');

const MAX_PAGE_BYTES = 4 * 1024 * 1024;

function requiredScopes(resourceId) {
  const registry = getResource(resourceId);
  const document = getAuthorizedResource(resourceId);
  return [...new Set([...(registry?.scopes || []), ...(document?.scopes || [])])];
}
function scopeSatisfied(granted, required) {
  return granted.includes(required) || (required.startsWith('read_') && granted.includes(`write_${required.slice(5)}`));
}
async function authorize(store, resourceId, graphql, grantedScopes = null) {
  const granted = grantedScopes || await shopify.liveScopes(store, graphql);
  const missing = requiredScopes(resourceId).filter(scope => !scopeSatisfied(granted, scope));
  if (missing.length) throw new CommerceActionError('REQUIRED_SCOPE_NOT_GRANTED', `The live Shopify installation is missing required scope(s): ${missing.join(', ')}.`, 403);
  return granted;
}
function validatePage(page, root) {
  const connection = page?.[root];
  if (!connection || !Array.isArray(connection.nodes) || typeof connection.pageInfo?.hasNextPage !== 'boolean') {
    throw new CommerceActionError('RESOURCE_RESPONSE_INVALID', `Shopify returned an invalid ${root} connection.`, 502);
  }
  if (connection.pageInfo.hasNextPage && !connection.pageInfo.endCursor) {
    throw new CommerceActionError('RESOURCE_PAGINATION_STALLED', 'Shopify indicated another page without a cursor.', 502);
  }
  return connection;
}
function validateNestedConnections(value, depth = 0) {
  if (depth > 12 || value == null || typeof value !== 'object') return;
  if (Array.isArray(value.nodes) && value.pageInfo) {
    if (value.pageInfo.hasNextPage) throw new CommerceActionError('NESTED_PAGINATION_INCOMPLETE', 'A nested resource connection exceeded the bounded page. Full sync requires nested pagination before coverage can be certified.');
    for (const child of value.nodes) validateNestedConnections(child, depth + 1);
    return;
  }
  for (const child of Object.values(value)) validateNestedConnections(child, depth + 1);
}
async function completeNestedConnections(store, resourceId, nodes, graphql) {
  const document = getAuthorizedResource(resourceId);
  const execute = graphql || shopifyGraphql;
  async function walk(parent, path = '', rootRecord = parent) {
    if (!parent || typeof parent !== 'object' || Array.isArray(parent)) return;
    for (const [key, value] of Object.entries(parent)) {
      const childPath = path ? `${path}.${key}` : key;
      if (value && Array.isArray(value.nodes) && value.pageInfo) {
        if (value.pageInfo.hasNextPage) {
          const spec = document.nested?.[childPath];
          const sourceParent = spec?.rootParent ? rootRecord : parent;
          const parentType = spec?.parentType || sourceParent.__typename;
          const concreteType = spec?.concreteType ? parent.__typename : null;
          if (!spec || !sourceParent.id || !/^[A-Za-z][A-Za-z0-9]*$/.test(parentType || '') || (spec.concreteType && !/^[A-Za-z][A-Za-z0-9]*$/.test(concreteType || ''))) {
            throw new CommerceActionError('NESTED_PAGINATION_INCOMPLETE', `No complete reader exists for nested connection ${resourceId}:${childPath}.`);
          }
          const cursors = new Set();
          while (value.pageInfo.hasNextPage) {
            const after = value.pageInfo.endCursor;
            if (!after || cursors.has(after)) throw new CommerceActionError('RESOURCE_PAGINATION_STALLED', `Nested connection ${childPath} repeated or omitted a cursor.`, 502);
            cursors.add(after);
            const connectionSelection = `${spec.field}(first: $first, after: $after) { nodes { ${spec.selection} } ${require('./authorizedResourceCatalog').PAGE} }`;
            const selection = spec.connectionPath
              ? `${spec.connectionPath} { ... on ${concreteType} { ${connectionSelection} } }`
              : connectionSelection;
            const query = `query RevlumaNested_${parentType}_${spec.field}($id: ID!, $first: Int!, $after: String) { node(id: $id) { ... on ${parentType} { ${selection} } } }`;
            const data = await execute(store, query, { id: sourceParent.id, first: 100, after });
            const next = spec.connectionPath ? data?.node?.[spec.connectionPath]?.[spec.field] : data?.node?.[spec.field];
            if (!next || !Array.isArray(next.nodes) || typeof next.pageInfo?.hasNextPage !== 'boolean') {
              throw new CommerceActionError('RESOURCE_RESPONSE_INVALID', `Shopify returned an invalid nested ${childPath} connection.`, 502);
            }
            value.nodes.push(...next.nodes);
            value.pageInfo = next.pageInfo;
          }
        }
        for (const child of value.nodes) await walk(child, childPath, rootRecord);
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        await walk(value, childPath, rootRecord);
      }
    }
  }
  for (const record of nodes) await walk(record);
  return nodes;
}
function boundedNodes(nodes) {
  const serialized = JSON.stringify(nodes);
  if (Buffer.byteLength(serialized) > MAX_PAGE_BYTES) throw new CommerceActionError('RESOURCE_RESPONSE_TOO_LARGE', 'The resource page exceeded the 4 MiB safety boundary. Narrow the query before retrying.', 502);
  for (const item of nodes) validateNestedConnections(item);
  return nodes;
}
function sourceId(resourceId, value) {
  if (resourceId === 'shop.policies') return String(value.type || '');
  if (resourceId === 'shop.taxes') return 'SHOP';
  return String(value.id || '');
}
async function readPage(store, resourceId, options, graphql) {
  const document = getAuthorizedResource(resourceId);
  const data = await (graphql || shopifyGraphql)(store, document.query, { first: options.first, after: options.after || null, ...(document.variables || {}) });
  if (document.singleton) {
    const values = document.map(data?.[document.root]);
    if (!Array.isArray(values)) throw new CommerceActionError('RESOURCE_RESPONSE_INVALID', 'Shopify returned an invalid singleton resource.', 502);
    await completeNestedConnections(store, resourceId, values, graphql);
    return { records: boundedNodes(values), page_info: { has_next_page: false, end_cursor: null } };
  }
  const connection = validatePage(data, document.root);
  const records = connection.nodes.map(document.map);
  await completeNestedConnections(store, resourceId, records, graphql);
  return { records: boundedNodes(records), page_info: { has_next_page: connection.pageInfo.hasNextPage, end_cursor: connection.pageInfo.endCursor || null } };
}
function pagination(query = {}) {
  const first = query.first === undefined ? 50 : Number(query.first);
  if (!Number.isInteger(first) || first < 1 || first > 100) throw new CommerceActionError('INVALID_RESOURCE_PAGE_SIZE', 'first must be an integer from 1 to 100.', 400);
  const after = query.after == null || query.after === '' ? null : String(query.after);
  if (after && after.length > 2000) throw new CommerceActionError('INVALID_RESOURCE_CURSOR', 'Resource cursor is invalid.', 400);
  return { first, after };
}
async function getAuthorizedResourcePage(storeId, organizationId, resourceId, query, deps = {}) {
  const document = getAuthorizedResource(resourceId);
  if (!document || !getResource(resourceId)) throw new CommerceActionError('RESOURCE_NOT_IMPLEMENTED', 'This resource is not implemented by the authorized-data gateway.', 404);
  const store = await organizationStore(deps.db || defaultDb, storeId, organizationId);
  await authorize(store, resourceId, deps.graphql);
  const result = await readPage(store, resourceId, pagination(query), deps.graphql);
  return { resource_id: resourceId, ...result, coverage: { implementation: 'implemented_unverified', persisted: false, source: 'shopify_live' } };
}
async function streamAll(store, resourceId, graphql, onPage) {
  const document = getAuthorizedResource(resourceId);
  const cursors = new Set();
  let after = null;
  let pagesCompleted = 0;
  let discovered = 0;
  do {
    if (after && cursors.has(after)) throw new CommerceActionError('RESOURCE_PAGINATION_STALLED', 'Shopify repeated a pagination cursor; the inactive run was not activated.');
    if (after) cursors.add(after);
    const page = await readPage(store, resourceId, { first: 100, after }, graphql);
    for (const record of page.records) {
      if (!sourceId(resourceId, record)) throw new CommerceActionError('RESOURCE_DUPLICATE_OR_MISSING_ID', 'Shopify returned a missing resource id; the inactive run was not activated.', 502);
    }
    await onPage(page.records, pagesCompleted + 1);
    discovered += page.records.length;
    pagesCompleted += 1;
    after = page.page_info.has_next_page ? page.page_info.end_cursor : null;
    if (document.singleton) after = null;
  } while (after);
  return { discovered, pagesCompleted };
}
async function fetchAll(store, resourceId, graphql) {
  const records = [];
  const result = await streamAll(store, resourceId, graphql, async page => { records.push(...page); });
  return { records, pagesCompleted: result.pagesCompleted };
}
function hashPayload(payload) { return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex'); }

async function syncAuthorizedResource(storeId, organizationId, resourceId, deps = {}) {
  const db = deps.db || defaultDb;
  if (!getAuthorizedResource(resourceId) || !getResource(resourceId)) throw new CommerceActionError('RESOURCE_NOT_IMPLEMENTED', 'This resource is not implemented by the authorized-data gateway.', 404);
  const store = await organizationStore(db, storeId, organizationId);
  await authorize(store, resourceId, deps.graphql, deps.grantedScopes);
  const syncLedger = deps.ledger || ledger;
  await syncLedger.beginAttempt(store.id, resourceId, db);
  const runId = crypto.randomUUID();
  try {
    // A store-level distributed sync lock prevents concurrent runs. Remove only
    // abandoned staging rows; the active snapshot remains readable throughout.
    await db.commerce_resource_records.deleteMany({ where: { store_id: store.id, resource_id: resourceId, active: false } });
    const now = new Date();
    const { discovered, pagesCompleted } = await streamAll(store, resourceId, deps.graphql, async records => {
      if (!records.length) return;
      await db.commerce_resource_records.createMany({ data: records.map(record => ({
        store_id: store.id, resource_id: resourceId, source_id: sourceId(resourceId, record), payload: record,
        content_hash: hashPayload(record), sync_run_id: runId, synced_at: now, active: false,
      })) });
    });
    let deleted = 0;
    await db.$transaction(async tx => {
      if (typeof tx.$queryRaw === 'function') {
        const rows = await tx.$queryRaw`SELECT COUNT(*)::int AS count FROM "commerce_resource_records" old WHERE old."store_id" = ${store.id}::uuid AND old."resource_id" = ${resourceId} AND old."active" = true AND NOT EXISTS (SELECT 1 FROM "commerce_resource_records" staged WHERE staged."store_id" = old."store_id" AND staged."resource_id" = old."resource_id" AND staged."sync_run_id" = ${runId}::uuid AND staged."source_id" = old."source_id")`;
        deleted = Number(rows[0]?.count || 0);
      } else {
        const [active, staged] = await Promise.all([
          tx.commerce_resource_records.findMany({ where: { store_id: store.id, resource_id: resourceId, active: true }, select: { source_id: true } }),
          tx.commerce_resource_records.findMany({ where: { store_id: store.id, resource_id: resourceId, sync_run_id: runId }, select: { source_id: true } }),
        ]);
        const incoming = new Set(staged.map(row => row.source_id));
        deleted = active.filter(row => !incoming.has(row.source_id)).length;
      }
      await tx.commerce_resource_records.deleteMany({ where: { store_id: store.id, resource_id: resourceId, active: true } });
      await tx.commerce_resource_records.updateMany({ where: { store_id: store.id, resource_id: resourceId, sync_run_id: runId }, data: { active: true } });
    });
    const persisted = await db.commerce_resource_records.count({ where: { store_id: store.id, resource_id: resourceId, sync_run_id: runId, active: true } });
    if (persisted !== discovered) throw new CommerceActionError('RESOURCE_RECONCILIATION_FAILED', 'Active resource count did not match the complete staged source result.');
    const report = { discovered, inserted: discovered, updated: 0, deleted, pagesCompleted, paginationComplete: true };
    await syncLedger.recordSuccess(store.id, resourceId, report, db);
    await syncLedger.mergeCheckpoint(store.id, resourceId, { reconciliation: { missing: 0, duplicates: 0, mapping_errors: 0, last_run_at: now.toISOString() }, sync_run_id: runId, streaming: true }, db);
    return { resource_id: resourceId, sync_run_id: runId, discovered, persisted, deleted, pagination_complete: true, reconciliation: { missing: 0, duplicates: 0, mapping_errors: 0 } };
  } catch (cause) {
    const error = cause?.code === 'P2002'
      ? new CommerceActionError('RESOURCE_DUPLICATE_OR_MISSING_ID', 'Shopify returned a duplicate resource id; the inactive run was not activated.', 502)
      : cause;
    try { await db.commerce_resource_records.deleteMany({ where: { store_id: store.id, resource_id: resourceId, sync_run_id: runId, active: false } }); } catch { /* Preserve the original sync failure. */ }
    await syncLedger.recordFailure(store.id, resourceId, error, {}, db);
    throw error;
  }
}

// Domain-level retry policy. A failed domain is re-attempted on later passes
// with exponential backoff (one sync interval doubling to six hours) instead
// of on every pass, so one broken resource cannot burn the Shopify rate budget
// of the whole store. It is never abandoned: at the cap it keeps retrying, and
// after DEAD_LETTER_THRESHOLD consecutive failures it is escalated.
const DOMAIN_BACKOFF_BASE_MS = 15 * 60 * 1000;

function domainRetryDue(row, now) {
  if (!row || !['failed', 'degraded'].includes(row.status)) return { due: true, nextAt: null };
  const retries = Number(row.retry_count) || 0;
  const since = row.last_checked_at || row.last_attempted_at;
  if (retries < 1 || !since) return { due: true, nextAt: null };
  const { backoffMs } = require('./syncSupervisor');
  // Deterministic (no jitter): a domain's next attempt must be reproducible
  // by the data-health engine from the persisted row.
  const nextAt = new Date(new Date(since).getTime() + backoffMs(retries, { random: () => 0.5, baseMs: DOMAIN_BACKOFF_BASE_MS }));
  return { due: nextAt.getTime() <= now.getTime(), nextAt };
}

// Keep the store's recorded grant equal to Shopify's live answer, so data
// health and the permission registry never reason from a stale scope list.
// authorization_verified_at is backfilled only when missing, and is set to the
// moment the scope check was issued: a later uninstall therefore always
// post-dates it and is never rejected as stale by the lifecycle state machine.
async function recordLiveScopes(db, store, grantedScopes, checkedAt) {
  try {
    const { missingRequiredScopes } = require('./shopifyAuthorization');
    const scopes = [...new Set(grantedScopes)].sort().join(',');
    await db.stores.updateMany({ where: { id: store.id }, data: { granted_scopes: scopes } });
    if (missingRequiredScopes(new Set(grantedScopes)).length === 0) {
      await db.stores.updateMany({
        where: { id: store.id, authorization_verified_at: null },
        data: { authorization_verified_at: checkedAt },
      });
    }
  } catch (error) {
    require('../utils/logger').warn('shopify_live_scopes_unrecorded', { store_id: store.id, error_type: error?.code || error?.name });
  }
}

async function syncAuthorizedResources(store, deps = {}) {
  const { authorizedResourceIds } = require('./authorizedResourceCatalog');
  const { domainAccess } = require('./permissionRegistry');
  const supervisor = require('./syncSupervisor');
  const db = deps.db || defaultDb;
  const syncLedger = deps.ledger || ledger;
  const now = deps.now ? new Date(deps.now) : new Date();
  const checkedAt = new Date();
  const grantedScopes = await shopify.liveScopes(store, deps.graphql);
  if (!deps.skipScopePersistence) await recordLiveScopes(db, store, grantedScopes, checkedAt);
  if (typeof syncLedger.retireUnsyncedDomains === 'function') await syncLedger.retireUnsyncedDomains(store.id, db);
  let ledgerRows = [];
  try {
    ledgerRows = await db.store_sync_domain_states.findMany({
      where: { store_id: store.id },
      select: { domain: true, status: true, retry_count: true, last_checked_at: true, last_attempted_at: true },
    });
  } catch { ledgerRows = []; } // unreadable ledger: attempt everything rather than skip
  const rowByDomain = new Map(ledgerRows.map(row => [row.domain, row]));
  const results = [];
  for (const resourceId of authorizedResourceIds()) {
    const access = domainAccess(resourceId, grantedScopes);
    if (access.state !== 'granted') {
      // Recorded, never silently skipped: the ledger and data health must say
      // exactly why this domain has no data. Re-evaluated every pass, so an
      // approved reauthorization resumes the domain automatically.
      await syncLedger.recordBlocked(store.id, resourceId, {
        kind: access.state, missingScopes: access.missing_scopes, reason: access.reason,
      }, db);
      results.push({ resource_id: resourceId, status: access.state, missing_scopes: access.missing_scopes, capability: access.capability });
      continue;
    }
    const retry = domainRetryDue(rowByDomain.get(resourceId), now);
    if (!retry.due) {
      results.push({ resource_id: resourceId, status: 'backoff', next_attempt_at: retry.nextAt.toISOString() });
      continue;
    }
    try {
      const result = await syncAuthorizedResource(store.id, store.organization_id, resourceId, { ...deps, grantedScopes });
      results.push({ resource_id: resourceId, status: 'ok', discovered: result.discovered, reconciliation: result.reconciliation });
      try { await supervisor.resolveDeadLetter(db, 'sync_domain', `${store.id}:${resourceId}`, 'recovered'); } catch { /* escalation bookkeeping only */ }
    } catch (error) {
      const code = error.code || error.name || 'resource_sync_failed';
      results.push({ resource_id: resourceId, status: 'failed', error_code: code });
      const attempts = (Number(rowByDomain.get(resourceId)?.retry_count) || 0) + 1;
      if (attempts >= supervisor.DEAD_LETTER_THRESHOLD) {
        try {
          const { classifyFailure } = require('./syncStateContract');
          await supervisor.openDeadLetter(db, {
            kind: 'sync_domain', subjectKey: `${store.id}:${resourceId}`, storeId: store.id,
            failureClass: classifyFailure(code, error.message), errorCode: String(code).slice(0, 120), attempts,
            nextRetryAt: domainRetryDue({ status: 'failed', retry_count: attempts, last_checked_at: new Date() }, new Date()).nextAt,
            detail: { domain: resourceId },
          });
        } catch { /* escalation bookkeeping only */ }
      }
    }
  }
  const count = status => results.filter(row => row.status === status).length;
  return {
    results,
    succeeded: count('ok'),
    failed: count('failed'),
    missing_scope: count('missing_scope'),
    unsupported: count('unsupported') + count('plan_restricted'),
    backoff: count('backoff'),
  };
}

module.exports = { getAuthorizedResourcePage, syncAuthorizedResource, syncAuthorizedResources, domainRetryDue, DOMAIN_BACKOFF_BASE_MS, requiredScopes, scopeSatisfied, validateNestedConnections, completeNestedConnections, streamAll, fetchAll, sourceId };
