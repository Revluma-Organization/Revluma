'use strict';

/**
 * Centralized permission registry: scope → capability → synced domains.
 *
 * One answer, shared by the sync engine, the data-health engine, the
 * authorization flow, Integrations and Rev, to these questions:
 *
 *  - Which merchant-meaningful capability does a synced domain belong to?
 *  - Which Shopify access scopes does that capability need?
 *  - Is the capability granted for this installation, missing a scope the
 *    merchant can grant, or genuinely unavailable (removed API, theme-only
 *    surface, plan-gated feature)?
 *  - Which scopes must a reauthorization request — and never more?
 *
 * Read-only boundary: only `read_*` scopes are ever *added* by a
 * reauthorization. Scopes the installation already holds are preserved
 * verbatim so a reauthorization can never silently reduce access; Shopify
 * shows the merchant only the newly requested permissions.
 *
 * Pure module: no database, no network. Tests enforce that every synced
 * domain maps to exactly one capability, so a new resource cannot ship
 * without a permission decision.
 */

const { getAuthorizedResource, authorizedResourceIds } = require('./authorizedResourceCatalog');
const { getResource } = require('./resourceRegistry');

const REGISTRY_VERSION = 'revluma-permissions-v1';

const MATERIALITY = Object.freeze({
  CORE: 'core',         // Rev's primary analyses depend on it; missing => merchant action
  STANDARD: 'standard', // commonly used; disclosed whenever a question depends on it
  EXTENDED: 'extended', // enrichment; disclosed only when a question depends on it
});

const AVAILABILITY = Object.freeze({
  REQUESTABLE: 'requestable',         // a merchant can grant it through Shopify OAuth
  PLAN_RESTRICTED: 'plan_restricted', // needs a Shopify plan/feature most stores lack
  UNSUPPORTED: 'unsupported',         // Shopify does not expose it to this app at all
  NONE_REQUIRED: 'none_required',     // no scope needed (storefront pixel, shop identity)
});

const READ_SCOPE = /^read_[a-z_]+$/;

/*
 * Capability catalog. `scopes` lists every scope the capability needs; a
 * `read_x` requirement is also satisfied by a granted `write_x` (Shopify
 * implies read from write). `domains` are store_sync_domain_states.domain
 * values. `explanation` is merchant-facing: why Revluma asks, in one sentence.
 */
