'use strict';

const STALE_SYNC_MS = 20 * 60 * 1000;

function storeSyncEligibility(now = Date.now(), intervalMs = 15 * 60 * 1000) {
  return {
    platform: 'shopify',
    OR: [
      {
        status: { in: ['active', 'error'] },
        OR: [{ last_synced_at: null }, { last_synced_at: { lte: new Date(now - intervalMs) } }],
      },
      {
        status: 'syncing',
        updated_at: { lte: new Date(now - STALE_SYNC_MS) },
      },
    ],
  };
}

module.exports = { STALE_SYNC_MS, storeSyncEligibility };
