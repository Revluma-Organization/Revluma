'use strict';

// Server-owned GraphQL documents. Merchants select a resource id and pagination
// only; they can never supply a query, selection set, or arbitrary variables.
const PAGE = 'pageInfo { hasNextPage endCursor }';
const MONEY = '{ shopMoney { amount currencyCode } }';
const nested = (name, fields, first = 25) => `${name}(first: ${first}) { nodes { ${fields} } ${PAGE} }`;

function connection(root, selection, variables = '') {
  return {
    root,
    query: `query RevlumaAuthorized_${root}($first: Int!, $after: String${variables ? `, ${variables}` : ''}) { ${root}(first: $first, after: $after) { nodes { ${selection} } ${PAGE} } }`,
    paginated: true,
  };
}
function singleton(root, selection) {
  return { root, query: `query RevlumaAuthorized_${root} { ${root} { ${selection} } }`, paginated: false, singleton: true };
}
function definition(scopes, document, map) { return { scopes, ...document, map }; }

const node = value => value;
const metafields = 'id namespace key type value jsonValue createdAt updatedAt';
const ownerMetafields = nested('metafields', metafields, 100);
const linePage = nested('lineItems', 'id title quantity', 100);
const definitions = {
  'collections': definition(['read_products'], connection('collections', `id title handle description descriptionHtml sortOrder updatedAt productsCount { count } ruleSet { appliedDisjunctively rules { column relation condition } }`), node),
  'shop.policies': definition(['read_legal_policies'], singleton('shop', 'shopPolicies { type body url }'), value => value.shopPolicies || []),
  'shop.shipping_configuration': definition(['read_shipping'], connection('deliveryProfiles', 'id name default coversAllItems activeMethodDefinitionsCount zoneCountryCount createdAt'), node),
  'shop.taxes': definition(['read_products'], singleton('shop', 'taxesIncluded taxShipping'), value => [{ id: 'SHOP', ...value }]),
  'product.publications': definition(['read_publications'], connection('publications', `id name autoPublish ${nested('products', 'id', 100)}`), node),
  'price-lists': definition(['read_price_lists'], connection('priceLists', 'id name currency fixedPricesCount createdAt catalog { id title }'), node),
  'customer.addresses': definition(['read_customers'], connection('customers', `id ${nested('addressesV2', 'id address1 address2 city company country countryCode firstName lastName phone province provinceCode zip', 100)}`), node),
  'customer.metafields': definition(['read_customers'], connection('customers', `id ${ownerMetafields}`), node),
  'companies': definition(['read_companies'], connection('companies', 'id name createdAt updatedAt'), node),
  'order.returns': definition(['read_orders', 'read_returns'], connection('orders', `id name ${nested('returns', `id name status createdAt ${nested('returnLineItems', 'id quantity returnReason returnReasonNote', 100)}`, 25)}`), node),
  'order.risk': definition(['read_orders'], connection('orders', 'id name risk { recommendation assessments { riskLevel facts { description sentiment } } }'), node),
  'order.fulfillment_orders': definition(['read_merchant_managed_fulfillment_orders'], connection('fulfillmentOrders', `id status requestStatus createdAt updatedAt assignedLocation { name } ${nested('lineItems', 'id totalQuantity remainingQuantity', 100)}`), node),
  'discount-nodes': definition(['read_discounts'], connection('discountNodes', `id discount { __typename ... on DiscountCodeBasic { id title status ${nested('codes', 'code')} } ... on DiscountAutomaticBasic { id title status } ... on DiscountCodeBxgy { id title status ${nested('codes', 'code')} } ... on DiscountAutomaticBxgy { id title status } ... on DiscountCodeFreeShipping { id title status ${nested('codes', 'code')} } ... on DiscountAutomaticFreeShipping { id title status } }`), node),
  'markets': definition(['read_markets'], connection('markets', `id name enabled primary createdAt updatedAt currencySettings { baseCurrency { currencyCode } } ${nested('webPresences', 'rootUrls { url locale }', 10)}`), node),
  'contextual-pricing': definition(['read_markets'], connection('priceLists', 'id name currency parent { adjustment { type value } }'), node),
  'content.pages': definition(['read_content'], connection('pages', 'id title handle body bodySummary createdAt updatedAt isPublished publishedAt templateSuffix'), node),
  'content.blogs': definition(['read_content'], connection('blogs', `id title handle createdAt updatedAt commentPolicy templateSuffix tags ${nested('articles', 'id title handle body publishedAt authorV2 { name }', 100)}`), node),
  'content.redirects': definition(['read_online_store_navigation'], connection('urlRedirects', 'id path target createdAt'), node),
  'online-store.menus': definition(['read_online_store_navigation'], connection('menus', 'id handle title items { id title type url items { id title type url items { id title type url } } }'), node),
  'themes': definition(['read_themes'], connection('themes', 'id name role createdAt updatedAt processing'), node),
  'metafields.products': definition(['read_products'], connection('products', `id ${ownerMetafields}`), node),
  'metafields.customers': definition(['read_customers'], connection('customers', `id ${ownerMetafields}`), node),
  'metafields.orders': definition(['read_orders'], connection('orders', `id customer { id } ${ownerMetafields}`), node),
  'metafields.shop': definition(['read_products'], singleton('shop', `id ${ownerMetafields}`), value => [value]),
  'metaobjects': definition(['read_metaobjects'], connection('metaobjects', 'id type handle displayName updatedAt fields { key type value }'), node),
  'bulk-operations': definition(['read_products'], connection('bulkOperations', 'id status errorCode createdAt completedAt objectCount url'), node),
  'draft-orders': definition(['read_draft_orders'], connection('draftOrders', `id name status createdAt updatedAt totalPriceSet ${MONEY} ${linePage}`), node),
  'marketing-events': definition(['read_marketing_events'], connection('marketingEvents', 'id type remoteId startedAt endedAt scheduledToEndAt description marketingChannelType sourceAndMedium utmCampaign utmMedium utmSource'), node),
  'product.media': definition(['read_products'], connection('products', `id title ${nested('media', 'id mediaContentType status alt', 100)}`), node),
};

