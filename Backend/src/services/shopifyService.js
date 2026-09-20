const axios = require("axios");
const crypto = require('crypto');

const dbConfig = require("../configs/database");
const prisma = dbConfig.prisma;

const { encrypt, decrypt } = require("../utils/encryption");
const logger = require('../utils/logger');

function createStoreTrackingKey(storeId) {
  const secret = process.env.EVENT_TRACKING_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('EVENT_TRACKING_SECRET or JWT_SECRET is required.');
  const signature = crypto.createHmac('sha256', secret).update(storeId).digest('hex');
  return `${storeId}.${signature}`;
}

/**Exchange Shopify authorization code for a permanent access token.*/
const exchangeAccessToken = async (shop, code) => {
  try {
    const response = await axios.post(
      `https://${shop}/admin/oauth/access_token`,
      {
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        code,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );

    if (!response.data.access_token) {
      throw new Error("Shopify did not return an access token.");
    }

    return response.data.access_token;
  } catch (error) {
    logger.error('shopify_token_exchange_failed', { message: error.response?.data || error.message });

    throw new Error("Failed to exchange Shopify authorization code.");
  }
};

/**Get organization that belongs to the authenticated user.*/
const getOrganizationByUser = async (userId) => {
  return prisma.organizations.findFirst({
    where: {
      owner_id: userId,
    },
  });
};

/**Create or update a Shopify store.*/
const upsertStore = async ({
  organizationId,
  shop,
  accessToken,
}) => {
  const store = await prisma.stores.upsert({
    where: {
      organization_id_shop_domain: {
        organization_id: organizationId,
        shop_domain: shop,
      },
    },

    update: {
      platform: "shopify",
      access_token: encrypt(accessToken),
      status: "active",
      installed_at: new Date(),
      updated_at: new Date(),
    },

    create: {
      organization_id: organizationId,
      platform: "shopify",
      shop_domain: shop,
      access_token: encrypt(accessToken),
      status: "active",
      installed_at: new Date(),
    },
  });

  if (!store.public_tracking_key) {
    return prisma.stores.update({
      where: { id: store.id },
      data: { public_tracking_key: createStoreTrackingKey(store.id) },
    });
  }
  return store;
};

/**Retrieve decrypted Shopify access token. Use this whenever making Shopify API requests.*/
const getStoreAccessToken = (store) => {
  if (!store.access_token) {
    throw new Error("Store does not have an access token.");
  }

  return decrypt(store.access_token);
};

/*Fire-and-forget background synchronization.*/
const syncShopifyStore = async (store) => {
  try {
    logger.info('shopify_sync_started', { shop_domain: store.shop_domain });
    const { syncShopifyStore: runSync } = require('./shopifySync');
    return await runSync(store);
  } catch (error) {
    logger.error('shopify_sync_failed', { shop_domain: store.shop_domain, message: error.message });
    throw error;
  }
};

module.exports = {
  exchangeAccessToken,
  getOrganizationByUser,
  upsertStore,
  getStoreAccessToken,
  syncShopifyStore,
};