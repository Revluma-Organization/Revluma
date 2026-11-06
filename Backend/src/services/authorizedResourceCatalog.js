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
const metafields = 'id namespace key type value createdAt updatedAt owner { __typename }';
const linePage = nested('lineItems', 'id title quantity', 100);
const definitions = {
  'collections': definition(['read_products'], connection('collections', `id title handle description descriptionHtml sortOrder updatedAt productsCount { count } ruleSet { appliedDisjunctively rules { column relation condition } }`), node),
  'shop.policies': definition(['read_content'], singleton('shop', 'shopPolicies { type body url }'), value => value.shopPolicies || []),
  'shop.shipping_configuration': definition(['read_shipping'], connection('deliveryProfiles', 'id name default coversAllItems activeMethodDefinitionsCount zoneCountryCount createdAt'), node),
  'shop.taxes': definition(['read_products'], singleton('shop', 'taxesIncluded taxShipping'), value => [{ id: 'SHOP', ...value }]),
  'product.publications': definition(['read_publications'], connection('publications', `id name autoPublish ${nested('products', 'id', 100)}`), node),
  'price-lists': definition(['read_price_lists'], connection('priceLists', 'id name currency fixedPricesCount createdAt catalog { id title }'), node),
  'customer.addresses': definition(['read_customers'], connection('customers', `id ${nested('addresses', 'id address1 address2 city company country countryCode firstName lastName phone province provinceCode zip', 100)}`), node),
  'customer.metafields': definition(['read_customers'], connection('customers', 'id metafields(first: 25, namespace: "revluma") { nodes { id namespace key type value jsonValue } pageInfo { hasNextPage endCursor } }'), node),
  'companies': definition(['read_companies'], connection('companies', 'id name createdAt updatedAt'), node),
  'order.returns': definition(['read_returns'], connection('returns', `id name status createdAt ${nested('returnLineItems', 'id quantity returnReason returnReasonNote', 100)}`), node),
  'order.risk': definition(['read_orders'], connection('orders', 'id name risk { recommendation assessments { riskLevel facts { description response } } }'), node),
  'order.fulfillment_orders': definition(['read_merchant_managed_fulfillment_orders'], connection('fulfillmentOrders', `id status requestStatus createdAt updatedAt assignedLocation { name } ${nested('lineItems', 'id quantity', 100)}`), node),
  'discount-nodes': definition(['read_discounts'], connection('discountNodes', `id ... on DiscountCodeBasic { title status ${nested('codes', 'code')} } ... on DiscountAutomaticBasic { title status } ... on DiscountCodeBxgy { title status ${nested('codes', 'code')} } ... on DiscountAutomaticBxgy { title status } ... on DiscountCodeFreeShipping { title status ${nested('codes', 'code')} } ... on DiscountAutomaticFreeShipping { title status }`), node),
  'markets': definition(['read_markets'], connection('markets', `id name enabled primary createdAt updatedAt currencySettings { baseCurrency { currencyCode } } ${nested('webPresences', 'rootUrls { url locale }', 10)}`), node),
  'contextual-pricing': definition(['read_markets'], connection('priceLists', 'id name currency parent { adjustment { type value } }'), node),
  'content.pages': definition(['read_content'], connection('pages', 'id title handle body bodySummary createdAt updatedAt onlineStoreUrl seo { title description }'), node),
  'content.blogs': definition(['read_content'], connection('blogs', `id title handle createdAt updatedAt seo { title description } ${nested('articles', 'id title handle body publishedAt onlineStoreUrl authorV2 { name }', 100)}`), node),
  'content.redirects': definition(['read_content'], connection('urlRedirects', 'id path target createdAt'), node),
  'online-store.menus': definition(['read_content'], connection('menus', `id handle title ${nested('items', 'id title type url', 100)}`), node),
  'themes': definition(['read_themes'], connection('themes', 'id name role createdAt updatedAt processing'), node),
  'metafields.products': definition(['read_products'], connection('metafields', metafields, '$ownerType: MetafieldOwnerType!'), node),
  'metafields.customers': definition(['read_customers'], connection('metafields', `${metafields} owner { __typename ... on Customer { id } }`, '$ownerType: MetafieldOwnerType!'), node),
  'metafields.orders': definition(['read_orders'], connection('metafields', metafields, '$ownerType: MetafieldOwnerType!'), node),
  'metafields.shop': definition(['read_products'], connection('metafields', metafields, '$ownerType: MetafieldOwnerType!'), node),
  'metaobjects': definition(['read_metaobjects'], connection('metaobjects', 'id type handle displayName updatedAt fields { key type value }'), node),
  'analytics.reports': definition(['read_reports'], connection('reports', 'id name query createdAt updatedAt'), node),
  'bulk-operations': definition(['read_products'], connection('bulkOperations', 'id status errorCode createdAt completedAt objectCount url'), node),
  'draft-orders': definition(['read_draft_orders'], connection('draftOrders', `id name status createdAt updatedAt totalPriceSet ${MONEY} ${linePage}`), node),
  'marketing-events': definition(['read_marketing_events'], connection('marketingEvents', 'id type remoteId startedAt endedAt scheduledToEndAt description marketingChannelType sourceAndMedium utmCampaign utmMedium utmSource'), node),
  'product.media': definition(['read_products'], connection('products', `id title ${nested('media', 'id mediaContentType status alt', 100)}`), node),
};

