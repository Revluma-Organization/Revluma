'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const GRAPHQL_PATH = require.resolve('../services/shopifyGraphql');
const DB_PATH = require.resolve('../configs/database');
const STORE = { id: 'store-a', shop_domain: 'a.myshopify.com' };
const OTHER_STORE = { id: 'store-b', shop_domain: 'b.myshopify.com' };

function load(graphql, db) {
  require.cache[DB_PATH] = { id: DB_PATH, filename: DB_PATH, loaded: true, exports: { prisma: db } };
  require.cache[GRAPHQL_PATH] = { id: GRAPHQL_PATH, filename: GRAPHQL_PATH, loaded: true, exports: { shopifyGraphql: graphql } };
  for (const key of Object.keys(require.cache)) {
    if (key.includes('inventorySync') || key.includes('syncDomainState')) delete require.cache[key];
  }
  return require('../services/inventorySync');
}

function level(item, location, available = 0) {
  return {
    location: { id: `gid://shopify/Location/${location}` },
    quantities: [
      { name: 'available', quantity: available },
      { name: 'on_hand', quantity: available + 2 },
      { name: 'committed', quantity: 2 },
    ],
    updatedAt: '2026-11-06T12:00:00Z',
  };
}

function item(id, levels = [], hasNextPage = false, endCursor = null) {
  return {
    id: `gid://shopify/InventoryItem/${id}`,
    sku: `SKU-${id}`, tracked: true, requiresShipping: true,
    measurement: { weight: { value: 1.25, unit: 'KILOGRAMS' } },
    createdAt: '2026-11-01T12:00:00Z', updatedAt: '2026-11-06T12:00:00Z',
    inventoryLevels: { nodes: levels, pageInfo: { hasNextPage, endCursor } },
  };
}

function makeDb() {
  const state = { items: [], levels: [], locations: [], ledger: new Map(), failItemUpsertAt: null };
  const upserts = (table, keyFor) => async ({ where, create, update }) => {
    if (table === 'items' && state.failItemUpsertAt !== null && state.items.length >= state.failItemUpsertAt) {
      throw Object.assign(new Error('database unavailable'), { code: 'P2037' });
    }
    const key = keyFor(create);
    const found = state[table].find(row => keyFor(row) === key);
    if (found) Object.assign(found, update);
    else state[table].push({ ...create, id: create.id || `${table}-${state[table].length + 1}` });
  };
  const itemKey = row => `${row.store_id}|${row.external_id}`;
  const levelKey = row => `${row.store_id}|${row.inventory_item_external_id}|${row.location_external_id}`;
  const locationKey = itemKey;
  return {
    state,
    inventory_items: {
      upsert: upserts('items', itemKey),
      findMany: async ({ where }) => state.items.filter(row => row.store_id === where.store_id && (!where.external_id?.in || where.external_id.in.includes(row.external_id))),
      deleteMany: async ({ where }) => {
        const before = state.items.length;
        state.items = state.items.filter(row => row.store_id !== where.store_id || where.external_id.notIn.includes(row.external_id));
        return { count: before - state.items.length };
      },
    },
    inventory_levels: {
      upsert: upserts('levels', levelKey),
      findMany: async ({ where }) => state.levels.filter(row => row.store_id === where.store_id),
      deleteMany: async ({ where }) => {
        const before = state.levels.length;
        state.levels = state.levels.filter(row => row.store_id !== where.store_id || !where.id.in.includes(row.id));
        return { count: before - state.levels.length };
      },
    },
    locations: {
      upsert: upserts('locations', locationKey),
      findMany: async ({ where }) => state.locations.filter(row => row.store_id === where.store_id && (!where.external_id?.in || where.external_id.in.includes(row.external_id))),
      deleteMany: async ({ where }) => {
        const before = state.locations.length;
        state.locations = state.locations.filter(row => row.store_id !== where.store_id || where.external_id.notIn.includes(row.external_id));
        return { count: before - state.locations.length };
      },
    },
    store_sync_domain_states: {
      upsert: async ({ where, create, update }) => {
        const key = `${where.store_id_domain.store_id}|${where.store_id_domain.domain}`;
        const current = state.ledger.get(key) || {};
        const normalized = { ...update };
        if (normalized.retry_count?.increment) normalized.retry_count = (current.retry_count || 0) + normalized.retry_count.increment;
        state.ledger.set(key, { ...current, ...create, ...normalized });
      },
      findUnique: async () => null,
      findMany: async () => [],
    },
  };
}

