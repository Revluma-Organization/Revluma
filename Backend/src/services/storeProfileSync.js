'use strict';

// Store identity and domains ingestion (Admin GraphQL `shop`).
//
// Read-only metadata only: shop name, plan, currency, timezone, and domain
// surface. Never persists tokens. A failure here degrades its own domain in
// the sync ledger; it can never fail the store's commerce sync.

const { prisma } = require('../configs/database');
const logger = require('../utils/logger');
const { shopifyGraphql } = require('./shopifyGraphql');
const { beginAttempt, recordSuccess, recordFailure } = require('./syncDomainState');

const SHOP_QUERY = `query RevlumaShopProfile {
  shop {
    name
    email
    myshopifyDomain
    ianaTimezone
    currencyCode
    shopAddress { countryCodeV2 city zip }
    plan { displayName partnerDevelopment shopifyPlus }
    primaryDomain { host url sslEnabled }
  }
}`;

function mapProfileRow(storeId, shop) {
  return {
    store_id: storeId,
    shop_name: shop?.name ? String(shop.name).slice(0, 500) : null,
    myshopify_domain: shop?.myshopifyDomain ? String(shop.myshopifyDomain).slice(0, 255) : null,
    primary_domain_host: shop?.primaryDomain?.host ? String(shop.primaryDomain.host).slice(0, 255) : null,
    primary_domain_url: shop?.primaryDomain?.url ? String(shop.primaryDomain.url) : null,
    primary_domain_ssl: typeof shop?.primaryDomain?.sslEnabled === 'boolean' ? shop.primaryDomain.sslEnabled : null,
    email: shop?.email ? String(shop.email).slice(0, 320) : null,
    iana_timezone: shop?.ianaTimezone ? String(shop.ianaTimezone).slice(0, 64) : null,
    currency_code: shop?.currencyCode ? String(shop.currencyCode).slice(0, 3) : null,
    country_code: shop?.shopAddress?.countryCodeV2 ? String(shop.shopAddress.countryCodeV2).slice(0, 3) : null,
    country_name: null, // ShopAddress no longer exposes 'countryName' (API drift); country_code is the supported field
    city: shop?.shopAddress?.city ? String(shop.shopAddress.city).slice(0, 120) : null,
    zip: shop?.shopAddress?.zip ? String(shop.shopAddress.zip).slice(0, 32) : null,
    plan_display_name: shop?.plan?.displayName ? String(shop.plan.displayName).slice(0, 190) : null,
    plan_partner_development: typeof shop?.plan?.partnerDevelopment === 'boolean' ? shop.plan.partnerDevelopment : null,
    plan_shopify_plus: typeof shop?.plan?.shopifyPlus === 'boolean' ? shop.plan.shopifyPlus : null,
    synced_at: new Date(),
  };
}

function domainRows(storeId, shop) {
  const rows = [];
  const myshopify = shop?.myshopifyDomain ? String(shop.myshopifyDomain) : null;
  const primary = shop?.primaryDomain?.host ? String(shop.primaryDomain.host) : null;
  if (myshopify) {
    rows.push({ store_id: storeId, host: myshopify.slice(0, 255), url: `https://${myshopify}`, kind: 'myshopify', ssl_enabled: true, synced_at: new Date() });
  }
  if (primary && primary !== myshopify) {
    rows.push({ store_id: storeId, host: primary.slice(0, 255), url: shop?.primaryDomain?.url ? String(shop.primaryDomain.url) : null, kind: 'primary', ssl_enabled: typeof shop.primaryDomain?.sslEnabled === 'boolean' ? shop.primaryDomain.sslEnabled : null, synced_at: new Date() });
  }
  return rows;
}

async function syncStoreProfile(store, graphql = shopifyGraphql, db = prisma) {
  await beginAttempt(store.id, 'store_domains');
  try {
    const data = await graphql(store, SHOP_QUERY, {});
    const shop = data?.shop;
    if (!shop || typeof shop !== 'object') {
      const error = new Error('Shopify returned no shop profile');
      error.code = 'SHOPIFY_SHOP_RESPONSE_MALFORMED';
      throw error;
    }
    const profile = mapProfileRow(store.id, shop);
    const domains = domainRows(store.id, shop);
    const { store_id, ...fields } = profile;
    await db.store_profiles.upsert({
      where: { store_id },
      create: profile,
      update: { ...fields, synced_at: new Date() },
    });
    for (const row of domains) {
      const { host, synced_at, ...rest } = row;
      await db.store_domains.upsert({
        where: { store_id_host: { store_id: store.id, host } },
        create: row,
        update: { ...rest, synced_at },
      });
    }
    // Reconcile custom domains that no longer exist in the source.
    const keepHosts = domains.map(d => d.host);
    await db.store_domains.deleteMany({
      where: { store_id: store.id, host: { notIn: keepHosts.length ? keepHosts : ['__none__'] } },
    });
    await recordSuccess(store.id, 'store_domains', { discovered: domains.length, inserted: domains.length, paginationComplete: true });
    return profile;
  } catch (error) {
    await recordFailure(store.id, 'store_domains', error);
    logger.warn('store_profile_sync_failed', { store_id: store.id, error_type: error?.code || error?.name || 'store_profile_error' });
    throw error;
  }
}

module.exports = { syncStoreProfile, mapProfileRow, domainRows, SHOP_QUERY };
