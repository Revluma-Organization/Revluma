const axios = require("axios");
const prisma = require("../configs/database");
const logger = require("../utils/logger");

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-01";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function shopifyRequest(store, endpoint) {
  const url = `https://${store.shop_domain}/admin/api/${API_VERSION}${endpoint}`;

  const response = await axios.get(url, {
    headers: {
      "X-Shopify-Access-Token": store.access_token,
      "Content-Type": "application/json",
    },
    timeout: 30000,
  });

  return response;
}

async function syncCustomers(store) {
  logger.info("Starting customer sync", {
    storeId: store.id,
  });

  // We'll implement this next
}

async function syncOrders(store) {
  logger.info("Starting order sync", {
    storeId: store.id,
  });

  // We'll implement this later
}

async function syncAbandonedCheckouts(store) {
  logger.info("Starting abandoned checkout sync", {
    storeId: store.id,
  });

  // We'll implement this later
}

async function syncShopifyStore(store) {
  try {
    await prisma.stores.update({
      where: {
        id: store.id,
      },
      data: {
        status: "syncing",
      },
    });

    await syncCustomers(store);

    await syncOrders(store);

    await syncAbandonedCheckouts(store);

    await prisma.stores.update({
      where: {
        id: store.id,
      },
      data: {
        status: "active",
        last_synced_at: new Date(),
      },
    });

    logger.info("Shopify sync completed", {
      storeId: store.id,
    });
  } catch (error) {
    logger.error("Shopify sync failed", {
      storeId: store.id,
      error: error.message,
    });

    await prisma.stores.update({
      where: {
        id: store.id,
      },
      data: {
        status: "error",
      },
    });
  }
}

module.exports = {
  syncShopifyStore,
};