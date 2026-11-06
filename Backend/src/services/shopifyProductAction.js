'use strict';

const { shopifyGraphql } = require('./shopifyGraphql');
const { CommerceActionError } = require('./commerceActionPolicy');

const SCOPES_QUERY = `query RevlumaCurrentScopes { currentAppInstallation { accessScopes { handle } } }`;
const PRODUCT_QUERY = `query RevlumaActionProduct($id: ID!) { product(id: $id) { id title descriptionHtml } }`;
const UPDATE_MUTATION = `mutation RevlumaUpdateProductDescription($input: ProductInput!) {
  productUpdate(input: $input) { product { id title descriptionHtml } userErrors { field message } }
}`;
const COLLECTIONS_QUERY = `query RevlumaCollections($first: Int!, $after: String) {
  collections(first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { id title handle description sortOrder productsCount { count } ruleSet { appliedDisjunctively rules { column relation condition } } updatedAt }
  }
}`;

function graph(store, query, variables, graphql) {
  return (graphql || shopifyGraphql)(store, query, variables);
}

async function liveScopes(store, graphql) {
  const data = await graph(store, SCOPES_QUERY, {}, graphql);
  const scopes = data?.currentAppInstallation?.accessScopes;
  if (!Array.isArray(scopes)) throw new CommerceActionError('SHOPIFY_SCOPE_CHECK_UNAVAILABLE', 'Shopify did not confirm the installation access scopes.', 502);
  return scopes.map(item => String(item.handle || '')).filter(Boolean);
}

async function requireLiveScope(store, requiredScope, graphql) {
  const scopes = await liveScopes(store, graphql);
  if (!scopes.includes(requiredScope)) {
    throw new CommerceActionError('REQUIRED_SCOPE_NOT_GRANTED', `The live Shopify installation does not grant ${requiredScope}. Reauthorization is required; no mutation was attempted.`, 403);
  }
  return scopes;
}

async function readProduct(store, id, graphql) {
  const data = await graph(store, PRODUCT_QUERY, { id }, graphql);
  const product = data?.product;
  if (!product || product.id !== id || typeof product.descriptionHtml !== 'string') {
    throw new CommerceActionError('PRODUCT_NOT_READABLE', 'Shopify did not return a readable product matching the requested GID.', 404);
  }
  return { id: product.id, title: String(product.title || ''), description: product.descriptionHtml };
}

async function updateProductDescription(store, id, description, graphql) {
  let data;
  try {
    data = await graph(store, UPDATE_MUTATION, { input: { id, descriptionHtml: description } }, graphql);
  } catch (cause) {
    // A transport or top-level GraphQL failure is ambiguous: Shopify may have
    // committed before the connection failed. Callers must reconcile, not retry.
    const error = new CommerceActionError('SHOPIFY_MUTATION_OUTCOME_UNCERTAIN', 'Shopify did not confirm the mutation outcome. Reconcile the product before any further action.', 502);
    error.causeCode = cause?.code || null;
    throw error;
  }
  const payload = data?.productUpdate;
  if (Array.isArray(payload?.userErrors) && payload.userErrors.length) {
    throw new CommerceActionError('SHOPIFY_PRODUCT_UPDATE_REJECTED', 'Shopify rejected the product update without applying it.', 422);
  }
  const product = payload?.product;
  if (!product || product.id !== id || product.descriptionHtml !== description) {
    throw new CommerceActionError('SHOPIFY_MUTATION_OUTCOME_UNCERTAIN', 'Shopify did not return a product matching the intended update. Reconciliation is required.', 502);
  }
  return { id: product.id, title: String(product.title || ''), description: product.descriptionHtml };
}

function collectionNode(node) {
  if (!node?.id || typeof node.title !== 'string') return null;
  return {
    id: node.id,
    title: node.title,
    handle: String(node.handle || ''),
    description: String(node.description || ''),
    sort_order: node.sortOrder || null,
    product_count: Number(node.productsCount?.count || 0),
    smart_rules: node.ruleSet ? {
      applied_disjunctively: Boolean(node.ruleSet.appliedDisjunctively),
      rules: (node.ruleSet.rules || []).map(rule => ({ column: rule.column, relation: rule.relation, condition: rule.condition })),
    } : null,
    updated_at: node.updatedAt || null,
  };
}

async function listCollections(store, { first = 50, after = null } = {}, graphql) {
  const data = await graph(store, COLLECTIONS_QUERY, { first, after }, graphql);
  const connection = data?.collections;
  if (!connection || !Array.isArray(connection.nodes) || !connection.pageInfo) {
    throw new CommerceActionError('COLLECTIONS_READ_INVALID', 'Shopify returned an invalid collections response.', 502);
  }
  return {
    collections: connection.nodes.map(collectionNode).filter(Boolean),
    page_info: { has_next_page: Boolean(connection.pageInfo.hasNextPage), end_cursor: connection.pageInfo.endCursor || null },
  };
}

module.exports = {
  SCOPES_QUERY, PRODUCT_QUERY, UPDATE_MUTATION, COLLECTIONS_QUERY,
  liveScopes, requireLiveScope, readProduct, updateProductDescription, listCollections, collectionNode,
};
