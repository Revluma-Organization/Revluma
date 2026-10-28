'use strict';

// Advisory-only transition candidates. A Shopify variant can be unavailable
// for reasons other than stock; do not label these transitions as stockouts.
function detectAvailabilityTransitions(previous, current) {
  if (!previous || !current || previous.storeId !== current.storeId ||
      previous.scopeVerified !== true || current.scopeVerified !== true ||
      previous.catalogPaginationComplete !== true || current.catalogPaginationComplete !== true ||
      previous.variantPaginationComplete !== true || current.variantPaginationComplete !== true ||
      !Array.isArray(previous.products) || !Array.isArray(current.products) ||
      !(new Date(previous.observedAt) < new Date(current.observedAt))) {
    return { verified: false, transitions: [], reason: 'inventory_observation_coverage_unverified' };
  }
  const flatten = observation => {
    const variants = new Map();
    for (const product of observation.products) {
      if (!Array.isArray(product.variants)) return null;
      for (const variant of product.variants) {
        if (!variant.variantId || typeof variant.availableForSale !== 'boolean' || variants.has(variant.variantId)) return null;
        variants.set(variant.variantId, { ...variant, productId: product.productId, productTitle: product.title, productStatus: product.status });
      }
    }
    return variants;
  };
  const before = flatten(previous), after = flatten(current);
  if (!before || !after) return { verified: false, transitions: [], reason: 'inventory_variant_data_invalid' };
  const transitions = [];
  for (const [variantId, currentVariant] of after) {
    const previousVariant = before.get(variantId);
    if (!previousVariant || previousVariant.availableForSale === currentVariant.availableForSale) continue;
    transitions.push({
      storeId: current.storeId, variantId, productId: currentVariant.productId,
      productTitle: currentVariant.productTitle,
      previousAvailable: previousVariant.availableForSale,
      currentAvailable: currentVariant.availableForSale,
      previousObservedAt: previous.observedAt, currentObservedAt: current.observedAt,
      evidenceType: 'shopify_variant_availability_change',
      causeVerified: false, merchantAlertEligible: false,
    });
  }
  return { verified: true, transitions };
}
module.exports = { detectAvailabilityTransitions };
