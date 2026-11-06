'use strict';

// Contracts for a future Shopify Sidekick app extension. These are deliberately
// not advertised as an installed/deployable extension: managed installation and
// token exchange are prerequisites and are not implemented in this service.
const DATA_TOOLS = Object.freeze([
  {
    name: 'revluma_get_merchant_capability',
    description: 'Read Revluma resource coverage, live scope availability, freshness, and explicit limitations for one Shopify store.',
    input_schema: { type: 'object', additionalProperties: false, required: ['store_id'], properties: { store_id: { type: 'string', format: 'uuid' } } },
    output: 'JSON capability report with resource links to Revluma; never includes access tokens.',
  },
  {
    name: 'revluma_list_collections',
    description: 'Read one live page of Shopify collections and smart-collection rules within the merchant-granted read_products scope.',
    input_schema: { type: 'object', additionalProperties: false, required: ['store_id'], properties: { store_id: { type: 'string', format: 'uuid' }, first: { type: 'integer', minimum: 1, maximum: 100 }, after: { type: ['string', 'null'] } } },
    output: 'JSON collection nodes and pagination metadata.',
  },
]);

const ACTION_INTENTS = Object.freeze([
  {
    name: 'revluma_preview_product_description',
    target_action: 'product_update_description',
    behavior: 'Open Revluma merchant confirmation surface; never execute a mutation directly from model output.',
    prerequisites: ['managed_installation', 'token_exchange', 'merchant_confirmation_ui'],
    deployable: false,
  },
]);

function extensionManifest() {
  return {
    contract_version: 'sidekick_extension_foundation_v1',
    deployable: false,
    blocked_prerequisites: ['managed_installation', 'token_exchange', 'shopify_extension_configuration_and_deployment'],
    authentication: { current_backend: 'revluma_org_jwt', sidekick_token_exchange: 'not_implemented' },
    data_tools: DATA_TOOLS,
    action_intents: ACTION_INTENTS,
    safeguards: ['tenant_scoping', 'live_scope_checks', 'preview', 'explicit_merchant_confirmation', 'audit', 'guarded_rollback'],
  };
}

module.exports = { DATA_TOOLS, ACTION_INTENTS, extensionManifest };