function inventoryOnly(handler) {
  return async (store, query, variables) => {
    if (query.includes('RevlumaLocations')) return { locations: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } };
    return handler(store, query, variables);
  };
}

test('outer and nested pagination persist every item and level with exact page/count accounting', async () => {
  const db = makeDb();
  const calls = [];
  const graphql = inventoryOnly(async (_store, query, variables) => {
    calls.push({ query, variables });
    if (query.includes('RevlumaInventoryItemLevels')) {
      assert.equal(variables.id, 'gid://shopify/InventoryItem/1');
      assert.equal(variables.after, 'level-cursor');
      return { node: { inventoryLevels: { nodes: [level(1, 102, 7)], pageInfo: { hasNextPage: false, endCursor: null } } } };
    }
    if (!variables.after) return { inventoryItems: {
      nodes: [item(1, [level(1, 101, 5)], true, 'level-cursor'), item(2, [level(2, 101, 2)])],
      pageInfo: { hasNextPage: true, endCursor: 'item-cursor' },
    } };
    assert.equal(variables.after, 'item-cursor');
    return { inventoryItems: { nodes: [item(3, [])], pageInfo: { hasNextPage: false, endCursor: null } } };
  });
  const { syncInventory } = load(graphql, db);
  const first = await syncInventory(STORE, db);
  assert.deepEqual(first, { items: 3, levels: 3, deletedItems: 0, deletedLevels: 0, inserted: 6, updated: 0, pagesCompleted: 6 });
  assert.equal(db.state.levels.find(row => row.location_external_id === '102').quantities.available, 7);
  assert.equal(db.state.items[0].weight_unit, 'kilograms');
  const ledger = db.state.ledger.get('store-a|inventory');
  assert.equal(ledger.status, 'ok');
  assert.equal(ledger.pagination_complete, true);
  assert.equal(ledger.pages_completed, 6);
  assert.equal(ledger.records_discovered, 3);
  assert.equal(calls.filter(call => call.query.includes('RevlumaInventoryItemLevels')).length, 1);
});

test('repeated synchronization is idempotent and reports updates rather than inserts', async () => {
  const db = makeDb();
  const graphql = inventoryOnly(async () => ({ inventoryItems: { nodes: [item(1, [level(1, 101, 4)])], pageInfo: { hasNextPage: false, endCursor: null } } }));
  const { syncInventory } = load(graphql, db);
  await syncInventory(STORE, db);
  await syncInventory(STORE, db);
  assert.equal(db.state.items.length, 1);
  assert.equal(db.state.levels.length, 1);
  assert.equal(db.state.ledger.get('store-a|inventory').records_inserted, 0);
  assert.equal(db.state.ledger.get('store-a|inventory').records_updated, 2);
});

test('quantity changes update the existing item/location row', async () => {
  const db = makeDb();
  let available = 9;
  const graphql = inventoryOnly(async () => ({ inventoryItems: { nodes: [item(1, [level(1, 101, available)])], pageInfo: { hasNextPage: false, endCursor: null } } }));
  const { syncInventory } = load(graphql, db);
  await syncInventory(STORE, db);
  available = 3;
  await syncInventory(STORE, db);
  assert.equal(db.state.levels.length, 1);
  assert.equal(db.state.levels[0].quantities.available, 3);
  assert.equal(db.state.levels[0].quantities.on_hand, 5);
});

test('complete stale reconciliation is tenant scoped and empty snapshots are valid', async () => {
  const db = makeDb();
  db.state.items.push({ id: 'a-stale', store_id: STORE.id, external_id: 'stale' }, { id: 'b-live', store_id: OTHER_STORE.id, external_id: 'stale' });
  db.state.levels.push({ id: 'a-level', store_id: STORE.id, inventory_item_external_id: 'stale', location_external_id: '1' }, { id: 'b-level', store_id: OTHER_STORE.id, inventory_item_external_id: 'stale', location_external_id: '1' });
  const graphql = inventoryOnly(async () => ({ inventoryItems: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } }));
  const { syncInventory } = load(graphql, db);
  const result = await syncInventory(STORE, db);
  assert.equal(result.items, 0);
  assert.equal(result.deletedItems, 1);
  assert.equal(result.deletedLevels, 1);
  assert.deepEqual(db.state.items.map(row => row.store_id), [OTHER_STORE.id]);
  assert.deepEqual(db.state.levels.map(row => row.store_id), [OTHER_STORE.id]);
  assert.equal(db.state.ledger.get('store-a|inventory').status, 'ok');
});

