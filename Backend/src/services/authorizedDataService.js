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

async function syncAuthorizedResources(store, deps = {}) {
  const { authorizedResourceIds } = require('./authorizedResourceCatalog');
  const grantedScopes = await shopify.liveScopes(store, deps.graphql);
  const results = [];
  for (const resourceId of authorizedResourceIds()) {
    const missing = requiredScopes(resourceId).filter(scope => !scopeSatisfied(grantedScopes, scope));
    if (missing.length) {
      results.push({ resource_id: resourceId, status: 'missing_scope', missing_scopes: missing });
      continue;
    }
    try {
      const result = await syncAuthorizedResource(store.id, store.organization_id, resourceId, { ...deps, grantedScopes });
      results.push({ resource_id: resourceId, status: 'ok', discovered: result.discovered, reconciliation: result.reconciliation });
    } catch (error) {
      results.push({ resource_id: resourceId, status: 'failed', error_code: error.code || error.name || 'resource_sync_failed' });
    }
  }
  return { results, succeeded: results.filter(row => row.status === 'ok').length, failed: results.filter(row => row.status === 'failed').length, missing_scope: results.filter(row => row.status === 'missing_scope').length };
}

module.exports = { getAuthorizedResourcePage, syncAuthorizedResource, syncAuthorizedResources, requiredScopes, scopeSatisfied, validateNestedConnections, completeNestedConnections, streamAll, fetchAll, sourceId };
