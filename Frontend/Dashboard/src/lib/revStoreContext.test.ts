// Store-grounded suggestion regressions.
//
// Two defects are pinned here. Generic filler starters invited questions Rev
// could not answer from the data it actually holds, and one starter ("Draft a
// sequence for inactive customers") advertised a campaign action that the
// read-only MVP boundary forbids. Suggestions must now come from the merchant's
// real connection state and every one must be a read-only investigation.

import { describe, expect, it } from "vitest";

import {
  UNKNOWN_STORE,
  buildStarters,
  hasSyncFailure,
  hasWebhookGap,
  isSyncIncomplete,
  isSyncNotStarted,
  isSyncStatusUnknown,
  isSyncStale,
  merchantActionRequired,
  dataStatusNote,
  storeContextFromResponse,
  storeLabel,
  type StoreContext,
} from "./revStoreContext";

const CONNECTED: StoreContext = {
  loaded: true,
  loadError: false,
  connected: true,
  shopDomain: "revluma-test-store-v1.myshopify.com",
  platform: "shopify",
  syncStatus: "complete",
  setupStatus: "complete",
  monitoringMode: "webhook_and_sync",
  lastSyncedAt: new Date().toISOString(),
  webhooksRegistered: 12,
  webhooksRequired: 12,
};

describe("storeLabel", () => {
  it("strips the myshopify.com suffix to a merchant-readable name", () => {
    expect(storeLabel(CONNECTED)).toBe("revluma-test-store-v1");
  });

  it("strips a scheme and path when a custom domain is recorded", () => {
    expect(storeLabel({ ...CONNECTED, shopDomain: "https://shop.example.com/admin" }))
      .toBe("shop.example.com");
  });

  it("falls back to a neutral label rather than inventing a store name", () => {
    expect(storeLabel(UNKNOWN_STORE)).toBe("my store");
    expect(storeLabel({ ...CONNECTED, shopDomain: "" })).toBe("my store");
  });
});

describe("data-health detection", () => {
  it("treats an unconnected store as incomplete sync = false, not connected", () => {
    expect(isSyncIncomplete(UNKNOWN_STORE)).toBe(false);
    expect(UNKNOWN_STORE.connected).toBe(false);
  });

  it("only labels an explicit in-progress status as active sync", () => {
    expect(isSyncIncomplete({ ...CONNECTED, syncStatus: "pending" })).toBe(true);
    expect(isSyncIncomplete({ ...CONNECTED, syncStatus: "in_progress" })).toBe(true);
    expect(isSyncIncomplete({ ...CONNECTED, monitoringMode: "awaiting_verified_sync" })).toBe(false);
    expect(isSyncIncomplete({ ...CONNECTED, syncStatus: "failed", monitoringMode: "awaiting_verified_sync" })).toBe(false);
    expect(isSyncIncomplete({ ...CONNECTED, syncStatus: "complete", monitoringMode: "sync_only_limited" })).toBe(false);
    expect(isSyncIncomplete(CONNECTED)).toBe(false);
  });

  it("keeps not-started and unknown sync evidence distinct from active progress", () => {
    expect(isSyncNotStarted({ ...CONNECTED, syncStatus: "not_started" })).toBe(true);
    expect(isSyncNotStarted({ ...CONNECTED, syncStatus: "in_progress" })).toBe(false);
    expect(isSyncStatusUnknown({ ...CONNECTED, syncStatus: "unknown" })).toBe(true);
    expect(isSyncStatusUnknown({ ...CONNECTED, syncStatus: "not_started" })).toBe(false);
  });

  it("distinguishes a failed sync from an active sync", () => {
    expect(hasSyncFailure({ ...CONNECTED, syncStatus: "failed" })).toBe(true);
    expect(hasSyncFailure({ ...CONNECTED, syncStatus: "partial" })).toBe(true);
    expect(hasSyncFailure({ ...CONNECTED, syncStatus: "in_progress" })).toBe(false);
    expect(hasSyncFailure({ ...CONNECTED, connected: false, syncStatus: "failed" })).toBe(false);
  });

  it("flags missing required webhook topics without misclassifying generic setup failure", () => {
    expect(hasWebhookGap({ ...CONNECTED, webhooksRegistered: 7 })).toBe(true);
    expect(hasWebhookGap({ ...CONNECTED, setupStatus: "webhooks_pending" })).toBe(true);
    expect(hasWebhookGap({ ...CONNECTED, setupStatus: "failed" })).toBe(false);
    expect(hasWebhookGap({ ...CONNECTED, setupStatus: "failed", webhooksRegistered: 8 })).toBe(true);
    expect(hasWebhookGap(CONNECTED)).toBe(false);
  });

  it("does not report a webhook gap for a non-Shopify platform", () => {
    expect(hasWebhookGap({
      ...CONNECTED, platform: "woocommerce", webhooksRegistered: 0, webhooksRequired: 12,
    })).toBe(false);
  });

  it("flags a sync older than the staleness window", () => {
    const old = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    expect(isSyncStale({ ...CONNECTED, lastSyncedAt: old })).toBe(true);
    expect(isSyncStale(CONNECTED)).toBe(false);
    expect(isSyncStale({ ...CONNECTED, lastSyncedAt: null })).toBe(false);
    expect(isSyncStale({ ...CONNECTED, lastSyncedAt: "not-a-date" })).toBe(false);
  });
});