const OWNER_TYPES = Object.freeze({
  'customer.metafields': 'CUSTOMER', 'metafields.products': 'PRODUCT',
  'metafields.customers': 'CUSTOMER', 'metafields.orders': 'ORDER', 'metafields.shop': 'SHOP',
});
// QueryRoot.metafields requires ownerType on this API version.
for (const [id, ownerType] of Object.entries(OWNER_TYPES)) {
  const entry = definitions[id];
  entry.query = entry.query.replace(`${entry.root}(first: $first, after: $after)`, `${entry.root}(first: $first, after: $after, ownerType: $ownerType)`);
  entry.variables = { ownerType };
}
// Metaobject definitions have a separate root but share the registry domain.
definitions['metaobject-definitions'] = definition(['read_metaobject_definitions'], connection('metaobjectDefinitions', 'id type name fieldDefinitions { key name type { name } }'), node);

const ADDITIONAL_REGISTRY = Object.freeze([
  { id: 'draft-orders', queryRoots: ['draftOrders'], name: 'Draft orders and line items', surface: 'graphql', category: 'orders', scopes: ['read_draft_orders'], approval: 'none', planRestrictions: [], restrictions: [], acquisition: 'implemented_unverified', verification: 'not_verified' },
  { id: 'marketing-events', queryRoots: ['marketingEvents'], name: 'Marketing events and attribution metadata', surface: 'graphql', category: 'marketing', scopes: ['read_marketing_events'], approval: 'none', planRestrictions: [], restrictions: [], acquisition: 'implemented_unverified', verification: 'not_verified' },
  { id: 'price-rules', name: 'Legacy price rules (removed from Admin GraphQL 2026-10)', surface: 'graphql', category: 'discounts', scopes: ['read_price_rules'], approval: 'none', planRestrictions: [], restrictions: ['Removed from the public GraphQL schema in 2026-10; use discount-nodes for supported discount data'], acquisition: 'blocked', verification: 'not_applicable' },
  { id: 'metaobject-definitions', queryRoots: ['metaobjectDefinitions'], name: 'Metaobject definitions and field schemas', surface: 'graphql', category: 'metafields', scopes: ['read_metaobject_definitions'], approval: 'none', planRestrictions: [], restrictions: [], acquisition: 'implemented_unverified', verification: 'not_verified' },
]);

function getAuthorizedResource(id) { return definitions[id] || null; }
function authorizedResourceIds() { return Object.keys(definitions); }

module.exports = { definitions, ADDITIONAL_REGISTRY, getAuthorizedResource, authorizedResourceIds, PAGE };