const CAPABILITIES = Object.freeze([
  {
    id: 'orders', label: 'Orders, payments and refunds', materiality: MATERIALITY.CORE,
    availability: AVAILABILITY.REQUESTABLE, scopes: ['read_orders'],
    domains: ['orders', 'transactions', 'refunds', 'fulfillments', 'order.risk', 'metafields.orders', 'bulk-operations'],
    explanation: 'Revenue, order, refund and fulfilment answers are computed from your Shopify orders.',
  },
  {
    id: 'checkouts', label: 'Abandoned checkouts', materiality: MATERIALITY.CORE,
    availability: AVAILABILITY.REQUESTABLE, scopes: ['read_orders'],
    domains: ['abandoned_checkouts'],
    explanation: 'Checkout abandonment analysis needs read access to abandoned checkouts.',
  },
  {
    id: 'products', label: 'Products and catalog', materiality: MATERIALITY.CORE,
    availability: AVAILABILITY.REQUESTABLE, scopes: ['read_products'],
    domains: ['products', 'variants', 'collections', 'product.media', 'metafields.products', 'metafields.shop', 'shop.taxes'],
    explanation: 'Product performance answers need your catalog.',
  },
  {
    id: 'inventory', label: 'Inventory and locations', materiality: MATERIALITY.CORE,
    availability: AVAILABILITY.REQUESTABLE, scopes: ['read_inventory', 'read_locations'],
    domains: ['inventory', 'locations'],
    explanation: 'Stock-level answers need inventory quantities per location.',
  },
  {
    id: 'customers', label: 'Customers', materiality: MATERIALITY.STANDARD,
    availability: AVAILABILITY.REQUESTABLE, scopes: ['read_customers'],
    domains: ['customers', 'customer_journeys', 'customer.addresses', 'customer.metafields', 'metafields.customers'],
    explanation: 'Retention and repeat-customer answers need customer records.',
  },
  {
    id: 'storefront_events', label: 'Storefront activity', materiality: MATERIALITY.STANDARD,
    availability: AVAILABILITY.NONE_REQUIRED, scopes: [],
    domains: ['pixel_events'],
    explanation: 'Traffic answers use storefront events collected by the Revluma pixel.',
  },
  {
    id: 'store_profile', label: 'Store profile', materiality: MATERIALITY.STANDARD,
    availability: AVAILABILITY.NONE_REQUIRED, scopes: [],
    domains: ['store_domains'],
    explanation: 'Store name, currency and timezone set the reporting calendar.',
  },
  {
    id: 'returns', label: 'Returns', materiality: MATERIALITY.EXTENDED,
    availability: AVAILABILITY.REQUESTABLE, scopes: ['read_orders', 'read_returns'],
    domains: ['order.returns'],
    explanation: 'Return reasons explain refunds beyond the refund amount.',
  },
  {
    id: 'fulfillment_orders', label: 'Fulfillment orders', materiality: MATERIALITY.EXTENDED,
    availability: AVAILABILITY.REQUESTABLE, scopes: ['read_merchant_managed_fulfillment_orders'],
    domains: ['order.fulfillment_orders'],
    explanation: 'Fulfilment-order status explains shipping delays.',
  },
  {
    id: 'discounts', label: 'Discounts', materiality: MATERIALITY.EXTENDED,
    availability: AVAILABILITY.REQUESTABLE, scopes: ['read_discounts'],
    domains: ['discount-nodes'],
    explanation: 'Discount definitions explain promotion-driven sales changes.',
  },
  {
    id: 'draft_orders', label: 'Draft orders', materiality: MATERIALITY.EXTENDED,
    availability: AVAILABILITY.REQUESTABLE, scopes: ['read_draft_orders'],
    domains: ['draft-orders'],
    explanation: 'Draft orders show manually created and invoiced sales.',
  },
  {
    id: 'marketing_events', label: 'Marketing activities', materiality: MATERIALITY.EXTENDED,
    availability: AVAILABILITY.REQUESTABLE, scopes: ['read_marketing_events'],
    domains: ['marketing-events'],
    explanation: 'Marketing activities give context to traffic and sales changes.',
  },
  {
    id: 'shipping', label: 'Shipping configuration', materiality: MATERIALITY.EXTENDED,
    availability: AVAILABILITY.REQUESTABLE, scopes: ['read_shipping'],
    domains: ['shop.shipping_configuration'],
    explanation: 'Shipping profiles explain delivery-cost questions.',
  },
  {
    id: 'content', label: 'Pages and blogs', materiality: MATERIALITY.EXTENDED,
    availability: AVAILABILITY.REQUESTABLE, scopes: ['read_content'],
    domains: ['content.pages', 'content.blogs'],
    explanation: 'Store pages and blogs give content context.',
  },
  {
    id: 'themes', label: 'Themes', materiality: MATERIALITY.EXTENDED,
    availability: AVAILABILITY.REQUESTABLE, scopes: ['read_themes'],
    domains: ['themes'],
    explanation: 'Theme metadata gives storefront context.',
  },
  {
    id: 'store_policies', label: 'Store policies', materiality: MATERIALITY.EXTENDED,
    availability: AVAILABILITY.REQUESTABLE, scopes: ['read_legal_policies'],
    domains: ['shop.policies'],
    explanation: 'Refund and shipping policies let Rev relate refunds to your stated policy.',
  },
  {
    id: 'url_redirects', label: 'URL redirects', materiality: MATERIALITY.EXTENDED,
    availability: AVAILABILITY.REQUESTABLE, scopes: ['read_online_store_navigation'],
    domains: ['content.redirects'],
    explanation: 'Redirects help explain storefront traffic changes after URL changes.',
  },
  {
    id: 'publications', label: 'Sales-channel publishing', materiality: MATERIALITY.EXTENDED,
    availability: AVAILABILITY.REQUESTABLE, scopes: ['read_publications'],
    domains: ['product.publications'],
    explanation: 'Publishing data shows which channels each product is available on.',
  },
  {
    id: 'markets', label: 'Markets', materiality: MATERIALITY.EXTENDED,
    availability: AVAILABILITY.REQUESTABLE, scopes: ['read_markets'],
    domains: ['markets'],
    explanation: 'Markets show which countries and currencies you sell in.',
  },
  {
    id: 'contextual_pricing', label: 'Market pricing', materiality: MATERIALITY.EXTENDED,
    availability: AVAILABILITY.REQUESTABLE, scopes: ['read_markets', 'read_price_lists'],
    domains: ['contextual-pricing'],
    explanation: 'Market price lists explain price differences between markets.',
  },
  {
    id: 'metaobjects', label: 'Custom data (metaobjects)', materiality: MATERIALITY.EXTENDED,
    availability: AVAILABILITY.REQUESTABLE, scopes: ['read_metaobjects', 'read_metaobject_definitions'],
    domains: ['metaobjects', 'metaobject-definitions'],
    explanation: 'Metaobjects hold custom store data some apps and themes rely on.',
  },
  {
    id: 'b2b', label: 'B2B companies and price lists', materiality: MATERIALITY.EXTENDED,
    availability: AVAILABILITY.PLAN_RESTRICTED, scopes: ['read_companies', 'read_price_lists'],
    domains: ['companies', 'price-lists'],
    explanation: 'B2B data exists only on Shopify plans with B2B enabled.',
    unavailableReason: 'B2B companies and price lists are only available on Shopify plans with B2B enabled.',
  },
  {
    id: 'navigation_menus', label: 'Navigation menus', materiality: MATERIALITY.EXTENDED,
    availability: AVAILABILITY.UNSUPPORTED, scopes: ['read_online_store_navigation'],
    domains: ['online-store.menus'],
    explanation: 'Navigation menus are exposed by Shopify only to theme apps.',
    unavailableReason: 'Shopify exposes navigation menus only to theme apps, so Revluma cannot read them.',
  },
  {
    id: 'analytics_reports', label: 'Shopify Analytics reports', materiality: MATERIALITY.EXTENDED,
    availability: AVAILABILITY.UNSUPPORTED, scopes: ['read_reports'],
    domains: ['analytics.reports'],
    explanation: 'Shopify removed saved Analytics reports from its public API.',
    unavailableReason: 'Shopify removed saved Analytics reports from its public API; Revluma computes metrics from synced records instead.',
  },
]);

