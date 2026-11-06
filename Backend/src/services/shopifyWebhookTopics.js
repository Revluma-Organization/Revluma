'use strict';
/**
 * The 12 Shopify webhook subscriptions Revluma requires, as (TOPIC, path).
 * Pure module — no database, no network, safe to import anywhere.
 */
const REQUIRED_SUBSCRIPTIONS = Object.freeze([
  ['APP_UNINSTALLED', 'app/uninstalled'],
  ['ORDERS_CREATE', 'orders/create'],
  ['ORDERS_UPDATED', 'orders/updated'],
  ['ORDERS_CANCELLED', 'orders/cancelled'],
  ['ORDERS_DELETE', 'orders/delete'],
  ['CUSTOMERS_CREATE', 'customers/create'],
  ['CUSTOMERS_UPDATE', 'customers/update'],
  ['CHECKOUTS_CREATE', 'checkouts/create'],
  ['CHECKOUTS_UPDATE', 'checkouts/update'],
  ['PRODUCTS_CREATE', 'products/create'],
  ['PRODUCTS_UPDATE', 'products/update'],
  ['PRODUCTS_DELETE', 'products/delete'],
]);

module.exports = { REQUIRED_SUBSCRIPTIONS };
