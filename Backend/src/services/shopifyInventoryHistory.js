'use strict';
const crypto = require('crypto');

function validatedRows(store, observation) {
  if (!store?.id || !store?.organization_id || observation?.storeId !== store.id ||
      observation.scopeVerified !== true || observation.catalogPaginationComplete !== true ||
      observation.variantPaginationComplete !== true || observation.source !== 'shopify_admin_graphql' ||
      !Number.isFinite(new Date(observation.observedAt).getTime()) ||
      !Array.isArray(observation.products)) {
    throw Object.assign(new Error('Incomplete inventory observation cannot be persisted'), { code: 'INVENTORY_OBSERVATION_UNVERIFIED' });
  }
  const rows = [];
  const uniqueVariants = new Set();
  for (const product of observation.products) {
    if (!product.productId || !['ACTIVE', 'ARCHIVED', 'DRAFT'].includes(product.status) ||
        !Array.isArray(product.variants)) throw new Error('Invalid observed product');
    for (const variant of product.variants) {
      if (!variant.variantId || uniqueVariants.has(variant.variantId) ||
          typeof variant.availableForSale !== 'boolean' ||
          !['DENY', 'CONTINUE'].includes(variant.inventoryPolicy) ||
          (variant.inventoryQuantity !== null && !Number.isInteger(variant.inventoryQuantity))) {
        throw Object.assign(new Error('Invalid or duplicate observed variant'), { code: 'INVENTORY_VARIANT_UNVERIFIED' });
      }
      uniqueVariants.add(variant.variantId);
      rows.push({
        organization_id: store.organization_id, store_id: store.id,
        observed_at: new Date(observation.observedAt),
        product_external_id: product.productId, variant_external_id: variant.variantId,
        product_title: product.title, product_status: product.status,
        variant_title: variant.title, available_for_sale: variant.availableForSale,
        inventory_quantity: variant.inventoryQuantity, inventory_policy: variant.inventoryPolicy,
        source: observation.source,
      });
    }
  }
  return rows;
}

async function persistInventoryObservation(prisma, store, observation) {
  const rows = validatedRows(store, observation);
  const runId = crypto.randomUUID();
  await prisma.$transaction(async tx => {
    const owner = await tx.stores.findFirst({
      where: { id: store.id, organization_id: store.organization_id, platform: 'shopify' },
      select: { id: true },
    });
    if (!owner) throw Object.assign(new Error('Inventory observation store ownership invalid'), { code: 'INVENTORY_STORE_UNAUTHORIZED' });
    await tx.shopify_inventory_observation_runs.create({
      data: {
        id: runId, organization_id: store.organization_id, store_id: store.id,
        observed_at: new Date(observation.observedAt), source: observation.source,
        scope_verified: true, catalog_complete: true, variants_complete: true,
        product_count: observation.products.length, variant_count: rows.length,
      },
    });
    if (rows.length) {
      await tx.shopify_inventory_observations.createMany({
        data: rows.map(row => ({ ...row, observation_id: runId })),
      });
    }
  });
  return { runId, observedAt: observation.observedAt, productCount: observation.products.length, variantCount: rows.length };
}

module.exports = { validatedRows, persistInventoryObservation };
