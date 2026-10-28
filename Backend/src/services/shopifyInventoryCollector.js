'use strict';
const { observeShopifyInventory } = require('./shopifyInventoryObservation');
const { persistInventoryObservation } = require('./shopifyInventoryHistory');

// Explicitly invoked, read-only collector. No schedule or alert emission until
// migration availability, merchant permissions, and Shopify API are verified.
async function collectShopifyInventory(prisma, store, {
  observe = observeShopifyInventory,
  persist = persistInventoryObservation,
} = {}) {
  if (!store?.organization_id || !store?.id || store.platform !== 'shopify') {
    throw Object.assign(new Error('Shopify store and organization required'), { code: 'INVENTORY_STORE_UNAUTHORIZED' });
  }
  const observation = await observe(store);
  const saved = await persist(prisma, store, observation);
  return { ...saved, source: observation.source, alertEligible: false };
}
module.exports = { collectShopifyInventory };