test('missing next cursor fails before writes or destructive reconciliation', async () => {
  const db = makeDb();
  db.state.items.push({ id: 'keep', store_id: STORE.id, external_id: 'keep' });
  const graphql = inventoryOnly(async () => ({ inventoryItems: { nodes: [item(1)], pageInfo: { hasNextPage: true, endCursor: null } } }));
  const { syncInventory } = load(graphql, db);
  await assert.rejects(() => syncInventory(STORE, db), error => error.code === 'SHOPIFY_INVENTORY_CURSOR_INVALID');
  assert.equal(db.state.items.length, 1);
  assert.equal(db.state.items[0].external_id, 'keep');
});

test('repeated outer cursor fails loudly', async () => {
  const db = makeDb();
  const { _internal } = load(async () => ({ inventoryItems: { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'same' } } }), db);
  await assert.rejects(() => _internal.fetchAll(STORE, 'query', 'inventoryItems'), error => error.code === 'SHOPIFY_INVENTORY_CURSOR_REPEATED' && error.pages_completed === 1);
});

test('repeated nested cursor fails before item persistence', async () => {
  const db = makeDb();
  const graphql = inventoryOnly(async (store, query) => {
    if (query.includes('RevlumaInventoryItemLevels')) return { node: { inventoryLevels: { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'same-level' } } } };
    return { inventoryItems: { nodes: [item(1, [], true, 'same-level')], pageInfo: { hasNextPage: false, endCursor: null } } };
  });
  const { syncInventory } = load(graphql, db);
  await assert.rejects(() => syncInventory(STORE, db), error => error.code === 'SHOPIFY_INVENTORY_CURSOR_REPEATED');
  assert.equal(db.state.items.length, 0);
});

test('outer and nested page ceilings are explicit failures', async () => {
  const db = makeDb();
  const { _internal } = load(async () => ({ inventoryItems: { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'next' } } }), db);
  await assert.rejects(() => _internal.fetchAll(STORE, 'query', 'inventoryItems', 1), error => error.code === 'SHOPIFY_INVENTORY_PAGE_CEILING');
  const nestedDb = makeDb();
  const nested = load(async () => ({}), nestedDb);
  await assert.rejects(() => nested._internal.fetchAllInventoryLevels(STORE, 'gid://shopify/InventoryItem/1', { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'x' } }, 1), error => error.code === 'SHOPIFY_INVENTORY_LEVELS_PAGE_CEILING');
});

test('malformed outer, nested and quantity structures fail closed', async () => {
  const db = makeDb();
  const malformed = load(inventoryOnly(async () => ({ inventoryItems: { nodes: null } })), db);
  await assert.rejects(() => malformed.syncInventory(STORE, db), error => error.code === 'SHOPIFY_INVENTORY_SHAPE_UNRESOLVABLE');
  const nestedDb = makeDb();
  const nested = load(inventoryOnly(async () => ({ inventoryItems: { nodes: [item(1)], pageInfo: { hasNextPage: false, endCursor: null } } })), nestedDb);
  const bad = item(1);
  bad.inventoryLevels.nodes = null;
  await assert.rejects(() => nested._internal.fetchAllInventoryLevels(STORE, bad.id, bad.inventoryLevels), error => error.code === 'SHOPIFY_INVENTORY_SHAPE_UNRESOLVABLE');
  assert.throws(() => nested._internal.mapLevelRow(STORE.id, '1', { location: { id: 'gid://shopify/Location/1' }, quantities: [{ name: 'available', quantity: 'not-a-number' }] }), error => error.code === 'SHOPIFY_INVENTORY_QUANTITIES_INVALID');
  assert.throws(() => nested._internal.mapLevelRow(STORE.id, '1', { quantities: [] }), error => error.code === 'SHOPIFY_INVENTORY_LEVEL_LOCATION_MISSING');
});