describe("buildStarters", () => {
  it("offers connection guidance, not revenue questions, when no store is connected", () => {
    const starters = buildStarters(UNKNOWN_STORE);

    expect(starters.length).toBeGreaterThan(0);
    expect(starters.some((s) => /connect/i.test(s.sub))).toBe(true);
    // Revenue questions would be unanswerable, so they must not be suggested.
    expect(starters.some((s) => /revenue/i.test(s.sub))).toBe(false);
  });

  it("leads with sync and permission questions while the first sync is incomplete", () => {
    const starters = buildStarters({ ...CONNECTED, syncStatus: "in_progress" });

    expect(/up to date/i.test(starters[0].sub)).toBe(true);
    expect(starters.some((s) => /permissions/i.test(s.sub))).toBe(true);
  });

  it("grounds the revenue starter in the merchant's actual store name", () => {
    const starters = buildStarters(CONNECTED);
    const revenue = starters.find((s) => s.label === "Revenue");

    expect(revenue).toBeDefined();
    expect(revenue!.sub).toContain("revluma-test-store-v1");
  });

  it("promotes a freshness question when data is stale or webhooks are incomplete", () => {
    const old = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

    expect(buildStarters({ ...CONNECTED, lastSyncedAt: old })[0].label).toBe("Freshness");
    expect(buildStarters({ ...CONNECTED, webhooksRegistered: 3 })[0].label).toBe("Freshness");
    expect(buildStarters(CONNECTED)[0].label).not.toBe("Freshness");
  });

  it("never suggests more than six starters", () => {
    const old = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    expect(buildStarters({ ...CONNECTED, lastSyncedAt: old }).length).toBeLessThanOrEqual(6);
  });

  it("only suggests read-only investigations", () => {
    // The MVP boundary forbids campaigns, sends, price changes and edits. A
    // starter must never promise that Rev will do one of those.
    const forbidden = /\b(draft|create|send|launch|apply|schedule|set up|update|change|discount|refund)\b/i;

    for (const context of [
      UNKNOWN_STORE,
      CONNECTED,
      { ...CONNECTED, syncStatus: "pending" },
      { ...CONNECTED, webhooksRegistered: 0 },
    ]) {
      for (const starter of buildStarters(context)) {
        expect(starter.sub).not.toMatch(forbidden);
        expect(starter.label).not.toMatch(/win-back|sequence|campaign/i);
      }
    }
  });
});

