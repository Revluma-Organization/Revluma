'use strict';

// Inventory & Locations acquisition (Admin GraphQL 2026-10).
//
// A snapshot is certified only after every outer and nested connection ends
// explicitly with hasNextPage=false. Acquisition completes before persistence;
// writes are bounded independent upserts (no long interactive transaction).
// Any cursor, shape, API, or database failure prevents stale-record deletion
// and produces a failed/degraded ledger state rather than a partial success.

const { prisma } = require('../configs/database');
const logger = require('../utils/logger');
const {
  beginAttempt,
  recordSuccess,
  recordFailure,
  recordDegraded,
} = require('./syncDomainState');
const { shopifyGraphql } = require('./shopifyGraphql');

const PAGE_SIZE = 100;
const MAX_ITEM_PAGES = 200; // 20k inventory items; exceeding this is a loud failure
const MAX_LEVEL_PAGES = 200; // per inventory item; independent loud ceiling

function externalId(gid) { return String(gid || '').split('/').pop(); }
function toBool(v) { return v === true ? true : v === false ? false : null; }
function toNum(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function toTs(v) { const d = v ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d : null; }

const LOCATIONS_QUERY = `query RevlumaLocations($first: Int!, $after: String) {
  locations(first: $first, after: $after) {
    nodes {
      id name isActive
      address { address1 city zip countryCode provinceCode }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

const INVENTORY_ITEMS_QUERY = `query RevlumaInventoryItems($first: Int!, $after: String) {
  inventoryItems(first: $first, after: $after) {
    nodes {
      id sku tracked requiresShipping
      measurement { weight { value unit } }
      createdAt updatedAt
      inventoryLevels(first: 100) {
        nodes {
          location { id }
          quantities(names: ["available", "on_hand", "committed", "incoming", "reserved", "damaged", "safety_stock", "quality_control"]) { name quantity }
          updatedAt
        }
        pageInfo { hasNextPage endCursor }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

const INVENTORY_LEVELS_PAGE_QUERY = `query RevlumaInventoryItemLevels($id: ID!, $first: Int!, $after: String) {
  node(id: $id) {
    ... on InventoryItem {
      id
      inventoryLevels(first: $first, after: $after) {
        nodes { location { id } quantities(names: ["available", "on_hand", "committed", "incoming", "reserved", "damaged", "safety_stock", "quality_control"]) { name quantity } updatedAt }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

function accessDenied(error, pattern) {
  return error?.code === 'SHOPIFY_GRAPHQL_ERROR' &&
    Array.isArray(error.shopifyErrors) &&
    error.shopifyErrors.some(item =>
      Array.isArray(item.codes) && item.codes.includes('ACCESS_DENIED') &&
      new RegExp(pattern, 'i').test(String(item.message || '')));
}

function syncError(code, message, { pagesCompleted = 0, discovered = 0 } = {}) {
  const error = new Error(message);
  error.code = code;
  error.pages_completed = pagesCompleted;
  error.discovered = discovered;
  return error;
}

// Validates both termination and progress. Shopify must explicitly say that no
// next page exists; a missing cursor is never interpreted as end-of-connection.
function pageProgress(connection, label, seenCursors, pagesCompleted, discovered) {
  if (!connection || !Array.isArray(connection.nodes) ||
      !connection.pageInfo || typeof connection.pageInfo.hasNextPage !== 'boolean') {
    throw syncError('SHOPIFY_INVENTORY_SHAPE_UNRESOLVABLE', `inventory_shape_unresolvable:${label}`, { pagesCompleted, discovered });
  }
  if (!connection.pageInfo.hasNextPage) return null;
  const cursor = connection.pageInfo.endCursor;
  if (typeof cursor !== 'string' || !cursor.trim()) {
    throw syncError('SHOPIFY_INVENTORY_CURSOR_INVALID', `inventory_cursor_missing:${label}`, { pagesCompleted, discovered });
  }
  if (seenCursors.has(cursor)) {
    throw syncError('SHOPIFY_INVENTORY_CURSOR_REPEATED', `inventory_cursor_repeated:${label}`, { pagesCompleted, discovered });
  }
  seenCursors.add(cursor);
  return cursor;
}

async function fetchAll(store, query, rootKey, maxPages = MAX_ITEM_PAGES) {
  const nodes = [];
  const seenCursors = new Set();
  let after = null;
  let pages = 0;
  while (pages < maxPages) {
    let data;
    try {
      data = await shopifyGraphql(store, query, { first: PAGE_SIZE, after });
    } catch (error) {
      error.pages_completed = pages;
      error.discovered = nodes.length;
      throw error;
    }
    const connection = data?.[rootKey];
    after = pageProgress(connection, rootKey, seenCursors, pages, nodes.length);
    nodes.push(...connection.nodes);
    pages += 1;
    if (!after) return { nodes, complete: true, pagesCompleted: pages };
  }
  throw syncError('SHOPIFY_INVENTORY_PAGE_CEILING', `inventory_page_ceiling:${rootKey}`, { pagesCompleted: pages, discovered: nodes.length });
}

async function fetchAllInventoryLevels(store, inventoryItemGid, firstPage, maxPages = MAX_LEVEL_PAGES) {
  const levels = [];
  const seenCursors = new Set();
  let pages = 0;
  let connection = firstPage;
  let after = null;
  while (pages < maxPages) {
    after = pageProgress(connection, `inventoryLevels:${externalId(inventoryItemGid)}`, seenCursors, pages, levels.length);
    levels.push(...connection.nodes);
    pages += 1;
    if (!after) return { levels, complete: true, pagesCompleted: pages };
    let data;
    try {
      data = await shopifyGraphql(store, INVENTORY_LEVELS_PAGE_QUERY, {
        id: inventoryItemGid, first: PAGE_SIZE, after,
      });
    } catch (error) {
      error.pages_completed = pages;
      error.discovered = levels.length;
      throw error;
    }
    connection = data?.node?.inventoryLevels;
  }
  throw syncError('SHOPIFY_INVENTORY_LEVELS_PAGE_CEILING', `inventory_levels_page_ceiling:${externalId(inventoryItemGid)}`, { pagesCompleted: pages, discovered: levels.length });
}

function requireSourceId(value, code, label) {
  if (typeof value !== 'string' || !value || !externalId(value)) {
    throw syncError(code, label);
  }
  return externalId(value);
}

function mapLevelRow(storeId, itemExternalId, level) {
  const locationGid = requireSourceId(level?.location?.id, 'SHOPIFY_INVENTORY_LEVEL_LOCATION_MISSING', `inventory_level_location_missing:${itemExternalId}`);
  if (!Array.isArray(level?.quantities)) {
    throw syncError('SHOPIFY_INVENTORY_QUANTITIES_INVALID', `inventory_quantities_invalid:${itemExternalId}`);
  }
  const quantities = {};
  for (const quantity of level.quantities) {
    if (!quantity || typeof quantity.name !== 'string' || toNum(quantity.quantity) === null) {
      throw syncError('SHOPIFY_INVENTORY_QUANTITIES_INVALID', `inventory_quantities_invalid:${itemExternalId}`);
    }
    quantities[quantity.name] = toNum(quantity.quantity);
  }
  return {
    store_id: storeId,
    inventory_item_external_id: itemExternalId,
    location_external_id: locationGid,
    quantities,
    synced_at: new Date(),
  };
}

async function existingKeys(db, table, storeId, field, values) {
  if (!values.length) return new Set();
  const rows = await db[table].findMany({
    where: { store_id: storeId, [field]: { in: values } },
    select: { [field]: true },
  });
  return new Set(rows.map(row => row[field]));
}

async function syncLocations(store, db = prisma) {
  await beginAttempt(store.id, 'locations', db);
  const fetched = await fetchAll(store, LOCATIONS_QUERY, 'locations');
  const rows = fetched.nodes.map(node => ({
    store_id: store.id,
    external_id: requireSourceId(node.id, 'SHOPIFY_LOCATION_ID_MISSING', 'location_id_missing'),
    name: node.name ?? null,
    is_active: toBool(node.isActive),
    country_code: node.address?.countryCode ?? null,
    province_code: node.address?.provinceCode ?? null,
    address1: node.address?.address1 ?? null,
    city: node.address?.city ?? null,
    zip: node.address?.zip ?? null,
    synced_at: new Date(),
  }));
  const before = await existingKeys(db, 'locations', store.id, 'external_id', rows.map(row => row.external_id));
  let deleted = 0;
  for (const row of rows) {
    await db.locations.upsert({
      where: { store_id_external_id: { store_id: row.store_id, external_id: row.external_id } },
      update: row,
      create: row,
    });
  }
  if (fetched.complete) {
    const seen = rows.map(row => row.external_id);
    const result = await db.locations.deleteMany({
      where: { store_id: store.id, external_id: { notIn: seen.length ? seen : ['__none__'] } },
    });
    deleted = result.count;
  }
  const inserted = rows.filter(row => !before.has(row.external_id)).length;
  const report = {
    discovered: rows.length, inserted, updated: rows.length - inserted, deleted,
    paginationComplete: fetched.complete, pagesCompleted: fetched.pagesCompleted,
  };
  await recordSuccess(store.id, 'locations', report, db);
  logger.info('shopify_locations_sync_completed', { store_id: store.id, ...report });
  return { count: rows.length, deleted, pagesCompleted: fetched.pagesCompleted };
}

async function syncInventory(store, db = prisma) {
  await beginAttempt(store.id, 'inventory', db);
  const fetched = await fetchAll(store, INVENTORY_ITEMS_QUERY, 'inventoryItems');
  const itemRows = [];
  const levelRows = [];
  let nestedPages = 0;

  // Finish ALL source reads before any writes. An item is not eligible for
  // persistence until its own nested levels connection is complete.
  for (const node of fetched.nodes) {
    const ext = requireSourceId(node?.id, 'SHOPIFY_INVENTORY_ITEM_ID_MISSING', 'inventory_item_id_missing');
    const levels = await fetchAllInventoryLevels(store, node.id, node.inventoryLevels);
    nestedPages += levels.pagesCompleted;
    itemRows.push({
      store_id: store.id,
      external_id: ext,
      sku: node.sku ?? null,
      tracked: toBool(node.tracked),
      requires_shipping: toBool(node.requiresShipping),
      weight: node.measurement?.weight?.value != null && Number.isFinite(Number(node.measurement.weight.value)) ? String(node.measurement.weight.value) : null,
      weight_unit: node.measurement?.weight ? String(node.measurement.weight.unit || '').toLowerCase() || null : null,
      created_at: toTs(node.createdAt),
      updated_at: toTs(node.updatedAt),
      synced_at: new Date(),
    });
    for (const level of levels.levels) levelRows.push(mapLevelRow(store.id, ext, level));
  }

  const existingItems = await existingKeys(db, 'inventory_items', store.id, 'external_id', itemRows.map(row => row.external_id));
  const levelKeys = levelRows.map(row => `${row.inventory_item_external_id}|${row.location_external_id}`);
  const existingLevels = await db.inventory_levels.findMany({
    where: { store_id: store.id },
    select: { id: true, inventory_item_external_id: true, location_external_id: true },
  });
  const existingLevelKeys = new Set(existingLevels.map(row => `${row.inventory_item_external_id}|${row.location_external_id}`));

  // Bounded independent statements avoid P2028. A database error leaves the
  // domain failed; a later complete run heals partial writes and reconciles.
  for (const row of itemRows) {
    await db.inventory_items.upsert({
      where: { store_id_external_id: { store_id: row.store_id, external_id: row.external_id } },
      update: row,
      create: row,
    });
  }
  for (const row of levelRows) {
    await db.inventory_levels.upsert({
      where: { store_id_inventory_item_external_id_location_external_id: {
        store_id: row.store_id,
        inventory_item_external_id: row.inventory_item_external_id,
        location_external_id: row.location_external_id,
      } },
      update: { quantities: row.quantities, synced_at: row.synced_at },
      create: row,
    });
  }

  let deletedItems = 0;
  let deletedLevels = 0;
  if (fetched.complete) {
    const seenLevelKeys = new Set(levelKeys);
    const staleLevelIds = existingLevels
      .filter(row => !seenLevelKeys.has(`${row.inventory_item_external_id}|${row.location_external_id}`))
      .map(row => row.id);
    if (staleLevelIds.length) {
      const result = await db.inventory_levels.deleteMany({ where: { store_id: store.id, id: { in: staleLevelIds } } });
      deletedLevels = result.count;
    }
    const seenItems = itemRows.map(row => row.external_id);
    const result = await db.inventory_items.deleteMany({
      where: { store_id: store.id, external_id: { notIn: seenItems.length ? seenItems : ['__none__'] } },
    });
    deletedItems = result.count;
  }

  const insertedItems = itemRows.filter(row => !existingItems.has(row.external_id)).length;
  const insertedLevels = levelKeys.filter(key => !existingLevelKeys.has(key)).length;
  const pagesCompleted = fetched.pagesCompleted + nestedPages;
  const report = {
    discovered: itemRows.length,
    inserted: insertedItems + insertedLevels,
    updated: (itemRows.length - insertedItems) + (levelRows.length - insertedLevels),
    deleted: deletedItems + deletedLevels,
    paginationComplete: fetched.complete,
    pagesCompleted,
  };
  await recordSuccess(store.id, 'inventory', report, db);
  logger.info('shopify_inventory_sync_completed', {
    store_id: store.id, ...report, item_pages: fetched.pagesCompleted,
    nested_level_pages: nestedPages, levels_discovered: levelRows.length,
  });
  return {
    items: itemRows.length, levels: levelRows.length, deletedItems, deletedLevels,
    inserted: report.inserted, updated: report.updated, pagesCompleted,
  };
}

async function syncInventoryAndLocations(store, db = prisma) {
  let locations = null;
  let inventory = null;
  try {
    locations = await syncLocations(store, db);
  } catch (error) {
    if (accessDenied(error, 'locations?')) {
      await recordDegraded(store.id, 'locations', 'SHOPIFY_LOCATIONS_ACCESS_DENIED', { pagesCompleted: error.pages_completed }, db);
      logger.warn('shopify_locations_sync_permission_limited', { store_id: store.id, reason: 'SHOPIFY_LOCATIONS_ACCESS_DENIED' });
    } else {
      await recordFailure(store.id, 'locations', error, { pagesCompleted: error.pages_completed, discovered: error.discovered }, db);
      logger.error('shopify_locations_sync_failed', { store_id: store.id, error_type: error?.code || error?.name, pages_completed: error?.pages_completed ?? null });
    }
  }
  try {
    inventory = await syncInventory(store, db);
  } catch (error) {
    if (accessDenied(error, 'inventor(y|ies)')) {
      await recordDegraded(store.id, 'inventory', 'SHOPIFY_INVENTORY_ACCESS_DENIED', { pagesCompleted: error.pages_completed }, db);
      logger.warn('shopify_inventory_sync_permission_limited', { store_id: store.id, reason: 'SHOPIFY_INVENTORY_ACCESS_DENIED' });
    } else {
      await recordFailure(store.id, 'inventory', error, { pagesCompleted: error.pages_completed, discovered: error.discovered }, db);
      logger.error('shopify_inventory_sync_failed', { store_id: store.id, error_type: error?.code || error?.name, pages_completed: error?.pages_completed ?? null });
    }
  }
  return { locations, inventory };
}

module.exports = {
  syncInventoryAndLocations,
  syncLocations,
  syncInventory,
  externalId,
  _internal: {
    fetchAll,
    fetchAllInventoryLevels,
    mapLevelRow,
    INVENTORY_ITEMS_QUERY,
    INVENTORY_LEVELS_PAGE_QUERY,
  },
};
