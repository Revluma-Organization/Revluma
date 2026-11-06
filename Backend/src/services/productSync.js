'use strict';
/**
 * Shopify product/catalogue synchronization.
 *
 * Products are the one core commerce domain the platform had no ingestion
 * path for. This module persists an honest, read-only catalogue snapshot:
 * identity, status, options, pricing, tags, variants and featured media.
 *
 * Boundaries (deliberate, documented):
 *   * Inventory quantities (`ProductVariant.inventoryQuantity`,
 *     `Product.totalInventory`) require `read_inventory`. Until that scope is
 *     granted and verified, stock fields stay null instead of inventing 0.
 *   * This module never mutates Shopify. It only reads and upserts local rows.
 *   * Prices are persisted as exact decimal strings (Prisma Decimal), never
 *     floats. Currencies are stored as reported; mixed currencies are never
 *     summed here.
 *   * Webhooks for products are treated as change signals: the authoritative
 *     state is refetched by id, so a stale or replayed webhook cannot write
 *     stale prices into the catalogue.
 */
const { prisma } = require('../configs/database');
const { shopifyGraphql } = require('./shopifyGraphql');
const logger = require('../utils/logger');

const PAGE_SIZE = 50;
const VARIANT_PAGE_SIZE = 100;
const MAX_SYNC_PAGES = 100;
const MAX_VARIANT_PAGES = 20; // 100 × 20 = 2000 variants (Shopify's per-product ceiling)

const VARIANT_FIELDS = `
  id title sku barcode position
  price compareAtPrice
  inventoryItem { measurement { weight { value unit } } }
`;

const PRODUCT_FIELDS = `
  id title handle description productType vendor status
  createdAt updatedAt publishedAt
  tags
  options { name position values }
  priceRangeV2 { minVariantPrice { amount currencyCode } }
  compareAtPriceRange { maxVariantCompareAtPrice { amount currencyCode } }
  variants(first: ${VARIANT_PAGE_SIZE}) {
    nodes { ${VARIANT_FIELDS} }
    pageInfo { hasNextPage endCursor }
  }
  featuredImage { url altText }
`;

function externalId(gid) {
  return String(gid || '').split('/').pop();
}

function moneyString(value) {
  const amount = value?.amount;
  if (amount === null || amount === undefined || amount === '') return null;
  const text = String(amount).trim();
  if (!/^\d+(\.\d+)?$/.test(text)) {
    throw Object.assign(new Error('Shopify returned a non-decimal price'), { code: 'SHOPIFY_PRODUCT_PRICE_INVALID' });
  }
  return text;
}

function mapStatus(status) {
  const value = String(status || '').toUpperCase();
  if (value === 'ACTIVE' || value === 'DRAFT' || value === 'ARCHIVED') return value.toLowerCase();
  return 'draft';
}

function variantList(product) {
  return Array.isArray(product?.variants?.nodes) ? product.variants.nodes : [];
}

function firstVariantWith(variantNodes, selector) {
  return variantNodes.find((variant) => selector(variant)) || null;
}

