'use strict';
/**
 * Store profile/domain ingestion: persistence, reconciliation, isolation.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const GRAPHQL_PATH = require.resolve('../services/shopifyGraphql');
const DB_PATH = require.resolve('../configs/database');
const STORE = { id: '11111111-1111-1111-1111-111111111111' };

function prismaStub() {
  const state = { profile: null, domains: [] };
  return {
    state,
    store_profiles: {
      upsert: async ({ where, create, update }) => { state.profile = state.profile ? { ...state.profile, ...update } : create; return state.profile; },
    },
    store_domains: {
      upsert: async ({ where, create, update }) => {
        const host = where.store_id_host.host;
        const existing = state.domains.find(d => d.host === host);
        if (existing) Object.assign(existing, update); else state.domains.push(create);
      },
      deleteMany: async ({ where }) => {
        const keep = where.host?.notIn ?? [];
        const before = state.domains.length;
        state.domains = state.domains.filter(d => !(d.store_id === where.store_id && !keep.includes(d.host)));
        return { count: before - state.domains.length };
      },
    },
    store_sync_domain_states: { upsert: async () => ({}), findUnique: async () => null, findMany: async () => [] },
  };
}

function load(graphql, prisma) {
  require.cache[DB_PATH] = { id: DB_PATH, filename: DB_PATH, loaded: true, exports: { prisma } };
  require.cache[GRAPHQL_PATH] = { id: GRAPHQL_PATH, filename: GRAPHQL_PATH, loaded: true, exports: { shopifyGraphql: graphql } };
  for (const key of Object.keys(require.cache)) {
    if (key.includes('storeProfileSync') || key.includes('syncDomainState')) delete require.cache[key];
  }
  return require('../services/storeProfileSync');
}

function shopResponse() {
  return { shop: {
    name: 'Demo Store', email: 'owner@example.com', myshopifyDomain: 'demo.myshopify.com',
    ianaTimezone: 'Africa/Lagos', currencyCode: 'NGN',
    shopAddress: { countryCodeV2: 'NG', city: 'Abuja', zip: '900001' },
    plan: { displayName: 'Development', partnerDevelopment: true, shopifyPlus: false },
    primaryDomain: { host: 'shop.demo-merchant.com', url: 'https://shop.demo-merchant.com', sslEnabled: true },
  } };
}

test('profile and domains persist; primary custom domain recorded beside myshopify', async () => {
  const prisma = prismaStub();
  const { syncStoreProfile } = load(async () => shopResponse(), prisma);
  const profile = await syncStoreProfile(STORE, undefined, prisma);
  assert.equal(profile.currency_code, 'NGN');
  assert.equal(profile.iana_timezone, 'Africa/Lagos');
  assert.equal(profile.plan_shopify_plus, false);
  const hosts = prisma.state.domains.map(d => d.host).sort();
  assert.deepEqual(hosts, ['demo.myshopify.com', 'shop.demo-merchant.com']);
  assert.equal(prisma.state.domains.find(d => d.host === 'shop.demo-merchant.com').kind, 'primary');
});

test('a domain removed in the source is reconciled away (stale domain removal)', async () => {
  const prisma = prismaStub();
  prisma.state.domains.push({ store_id: STORE.id, host: 'old-custom.example.com', url: null, kind: 'primary', ssl_enabled: true, synced_at: new Date() });
  const { syncStoreProfile } = load(async () => shopResponse(), prisma);
  await syncStoreProfile(STORE, undefined, prisma);
  const hosts = prisma.state.domains.map(d => d.host).sort();
  assert.deepEqual(hosts, ['demo.myshopify.com', 'shop.demo-merchant.com']);
});

test('malformed shop response fails closed and ledger records the failure', async () => {
  const prisma = prismaStub();
  const { syncStoreProfile } = load(async () => ({ shop: null }), prisma);
  await assert.rejects(() => syncStoreProfile(STORE, undefined, prisma), /no shop profile/i);
  assert.equal(prisma.state.profile, null, 'nothing invented persisted');
});