describe("storeContextFromResponse", () => {
  it("recognizes a connected Shopify store from GET /stores", () => {
    const context = storeContextFromResponse({
      success: true,
      data: { stores: [{
        id: "store-1",
        platform: "shopify",
        shop_domain: "revluma-test-store-v1.myshopify.com",
        status: "active",
        connection_status: "connected",
        sync_status: "complete",
      }] },
    });
    expect(context).toMatchObject({
      loaded: true, loadError: false, connected: true, platform: "shopify",
      shopDomain: "revluma-test-store-v1.myshopify.com", syncStatus: "complete",
    });
  });

  it("prefers connected Shopify stores and ignores non-Shopify records", () => {
    const context = storeContextFromResponse({
      success: true,
      data: { stores: [
        { id: "woo", platform: "woocommerce", connection_status: "connected" },
        { id: "disconnected", platform: "shopify", connection_status: "disconnected" },
        { id: "connected", platform: "shopify", connection_status: "connected" },
      ] },
    });
    expect(context.connected).toBe(true);
    expect(context.platform).toBe("shopify");
  });

  it("treats a successful empty store list as no connected store", () => {
    expect(storeContextFromResponse({ success: true, data: { stores: [] } }))
      .toMatchObject({ loaded: true, loadError: false, connected: false });
  });

  it("throws on failed or malformed responses so callers can show an unverifiable state", () => {
    expect(() => storeContextFromResponse({ success: false, data: { stores: [] } })).toThrow();
    expect(() => storeContextFromResponse({ success: true, data: {} })).toThrow();
  });

  it("does not offer connect-store prompts after a status lookup failure", () => {
    const failed = { ...UNKNOWN_STORE, loaded: true, loadError: true };
    expect(buildStarters(failed)[0].label).toBe("Retry");
    expect(buildStarters(failed).some(starter => /connect your Shopify store/i.test(starter.sub))).toBe(false);
  });
});

// Self-managing data operations: when the server supplies data health it is
// the source of truth. Routine sync/retry/optional-permission states must not
// raise a global failure banner; only a genuine merchant action is surfaced.
describe("data-health driven status", () => {
  const healthy = { overall: "healthy_with_limitations", core_state: "complete", syncing: false, merchant_action: null, optional_permissions: ["markets"], limitations: ["Markets: Shopify permission not granted (read_markets)"] };

  it("never reports a sync failure for limitations Revluma handles itself", () => {
    expect(hasSyncFailure({ ...CONNECTED, syncStatus: "partial", dataHealth: healthy })).toBe(false);
    expect(hasSyncFailure({ ...CONNECTED, syncStatus: "complete_with_limitations", dataHealth: healthy })).toBe(false);
    expect(merchantActionRequired({ ...CONNECTED, dataHealth: healthy })).toBeNull();
    expect(dataStatusNote({ ...CONNECTED, dataHealth: healthy })).toBeNull();
  });

  it("keeps the legacy failure indicator when no data health is supplied", () => {
    expect(hasSyncFailure({ ...CONNECTED, syncStatus: "partial", dataHealth: null })).toBe(true);
  });

  it("surfaces only genuine merchant actions", () => {
    const action = { kind: "grant_permission", reason: "core_permission_missing", capabilities: ["inventory"] };
    expect(merchantActionRequired({ ...CONNECTED, dataHealth: { ...healthy, overall: "action_required", merchant_action: action } })).toEqual(action);
    expect(merchantActionRequired({ ...CONNECTED, loadError: true, dataHealth: { ...healthy, merchant_action: action } })).toBeNull();
  });

  it("describes automatic recovery quietly, with the data's real age", () => {
    const now = Date.parse("2026-11-23T12:00:00Z");
    const note = dataStatusNote({ ...CONNECTED, dataHealth: { ...healthy, overall: "recovering", newest_resource_success: "2026-11-23T09:00:00Z" } }, now);
    expect(note).toContain("automatically");
    expect(note).toContain("3 h ago");
    expect(dataStatusNote({ ...CONNECTED, dataHealth: { ...healthy, overall: "syncing", syncing: true, newest_resource_success: null, last_store_sync: null }, lastSyncedAt: null }, now)).toContain("Importing");
  });

  it("reads data_health and the store id from GET /stores, ranking complete_with_limitations as synced", () => {
    const ctx = storeContextFromResponse({ success: true, data: { stores: [
      { id: "a", platform: "shopify", shop_domain: "a.myshopify.com", connection_status: "connected", sync_status: "failed", status: "active", updated_at: "2026-11-23T00:00:00Z" },
      { id: "b", platform: "shopify", shop_domain: "b.myshopify.com", connection_status: "connected", sync_status: "complete_with_limitations", status: "active", updated_at: "2026-11-22T00:00:00Z", data_health: healthy },
    ] } });
    expect(ctx.storeId).toBe("b");
    expect(ctx.dataHealth?.overall).toBe("healthy_with_limitations");
  });
});
