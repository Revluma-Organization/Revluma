const axios = require('axios');
const { decrypt } = require('../utils/encryption');
const { getShopifyApiVersion } = require('../utils/shopify');

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-10';
const MAX_ATTEMPTS = 3;

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

function retryDelay(cause, attempt) {
  const retryAfter = Number(cause.response?.headers?.['retry-after']);
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.min(2000, retryAfter * 1000);
  return Math.min(1000, 100 * (2 ** attempt));
}

function retryable(cause) {
  const status = cause.response?.status;
  return status === 429 || status >= 500 || ['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'].includes(cause.code);
}

function throttled(errors) {
  return (Array.isArray(errors) ? errors : []).some(item => String(item?.extensions?.code || '').toUpperCase() === 'THROTTLED');
}

async function shopifyGraphql(store, query, variables = {}) {
  const apiVersion = getShopifyApiVersion();
  let lastError;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
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
      error.retryable = retryable(cause);
      lastError = error;
      if (attempt + 1 < MAX_ATTEMPTS && error.retryable) {
        await new Promise(resolve => setTimeout(resolve, retryDelay(cause, attempt)));
        continue;
      }
      throw error;
    }
    const errors = response.data?.errors;
    if (Array.isArray(errors) && errors.length) {
      const error = new Error('shopify_graphql_request_failed');
      error.code = 'SHOPIFY_GRAPHQL_ERROR';
      error.status = response.status;
      error.shopifyErrors = safeGraphqlErrors(errors);
      error.retryable = throttled(errors);
      lastError = error;
      if (attempt + 1 < MAX_ATTEMPTS && error.retryable) {
        await new Promise(resolve => setTimeout(resolve, 100 * (2 ** attempt)));
        continue;
      }
      throw error;
    }
    return response.data?.data || {};
  }
  throw lastError;
}

module.exports = { API_VERSION, shopifyGraphql };