// Metaobject definitions have a separate root but share the registry domain.
definitions['metaobject-definitions'] = definition(['read_metaobject_definitions'], connection('metaobjectDefinitions', 'id type name fieldDefinitions { key name type { name } }'), node);

// Nested connections are completed through server-owned Node queries. Paths
// are relative to the parent record; child connection nodes do not appear in
// the path. No merchant-controlled type, field, or selection is interpolated.
const NESTED_SPECS = Object.freeze({
  'product.publications': { products: ['Publication', 'id'] },
  'customer.addresses': { addressesV2: ['Customer', 'id address1 address2 city company country countryCode firstName lastName phone province provinceCode zip'] },
  'customer.metafields': { metafields: ['Customer', metafields] },
  'metafields.products': { metafields: ['Product', metafields] },
  'metafields.customers': { metafields: ['Customer', metafields] },
  'metafields.orders': { metafields: ['Order', metafields] },
  'metafields.shop': { metafields: ['Shop', metafields] },
  'order.returns': {
    returns: ['Order', `id name status createdAt ${nested('returnLineItems', 'id quantity returnReason returnReasonNote', 100)}`],
    'returns.returnLineItems': ['Return', 'id quantity returnReason returnReasonNote'],
  },
  'order.fulfillment_orders': { lineItems: ['FulfillmentOrder', 'id totalQuantity remainingQuantity'] },
  'draft-orders': { lineItems: ['DraftOrder', 'id title quantity'] },
  'markets': { webPresences: ['Market', 'rootUrls { url locale }'] },
  'content.blogs': { articles: ['Blog', 'id title handle body publishedAt authorV2 { name }'] },
  'product.media': { media: ['Product', 'id mediaContentType status alt'] },
  'discount-nodes': { 'discount.codes': [null, 'code'] },
});
for (const [resourceId, specs] of Object.entries(NESTED_SPECS)) {
  definitions[resourceId].nested = Object.fromEntries(Object.entries(specs).map(([path, [parentType, selection]]) => [path, {
    parentType, selection, field: path.split('.').at(-1),
  }]));
}

const ADDITIONAL_REGISTRY = Object.freeze([
  { id: 'draft-orders', queryRoots: ['draftOrders'], name: 'Draft orders and line items', surface: 'graphql', category: 'orders', scopes: ['read_draft_orders'], approval: 'none', planRestrictions: [], restrictions: [], acquisition: 'implemented_unverified', verification: 'not_verified' },
  { id: 'marketing-events', queryRoots: ['marketingEvents'], name: 'Marketing events and attribution metadata', surface: 'graphql', category: 'marketing', scopes: ['read_marketing_events'], approval: 'none', planRestrictions: [], restrictions: [], acquisition: 'implemented_unverified', verification: 'not_verified' },
  { id: 'price-rules', name: 'Legacy price rules (removed from Admin GraphQL 2026-10)', surface: 'graphql', category: 'discounts', scopes: ['read_price_rules'], approval: 'none', planRestrictions: [], restrictions: ['Removed from the public GraphQL schema in 2026-10; use discount-nodes for supported discount data'], acquisition: 'blocked', verification: 'not_applicable' },
  { id: 'metaobject-definitions', queryRoots: ['metaobjectDefinitions'], name: 'Metaobject definitions and field schemas', surface: 'graphql', category: 'metafields', scopes: ['read_metaobject_definitions'], approval: 'none', planRestrictions: [], restrictions: [], acquisition: 'implemented_unverified', verification: 'not_verified' },
]);

function getAuthorizedResource(id) { return definitions[id] || null; }
function authorizedResourceIds() { return Object.keys(definitions); }

module.exports = { definitions, ADDITIONAL_REGISTRY, getAuthorizedResource, authorizedResourceIds, PAGE };