test('Shopify API failure prevents persistence and destructive sweeps', async () => {
  const db = makeDb();
  db.state.items.push({ id: 'keep', store_id: STORE.id, external_id: 'keep' });
  const graphql = inventoryOnly(async () => { throw Object.assign(new Error('throttled'), { code: 'SHOPIFY_GRAPHQL_HTTP_ERROR', status: 429 }); });
  const { syncInventory } = load(graphql, db);
  await assert.rejects(() => syncInventory(STORE, db), error => error.code === 'SHOPIFY_GRAPHQL_HTTP_ERROR');
  assert.equal(db.state.items.length, 1);
});

test('database upsert failure is ledgered as failed, never false success', async () => {
  const db = makeDb();
  db.state.failItemUpsertAt = 0;
  const graphql = inventoryOnly(async () => ({ inventoryItems: { nodes: [item(1)], pageInfo: { hasNextPage: false, endCursor: null } } }));
  const { syncInventoryAndLocations } = load(graphql, db);
  const result = await syncInventoryAndLocations(STORE, db);
  assert.equal(result.inventory, null);
  const ledger = db.state.ledger.get('store-a|inventory');
  assert.equal(ledger.status, 'failed');
  assert.equal(ledger.pagination_complete, false);
  assert.equal(ledger.error_code, 'P2037');
});

test('inventory permission denial is degraded and does not delete existing rows', async () => {
  const db = makeDb();
  db.state.items.push({ id: 'keep', store_id: STORE.id, external_id: 'keep' });
  const error = Object.assign(new Error('denied'), { code: 'SHOPIFY_GRAPHQL_ERROR', shopifyErrors: [{ message: 'Access denied for inventoryItems field', codes: ['ACCESS_DENIED'] }] });
  const graphql = inventoryOnly(async () => { throw error; });
  const { syncInventoryAndLocations } = load(graphql, db);
  await syncInventoryAndLocations(STORE, db);
  assert.equal(db.state.items.length, 1);
  assert.equal(db.state.ledger.get('store-a|inventory').status, 'degraded');
});

test('multiple locations and stores retain independent identities', async () => {
  const db = makeDb();
  const graphql = inventoryOnly(async store => ({ inventoryItems: { nodes: [item(store.id === STORE.id ? 1 : 2, [level(1, 101), level(1, 102)])], pageInfo: { hasNextPage: false, endCursor: null } } }));
  const { syncInventory } = load(graphql, db);
  await syncInventory(STORE, db);
  await syncInventory(OTHER_STORE, db);
  assert.equal(db.state.items.length, 2);
  assert.equal(db.state.levels.length, 4);
  assert.ok(db.state.levels.every(row => row.store_id === STORE.id || row.store_id === OTHER_STORE.id));
  assert.equal(new Set(db.state.levels.map(row => `${row.store_id}|${row.inventory_item_external_id}|${row.location_external_id}`)).size, 4);
});

test('valid query uses measurement weight and nested levels; unsupported shapes are absent', () => {
  const { _internal } = load(async () => ({}), makeDb());
  assert.match(_internal.INVENTORY_ITEMS_QUERY, /measurement \{ weight \{ value unit \} \}/);
  assert.doesNotMatch(_internal.INVENTORY_ITEMS_QUERY, /\n\s+weight \{/);
  assert.match(_internal.INVENTORY_LEVELS_PAGE_QUERY, /inventoryLevels\(first: \$first, after: \$after\)/);
});

test('location acquisition includes inactive and legacy sources and persists active state', async () => {
  const db = makeDb();
  let seenQuery = '';
  const graphql = async (_store, query) => {
    seenQuery = query;
    return { locations: { nodes: [
      { id: 'gid://shopify/Location/101', name: 'Active', isActive: true, address: {} },
      { id: 'gid://shopify/Location/102', name: 'Inactive', isActive: false, address: {} },
    ], pageInfo: { hasNextPage: false, endCursor: null } } };
  };
  const { syncLocations, _internal } = load(graphql, db);
  const result = await syncLocations(STORE, db);
  assert.equal(result.count, 2);
  assert.match(seenQuery, /includeInactive: true/);
  assert.match(seenQuery, /includeLegacy: true/);
  assert.match(_internal.LOCATIONS_QUERY, /includeInactive: true, includeLegacy: true/);
  assert.equal(db.state.locations.find(row => row.external_id === '102').is_active, false);
  assert.equal(db.state.ledger.get('store-a|locations').pagination_complete, true);
});