function mapProduct(storeId, product) {
  if (!product || typeof product !== 'object') {
    throw Object.assign(new Error('Shopify returned a malformed product node'), { code: 'SHOPIFY_PRODUCT_MALFORMED' });
  }
  const id = externalId(product.id);
  if (!id) {
    throw Object.assign(new Error('Shopify product is missing an id'), { code: 'SHOPIFY_PRODUCT_MALFORMED' });
  }
  const variants = variantList(product);
  const prices = variants.map((variant) => moneyString(variant.price)).filter(Boolean);
  const compareAts = variants.map((variant) => moneyString(variant.compareAtPrice)).filter(Boolean);
  const minPrice = moneyString(product.priceRangeV2?.minVariantPrice)
    ?? (prices.length ? prices.sort((a, b) => Number(a) - Number(b))[0] : null);
  const maxCompareAt = moneyString(product.compareAtPriceRange?.maxVariantCompareAtPrice)
    ?? (compareAts.length ? compareAts.sort((a, b) => Number(b) - Number(a))[0] : null);
  const firstSkuVariant = firstVariantWith(variants, (variant) => variant?.sku);
  const weightVariant = firstVariantWith(variants, (variant) => variant?.inventoryItem?.measurement?.weight?.value != null);
  const priceNumber = minPrice === null ? null : Number(minPrice);
  const compareAtNumber = maxCompareAt === null ? null : Number(maxCompareAt);
  const onSale = priceNumber !== null && compareAtNumber !== null && compareAtNumber > priceNumber;
  const weightValue = weightVariant ? Number(weightVariant.inventoryItem.measurement.weight.value) : null;
  return {
    store_id: storeId,
    external_id: id,
    parent_external_id: null,
    name: String(product.title || '').slice(0, 500),
    slug: String(product.handle || '').slice(0, 255),
    type: String(product.productType || 'simple').slice(0, 50) || 'simple',
    status: mapStatus(product.status),
    description: String(product.description || ''),
    sku: firstSkuVariant ? String(firstSkuVariant.sku).slice(0, 255) : '',
    price: minPrice,
    regular_price: compareAtNumber ? maxCompareAt : null,
    sale_price: onSale ? minPrice : null,
    on_sale: onSale,
    purchasable: mapStatus(product.status) === 'active',
    weight: Number.isFinite(weightValue) ? weightValue : null,
    dimensions: {
      options: Array.isArray(product.options) ? product.options.map((option) => ({
        name: String(option?.name || '').slice(0, 100),
        position: Number.isFinite(Number(option?.position)) ? Number(option.position) : null,
        values: Array.isArray(option?.values) ? option.values.map((value) => String(value).slice(0, 100)).slice(0, 50) : [],
      })) : [],
      featured_image: product.featuredImage?.url ? String(product.featuredImage.url).slice(0, 1000) : null,
      variant_count: variants.length,
      tags: Array.isArray(product.tags) ? product.tags.map((tag) => String(tag).slice(0, 100)).slice(0, 100) : [],
      vendor: product.vendor ? String(product.vendor).slice(0, 255) : null,
      published_at: product.publishedAt || null,
      price_currency: product.priceRangeV2?.minVariantPrice?.currencyCode || null,
    },
    created_at: product.createdAt ? new Date(product.createdAt) : null,
    updated_at: product.updatedAt ? new Date(product.updatedAt) : null,
  };
}

async function upsertProduct(store, product, db = prisma) {
  const mapped = mapProduct(store.id, product);
  const { store_id, external_id, ...fields } = mapped;
  // created_at/updated_at: never null them out on update.
  const update = { ...fields };
  if (mapped.created_at === null) delete update.created_at;
  return db.products.upsert({
    where: { store_id_external_id: { store_id, external_id } },
    create: mapped,
    update,
  });
}

async function deleteProduct(store, externalIdValue, db = prisma) {
  const id = String(externalIdValue || '').trim();
  if (!id) return { count: 0 };
  return db.products.deleteMany({ where: { store_id: store.id, external_id: id } });
}

/**
 * Expand the nested variants connection fully before any persistence. A
 * truncated variant list must fail the whole product rather than persist a
 * catalogue snapshot that cannot be sold against.
 */
async function completeVariants(store, products, graphql = shopifyGraphql) {
  for (const product of products) {
    const incomplete = () => Object.assign(new Error('Shopify variant connection is incomplete'), { code: 'SHOPIFY_VARIANTS_INCOMPLETE' });
    let connection = product?.variants;
    if (!connection || !Array.isArray(connection.nodes) || typeof connection.pageInfo?.hasNextPage !== 'boolean') throw incomplete();
    const nodes = [...connection.nodes];
    const ids = new Set();
    const addIds = (items) => {
      for (const item of items) {
        if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)) throw incomplete();
        ids.add(item.id);
      }
    };
    addIds(nodes);
    const cursors = new Set();
    let pages = 1;
    while (connection.pageInfo.hasNextPage) {
      const cursor = connection.pageInfo.endCursor;
      if (typeof product.id !== 'string' || !product.id || typeof product.updatedAt !== 'string' ||
          !Number.isFinite(Date.parse(product.updatedAt)) || typeof cursor !== 'string' || !cursor || cursors.has(cursor)) throw incomplete();
      if (++pages > MAX_VARIANT_PAGES) throw incomplete();
      cursors.add(cursor);
      const data = await graphql(store, `query RevlumaProductVariants($id: ID!, $first: Int!, $after: String!) {
        node(id: $id) { id ... on Product { updatedAt variants(first: $first, after: $after) {
          nodes { ${VARIANT_FIELDS} } pageInfo { hasNextPage endCursor }
        } } }
      }`, { id: product.id, first: VARIANT_PAGE_SIZE, after: cursor });
      const node = data?.node;
      if (!node || node.id !== product.id || node.updatedAt !== product.updatedAt) throw incomplete();
      connection = node.variants;
      if (!connection || !Array.isArray(connection.nodes) || typeof connection.pageInfo?.hasNextPage !== 'boolean') throw incomplete();
      addIds(connection.nodes);
      nodes.push(...connection.nodes);
    }
    product.variants = { nodes, pageInfo: connection.pageInfo };
  }
}

