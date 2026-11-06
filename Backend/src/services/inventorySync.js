'use strict';

// Inventory & Locations acquisition (Admin GraphQL 2026-10).
//
// Scope honesty: exercising read_inventory + read_locations, both now requested
// at install time (see utils/shopify.js). If the merchant has NOT re-consented
// since the request shipped, Shopify returns ACCESS_DENIED — we record
// `degraded` in the ledger and continue with the rest of the pipeline.
// Nothing is fabricated, nothing silently skipped.
//
// Data model:
//   locations          — authoritative location identity + address snapshot
//   inventory_items    — per-variant inventory item identity (SKU/tracked/weight)
//   inventory_levels   — (item, location) quantities JSON, one row per pair
// Quantities shape: GraphQL quantities(names:) → { name: quantity } map stored
//   as JSONB. Never a single 'available' boolean; states preserved.
// Cost is deliberately NOT persisted (merchant financial field, out of need).
// Movement/audit history is NOT exposed by Shopify — documented limitation.

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
const MAX_ITEM_PAGES = 200; // 20k inventory items hard loud ceiling (never silent)
const QUANTITY_NAMES = ['available', 'on_hand', 'committed', 'incoming', 'reserved', 'damaged', 'safety_stock', 'quality_control'];

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

async function fetchAll(store, query, rootKey, maxPages) {
  const nodes = [];
  let after = null;
  for (let page = 0; page < maxPages; page += 1) {
    const data = await shopifyGraphql(store, query, { first: PAGE_SIZE, after });
    const conn = data?.[rootKey];
    if (!conn || !Array.isArray(conn.nodes)) {
      const err = new Error(`inventory_shape_unresolvable:${rootKey}`);
      err.code = 'SHOPIFY_INVENTORY_SHAPE_UNRESOLVABLE';
      throw err;
    }
    nodes.push(...conn.nodes);
    if (!conn.pageInfo?.hasNextPage || !conn.pageInfo?.endCursor) {
      return { nodes, complete: true };
    }
    after = conn.pageInfo.endCursor;
  }
  const err = new Error(`inventory_page_ceiling:${rootKey}`);
  err.code = 'SHOPIFY_INVENTORY_PAGE_CEILING';
  err.partial = nodes.length;
  throw err;
}

async function fetchAllInventoryLevels(store, inventoryItemGid, firstPage) {
  const levels = [...(firstPage?.nodes || [])];
  let pageInfo = firstPage?.pageInfo || {};
  let pages = 1;
  while (pageInfo.hasNextPage) {
    if (!pageInfo.endCursor || pages >= MAX_ITEM_PAGES) {
      const err = new Error(`inventory_levels_page_ceiling:${externalId(inventoryItemGid)}`);
      err.code = 'SHOPIFY_INVENTORY_LEVELS_PAGE_CEILING';
      err.partial = levels.length;
      throw err;
    }
    const data = await shopifyGraphql(store, INVENTORY_LEVELS_PAGE_QUERY, { id: inventoryItemGid, first: PAGE_SIZE, after: pageInfo.endCursor });
    const connection = data?.node?.inventoryLevels;
    if (!connection || !Array.isArray(connection.nodes)) {
      const err = new Error(`inventory_levels_shape_unresolvable:${externalId(inventoryItemGid)}`);
      err.code = 'SHOPIFY_INVENTORY_LEVELS_SHAPE_UNRESOLVABLE';
      throw err;
    }
    levels.push(...connection.nodes);
    pageInfo = connection.pageInfo || {};
    pages += 1;
  }
  return levels;
}

async function syncLocations(store, db = prisma) {
  await beginAttempt(store.id, 'locations', db);
  const fetched = await fetchAll(store, LOCATIONS_QUERY, 'locations', MAX_ITEM_PAGES);
  const seen = new Set();
  const rows = fetched.nodes.map(node => {
    const ext = externalId(node.id);
    seen.add(ext);
    const address = node.address || {};
    return {
      store_id: store.id,
      external_id: ext,
      name: node.name ?? null,
      is_active: toBool(node.isActive),
      country_code: address.countryCode ?? null,
      province_code: address.provinceCode ?? null,
      address1: address.address1 ?? null,
      city: address.city ?? null,
      zip: address.zip ?? null,
      synced_at: new Date(),
    };
  });
  let deleted = 0;
  await db.$transaction(async tx => {
    for (const row of rows) {
      await tx.locations.upsert({
        where: { store_id_external_id: { store_id: row.store_id, external_id: row.external_id } },
        update: row,
        create: row,
      });
    }
    if (fetched.complete) {
      const del = await tx.locations.deleteMany({ where: { store_id: store.id, external_id: { notIn: [...seen] } } });
      deleted = del.count;
    }
  });
  await recordSuccess(store.id, 'locations', { discovered: rows.length, inserted: rows.length, updated: rows.length, deleted, paginationComplete: fetched.complete, pagesCompleted: null }, db);
  return { count: rows.length, deleted };
}

