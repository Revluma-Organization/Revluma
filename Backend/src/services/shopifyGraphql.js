const axios = require('axios');
const { decrypt } = require('../utils/encryption');

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-07';

function accessToken(store) {
  if (!store?.access_token) throw new Error('shopify_access_token_missing');
  return decrypt(store.access_token);
}

async function shopifyGraphql(store, query, variables = {}) {
  const response = await axios.post(
    `https://${store.shop_domain}/admin/api/${API_VERSION}/graphql.json`,
    { query, variables },
    {
      headers: {
        'X-Shopify-Access-Token': accessToken(store),
        'Content-Type': 'application/json',
      },
      timeout: 30000,
      maxRedirects: 0,
    }
  );
  if (Array.isArray(response.data?.errors) && response.data.errors.length) {
    const error = new Error('shopify_graphql_request_failed');
    error.code = 'SHOPIFY_GRAPHQL_ERROR';
    throw error;
  }
  return response.data?.data || {};
}

module.exports = { API_VERSION, shopifyGraphql };
