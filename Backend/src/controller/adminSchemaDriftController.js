/**
 * Admin-only, read-only schema↔registry drift report (message-6 §4).
 * Runs GraphQL introspection against the store, then the pure comparator.
 * Never returns tokens or customer data. Findings = discovery delta, NOT coverage.
 */
'use strict';

const { prisma } = require('../configs/database');
const { shopifyGraphql } = require('../services/shopifyGraphql');
const { compareRegistryAgainstSchema } = require('../services/capabilityDiffer');
const { REGISTRY, REGISTRY_VERSION } = require('../services/resourceRegistry');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const INTROSPECTION_QUERY = `query RevlumaSchemaIntrospection {
  __schema {
    queryType { name fields { name } }
    mutationType { name fields { name } }
    types { name }
  }
}`;

async function getShopifyStoreSchemaDrift(req, res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  try {
    const { storeId } = req.params;
    if (!UUID_RE.test(String(storeId || ''))) {
      return res.status(400).json({ success: false, error: 'store_id_must_be_a_uuid' });
    }
    const store = await prisma.stores.findFirst({
      where: { id: storeId, platform: 'shopify' },
      select: { id: true, shop_domain: true },
    });
    if (!store) return res.status(404).json({ success: false, error: 'store_not_found' });

    let schema = null;
    try {
      schema = await shopifyGraphql(store, INTROSPECTION_QUERY, {});
    } catch (error) {
      return res.status(502).json({
        success: false,
        error: 'introspection_failed',
        error_code: error?.code || error?.name || 'introspection_error',
        note: 'Some stores/plans disallow introspection tokens; drift report cannot be produced — this is NOT a clean bill of health.',
      });
    }
    const comparison = compareRegistryAgainstSchema(schema, REGISTRY);
    return res.status(200).json({
      success: true,
      report: 'schema_registry_drift_v1',
      registry_version: REGISTRY_VERSION,
      store: { id: store.id, shop_domain: store.shop_domain },
      ...comparison,
      disclaimer: 'Findings are discovery deltas. An absent root here means "not visible to this token" — never "data does not exist", and never proof of ingestion.',
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'schema_drift_failed', error_code: error?.code || error?.name || 'schema_drift_error' });
  }
}

module.exports = { getShopifyStoreSchemaDrift };
