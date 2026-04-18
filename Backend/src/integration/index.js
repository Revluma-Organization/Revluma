const { ShopifyAdapter } = require('./shopifyAdapter');
const { WooCommerceAdapter } = require('./woocommerceAdapter');
const { BigCommerceAdapter } = require('./bigcommerceAdapter');
const { BaseAdapter } = require('./baseAdapter');
const { RateLimiter } = require('./rateLimiter');
const { encrypt, decrypt, generateKey, deriveKey } = require('./encryption');

function createAdapter(platform, prisma) {
  switch (platform) {
    case 'shopify':
      return new ShopifyAdapter(prisma);
    case 'woocommerce':
      return new WooCommerceAdapter(prisma);
    case 'bigcommerce':
      return new BigCommerceAdapter(prisma);
    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}

module.exports = {
  createAdapter,
  BaseAdapter,
  ShopifyAdapter,
  WooCommerceAdapter,
  BigCommerceAdapter,
  RateLimiter,
  encrypt,
  decrypt,
  generateKey,
  deriveKey,
};