async function fetchProductsPage(store, cursor, graphql = shopifyGraphql) {
  const query = `
    query RevlumaProducts($first: Int!, $after: String) {
      products(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {
        nodes { ${PRODUCT_FIELDS} }
        pageInfo { hasNextPage endCursor }
      }
    }
  `;
  const data = await graphql(store, query, { first: PAGE_SIZE, after: cursor });
  const connection = data?.products;
  if (!connection || !Array.isArray(connection.nodes) ||
      typeof connection.pageInfo?.hasNextPage !== 'boolean') {
    throw Object.assign(new Error('shopify_products_response_missing'), { code: 'SHOPIFY_PRODUCTS_RESPONSE_MALFORMED' });
  }
  return connection;
}

async function syncProducts(store, graphql = shopifyGraphql) {
  const seenCursors = new Set();
  let cursor = null;
  let pages = 0;
  let count = 0;
  // A later page may fail after earlier pages were already persisted. The run
  // must fail loudly (it does, by throwing) AND carry enough context for an
  // operator to see how far it got. Callers must not advance last_synced_at on
  // failure; retries converge because upserts are idempotent.
  try {
    do {
      if (++pages > MAX_SYNC_PAGES) {
        throw Object.assign(new Error('shopify_products_pagination_limit_exceeded'), { code: 'SHOPIFY_PAGINATION_LIMIT_EXCEEDED' });
      }
      const connection = await fetchProductsPage(store, cursor, graphql);
      const products = connection.nodes;
      await completeVariants(store, products, graphql);
      for (const product of products) {
        await upsertProduct(store, product);
        count += 1;
      }
      const nextCursor = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
      if (nextCursor) {
        if (typeof nextCursor !== 'string' || !nextCursor || seenCursors.has(nextCursor)) {
          throw Object.assign(new Error('shopify_products_pagination_stalled'), { code: 'SHOPIFY_PAGINATION_STALLED' });
        }
        seenCursors.add(nextCursor);
      }
      cursor = nextCursor;
    } while (cursor);
  } catch (error) {
    error.sync_stage = 'product_sync';
    error.pages_completed = Math.max(0, pages - 1);
    error.products_upserted = count;
    logger.warn('shopify_products_sync_incomplete', {
      store_id: store.id,
      stage: 'product_sync',
      pages_completed: error.pages_completed,
      products_upserted: count,
      error_code: error.code || error.name || 'product_sync_error',
    });
    throw error;
  }
  logger.info('shopify_products_sync_completed', { store_id: store.id, count, pages });
  return count;
}

async function syncProductById(store, productGid, graphql = shopifyGraphql) {
  const gid = String(productGid || '').trim();
  if (!gid) return null;
  const id = gid.startsWith('gid://') ? gid : `gid://shopify/Product/${gid}`;
  const data = await graphql(store, `query RevlumaProduct($id: ID!) {
    node(id: $id) { id ... on Product { ${PRODUCT_FIELDS} } }
  }`, { id });
  const product = data?.node;
  if (!product || product.id !== id) {
    throw Object.assign(new Error('shopify_product_not_found'), { code: 'SHOPIFY_PRODUCT_NOT_FOUND' });
  }
  await completeVariants(store, [product], graphql);
  await upsertProduct(store, product);
  logger.info('shopify_product_webhook_refetched', { store_id: store.id, external_id: externalId(id) });
  return { action: 'product_upserted', external_id: externalId(id) };
}

module.exports = {
  PRODUCT_FIELDS,
  mapProduct,
  upsertProduct,
  deleteProduct,
  syncProducts,
  syncProductById,
  completeVariants,
  externalId,
};