async function syncInventory(store, db = prisma) {
  await beginAttempt(store.id, 'inventory', db);
  const fetched = await fetchAll(store, INVENTORY_ITEMS_QUERY, 'inventoryItems', MAX_ITEM_PAGES);
  const seenItems = new Set();
  const itemRows = [];
  const levelRows = [];
  let nestedLevelsIncomplete = false;
  for (const node of fetched.nodes) {
    const ext = externalId(node.id);
    seenItems.add(ext);
    itemRows.push({
      store_id: store.id,
      external_id: ext,
      sku: node.sku ?? null,
      tracked: toBool(node.tracked),
      requires_shipping: toBool(node.requiresShipping),
      weight: node.measurement?.weight && node.measurement.weight.value != null && Number.isFinite(Number(node.measurement.weight.value)) ? String(node.measurement.weight.value) : null,
      weight_unit: node.measurement?.weight ? String(node.measurement.weight.unit || '').toLowerCase() || null : null,
      created_at: toTs(node.createdAt),
      updated_at: toTs(node.updatedAt),
      synced_at: new Date(),
    });
    // Fetch every nested page before certifying this inventory item complete.
    const levels = await fetchAllInventoryLevels(store, node.id, node.inventoryLevels);
    for (const level of levels) {
      const quantities = {};
      for (const q of (level?.quantities || [])) {
        if (q && typeof q.name === 'string') quantities[q.name] = toNum(q.quantity);
      }
      const locationGid = level?.location?.id;
      if (!locationGid) continue;
      levelRows.push({
        store_id: store.id,
        inventory_item_external_id: ext,
        location_external_id: externalId(locationGid),
        quantities,
        synced_at: new Date(),
      });
    }
    // Loud loud ceiling: item with more than 100 levels per page is page-limited by query first:100,
    // deeper pages are re-synced next pass naturally.
  }
  let deletedItems = 0;
  let deletedLevels = 0;
  // Persist in bounded independent statements. A large inventory snapshot can
  // exceed Supavisor/Prisma interactive-transaction lifetimes; one long transaction
  // previously caused P2028 and discarded the entire domain write.
  for (const row of itemRows) {
    await db.inventory_items.upsert({
      where: { store_id_external_id: { store_id: row.store_id, external_id: row.external_id } },
      update: row,
      create: row,
    });
  }
  for (const row of levelRows) {
    await db.inventory_levels.upsert({
      where: { store_id_inventory_item_external_id_location_external_id: { store_id: row.store_id, inventory_item_external_id: row.inventory_item_external_id, location_external_id: row.location_external_id } },
      update: { quantities: row.quantities, synced_at: row.synced_at },
      create: row,
    });
  }
  // Never perform destructive stale sweeps unless both the outer inventory-item
  // connection and every nested inventory-level connection are complete.
  if (fetched.complete && !nestedLevelsIncomplete) {
    const seenLevelKeys = levelRows.map(r => [r.inventory_item_external_id, r.location_external_id]);
    const itemDelete = await db.inventory_items.deleteMany({ where: { store_id: store.id, external_id: { notIn: [...seenItems] } } });
    deletedItems = itemDelete.count;
    const allLevels = await db.inventory_levels.findMany({ where: { store_id: store.id }, select: { id: true, inventory_item_external_id: true, location_external_id: true } });
    const fresh = new Set(seenLevelKeys.map(([i, l]) => `${i}|${l}`));
    const stale = allLevels.filter(l => !fresh.has(`${l.inventory_item_external_id}|${l.location_external_id}`)).map(l => l.id);
    if (stale.length) {
      const del = await db.inventory_levels.deleteMany({ where: { id: { in: stale } } });
      deletedLevels = del.count;
    }
  }
  await recordSuccess(store.id, 'inventory', { discovered: itemRows.length, inserted: itemRows.length, updated: itemRows.length, deleted: deletedItems + deletedLevels, paginationComplete: fetched.complete, pagesCompleted: null }, db);
  return { items: itemRows.length, levels: levelRows.length, deletedItems, deletedLevels };
}

async function syncInventoryAndLocations(store, db = prisma) {
  // Independent, non-fatal domain family mirroring the products/customers stance.
  // ACCESS_DENIED → degraded + continue. Any other error → loud failure recorded, continue.
  let locations = null;
  let inventory = null;
  try {
    locations = await syncLocations(store, db);
  } catch (error) {
    if (accessDenied(error, 'locations?')) {
      await recordDegraded(store.id, 'locations', 'SHOPIFY_LOCATIONS_ACCESS_DENIED', {}, db);
      logger.warn('shopify_locations_sync_permission_limited', { store_id: store.id, reason: 'SHOPIFY_LOCATIONS_ACCESS_DENIED' });
    } else {
      await recordFailure(store.id, 'locations', error, {}, db);
      logger.error('shopify_locations_sync_failed', { store_id: store.id, error_type: error?.code || error?.name });
    }
  }
  try {
    inventory = await syncInventory(store, db);
  } catch (error) {
    if (accessDenied(error, 'inventor(y|ies)')) {
      await recordDegraded(store.id, 'inventory', 'SHOPIFY_INVENTORY_ACCESS_DENIED', {}, db);
      logger.warn('shopify_inventory_sync_permission_limited', { store_id: store.id, reason: 'SHOPIFY_INVENTORY_ACCESS_DENIED' });
    } else {
      await recordFailure(store.id, 'inventory', error, {}, db);
      logger.error('shopify_inventory_sync_failed', { store_id: store.id, error_type: error?.code || error?.name });
    }
  }
  return { locations, inventory };
}

module.exports = { syncInventoryAndLocations, syncLocations, syncInventory, externalId, _internal: { fetchAll, fetchAllInventoryLevels } };
