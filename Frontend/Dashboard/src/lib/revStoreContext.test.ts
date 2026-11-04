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
  hasWebhookGap,
  isSyncIncomplete,
  isSyncStale,
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

  it("flags a pending or in-progress first sync", () => {
    expect(isSyncIncomplete({ ...CONNECTED, syncStatus: "pending" })).toBe(true);
    expect(isSyncIncomplete({ ...CONNECTED, syncStatus: "in_progress" })).toBe(true);
    expect(isSyncIncomplete({ ...CONNECTED, monitoringMode: "awaiting_verified_sync" })).toBe(true);
    expect(isSyncIncomplete(CONNECTED)).toBe(false);
  });

  it("flags missing or failed required webhook topics", () => {
    expect(hasWebhookGap({ ...CONNECTED, webhooksRegistered: 7 })).toBe(true);
    expect(hasWebhookGap({ ...CONNECTED, setupStatus: "webhooks_pending" })).toBe(true);
    expect(hasWebhookGap({ ...CONNECTED, setupStatus: "failed" })).toBe(true);
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
