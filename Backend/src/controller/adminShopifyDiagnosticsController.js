/**
 * Admin-only, read-only access diagnostic for one Shopify store.
 * Protected by requireAdminKey at the router; no-store cache; safe schema.
 */
'use strict';

const { prisma } = require('../configs/database');
const { buildStoreAccessDiagnostic } = require('../services/shopifyAccessDiagnostic');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getShopifyStoreAccess(req, res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  try {
    const { storeId } = req.params;
    if (!UUID_RE.test(String(storeId || ''))) {
      return res.status(400).json({ success: false, error: 'store_id_must_be_a_uuid' });
    }
    const store = await prisma.stores.findFirst({
      where: { id: storeId, platform: 'shopify' },
      select: {
        id: true,
        organization_id: true,
        platform: true,
        shop_domain: true,
        status: true,
        installed_at: true,
        last_synced_at: true,
        granted_scopes: true,
        access_token: true,
      },
    });
    if (!store) {
      return res.status(404).json({ success: false, error: 'store_not_found' });
    }
    const diagnostic = await buildStoreAccessDiagnostic({ store });
    return res.status(200).json({ success: true, diagnostic });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'diagnostic_failed', error_code: error?.code || error?.name || 'diagnostic_error' });
  }
}

module.exports = { getShopifyStoreAccess };
