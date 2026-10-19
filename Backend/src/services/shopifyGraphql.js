const axios = require('axios');
const { decrypt } = require('../utils/encryption');
const { getShopifyApiVersion } = require('../utils/shopify');

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-10';

function safeGraphqlErrors(errors) {
  return (Array.isArray(errors) ? errors : []).slice(0, 5).map((item) => ({
    message: String(item?.message || 'Unknown Shopify GraphQL error').slice(0, 300),
    codes: Array.isArray(item?.extensions?.code) ? item.extensions.code.slice(0, 5) : item?.extensions?.code ? [String(item.extensions.code).slice(0, 80)] : [],
    fields: Array.isArray(item?.field) ? item.field.slice(0, 8) : undefined,
  }));
}

function accessToken(store) {
  if (!store?.access_token) throw new Error('shopify_access_token_missing');
  return decrypt(store.access_token);
}

async function shopifyGraphql(store, query, variables = {}) {
  const apiVersion = getShopifyApiVersion();
  let response;
  try {
    response = await axios.post(
      `https://${store.shop_domain}/admin/api/${apiVersion}/graphql.json`,
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
  } catch (cause) {
    const error = new Error('shopify_graphql_http_request_failed');
    error.code = 'SHOPIFY_GRAPHQL_HTTP_ERROR';
    error.status = cause.response?.status || null;
    error.shopifyErrors = safeGraphqlErrors(cause.response?.data?.errors);
    error.networkCode = cause.code || null;
    throw error;
  }
  if (Array.isArray(response.data?.errors) && response.data.errors.length) {
    const error = new Error('shopify_graphql_request_failed');
    error.code = 'SHOPIFY_GRAPHQL_ERROR';
    error.status = response.status;
    error.shopifyErrors = safeGraphqlErrors(response.data.errors);
    throw error;
  }
  return response.data?.data || {};
}

module.exports = { API_VERSION, shopifyGraphql };
