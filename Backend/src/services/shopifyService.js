const axios = require("axios");

const dbConfig = require("../configs/database");
const prisma = dbConfig.prisma;

const { encrypt, decrypt } = require("../utils/encryption");

/**
 * Exchange Shopify authorization code for a permanent access token.
 */
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
    console.error(
      "Shopify Token Exchange Error:",
      error.response?.data || error.message
    );

    throw new Error("Failed to exchange Shopify authorization code.");
  }
};

/**
 * Get organization that belongs to the authenticated user.
 */
const getOrganizationByUser = async (userId) => {
  return prisma.organizations.findFirst({
    where: {
      owner_id: userId,
    },
  });
};

/**
 * Create or update a Shopify store.
 */
const upsertStore = async ({
  organizationId,
  shop,
  accessToken,
}) => {
  return prisma.stores.upsert({
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
};

/**
 * Retrieve decrypted Shopify access token.
 * Use this whenever making Shopify API requests.
 */
const getStoreAccessToken = (store) => {
  if (!store.access_token) {
    throw new Error("Store does not have an access token.");
  }

  return decrypt(store.access_token);
};

/**
 * Fire-and-forget background synchronization.
 */
const syncShopifyStore = async (store) => {
  try {
    console.log(
      `Starting Shopify sync for ${store.shop_domain}`
    );

    /**
     * Future implementation:
     *
     * await syncCustomers(store);
     * await syncOrders(store);
     * await syncProducts(store);
     * await syncAbandonedCarts(store);
     */

    console.log(
      `Historical sync queued for ${store.shop_domain}`
    );
  } catch (error) {
    console.error(
      `Shopify sync failed for ${store.shop_domain}:`,
      error.message
    );
  }
};

module.exports = {
  exchangeAccessToken,
  getOrganizationByUser,
  upsertStore,
  getStoreAccessToken,
  syncShopifyStore,
};