// Infrastructure ledgers are tracked for operations but are not merchant data.
const INFRASTRUCTURE_DOMAINS = Object.freeze(['webhooks']);

const BY_ID = new Map(CAPABILITIES.map(capability => [capability.id, capability]));
const BY_DOMAIN = new Map();
for (const capability of CAPABILITIES) {
  for (const domain of capability.domains) {
    if (BY_DOMAIN.has(domain)) throw new Error(`permission registry: domain ${domain} mapped twice`);
    BY_DOMAIN.set(domain, capability);
  }
}

function parseScopes(value) {
  if (value instanceof Set) return new Set([...value].map(String));
  if (Array.isArray(value)) return new Set(value.map(item => String(item).trim()).filter(Boolean));
  return new Set(String(value || '').split(',').map(item => item.trim()).filter(Boolean));
}

function scopeSatisfied(granted, scope) {
  const set = granted instanceof Set ? granted : parseScopes(granted);
  return set.has(scope) || (scope.startsWith('read_') && set.has(`write_${scope.slice(5)}`));
}

/** Scopes a synced domain needs: the catalog + registry declaration, or the capability's. */
function domainScopes(domain) {
  const document = getAuthorizedResource(domain);
  const registry = getResource(domain);
  if (document || registry?.scopes?.length) {
    return [...new Set([...(registry?.scopes || []), ...(document?.scopes || [])])];
  }
  return [...(BY_DOMAIN.get(domain)?.scopes || [])];
}

function getCapability(id) {
  return BY_ID.get(id) || null;
}

function capabilityForDomain(domain) {
  return BY_DOMAIN.get(domain) || null;
}

function isInfrastructureDomain(domain) {
  return INFRASTRUCTURE_DOMAINS.includes(domain);
}

/**
 * Evaluate one capability against the granted scopes.
 * state: 'granted' | 'missing_scope' | 'plan_restricted' | 'unsupported'
 */
function evaluateCapability(capability, grantedScopes) {
  const definition = typeof capability === 'string' ? getCapability(capability) : capability;
  if (!definition) return null;
  const granted = parseScopes(grantedScopes);
  const missing = definition.scopes.filter(scope => !scopeSatisfied(granted, scope));
  let state;
  if (definition.availability === AVAILABILITY.UNSUPPORTED) state = 'unsupported';
  else if (missing.length === 0) state = 'granted';
  else if (definition.availability === AVAILABILITY.PLAN_RESTRICTED) state = 'plan_restricted';
  else state = 'missing_scope';
  return {
    capability: definition.id,
    label: definition.label,
    materiality: definition.materiality,
    availability: definition.availability,
    state,
    missing_scopes: state === 'missing_scope' ? missing : [],
    requestable: state === 'missing_scope' && missing.every(scope => READ_SCOPE.test(scope)),
    explanation: definition.explanation,
    unavailable_reason: definition.unavailableReason || null,
  };
}

function evaluatePermissions(grantedScopes) {
  return CAPABILITIES.map(capability => evaluateCapability(capability, grantedScopes));
}

/**
 * Domain-level access decision used by the sync engine before attempting a
 * domain: 'granted' | 'missing_scope' | 'plan_restricted' | 'unsupported'.
 */
function domainAccess(domain, grantedScopes) {
  const capability = capabilityForDomain(domain);
  const granted = parseScopes(grantedScopes);
  const missing = domainScopes(domain).filter(scope => !scopeSatisfied(granted, scope));
  if (capability?.availability === AVAILABILITY.UNSUPPORTED) {
    return { state: 'unsupported', capability: capability.id, missing_scopes: [], reason: capability.unavailableReason };
  }
  if (missing.length === 0) return { state: 'granted', capability: capability?.id || null, missing_scopes: [] };
  if (capability?.availability === AVAILABILITY.PLAN_RESTRICTED) {
    return { state: 'plan_restricted', capability: capability.id, missing_scopes: missing, reason: capability.unavailableReason };
  }
  return { state: 'missing_scope', capability: capability?.id || null, missing_scopes: missing };
}

/**
 * The exact scope set for a reauthorization URL.
 *
 * - `granted` scopes are preserved verbatim (never re-asked: Shopify shows
 *   the merchant only the delta, and preserving them prevents an accidental
 *   reduction of the existing grant).
 * - Only missing, requestable `read_*` scopes of the named capabilities are
 *   added. Unsupported/plan-restricted capabilities and write scopes are
 *   refused with a typed error instead of being silently dropped.
 */
function reauthorizationScopes(grantedScopes, capabilityIds) {
  const granted = parseScopes(grantedScopes);
  const requested = [];
  const refused = [];
  for (const id of [...new Set(capabilityIds || [])]) {
    const evaluation = evaluateCapability(id, granted);
    if (!evaluation) { refused.push({ capability: id, reason: 'unknown_capability' }); continue; }
    if (evaluation.state === 'granted') continue;
    if (!evaluation.requestable) { refused.push({ capability: id, reason: evaluation.state }); continue; }
    requested.push(...evaluation.missing_scopes);
  }
  const added = [...new Set(requested)].filter(scope => READ_SCOPE.test(scope) && !scopeSatisfied(granted, scope));
  return {
    scopes: [...new Set([...granted, ...added])].sort(),
    added: added.sort(),
    preserved: [...granted].sort(),
    refused,
  };
}

/** Every synced domain must map to a capability or be infrastructure. */
function unmappedDomains(domains) {
  return (domains || []).filter(domain => !BY_DOMAIN.has(domain) && !isInfrastructureDomain(domain));
}

function catalogDomains() {
  return authorizedResourceIds();
}

module.exports = {
  REGISTRY_VERSION,
  MATERIALITY,
  AVAILABILITY,
  CAPABILITIES,
  INFRASTRUCTURE_DOMAINS,
  READ_SCOPE,
  parseScopes,
  scopeSatisfied,
  domainScopes,
  getCapability,
  capabilityForDomain,
  isInfrastructureDomain,
  evaluateCapability,
  evaluatePermissions,
  domainAccess,
  reauthorizationScopes,
  unmappedDomains,
  catalogDomains,
};
