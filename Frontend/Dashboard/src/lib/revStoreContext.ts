// Rev Intelligence — store context and grounded suggestions.
//
// Kept out of the page component so Fast Refresh still works (a component file
// that also exports plain functions breaks it) and so the grounding rules are
// unit-testable without rendering React.
//
// Two defects are addressed here. Generic filler suggestions invited questions
// Rev could not answer from the data it actually holds, and a starter that
// promised to "draft a sequence" advertised a campaign action the read-only MVP
// boundary forbids. Suggestions are therefore derived from the merchant's real
// connection state, and every one is a read-only investigation.

import {
  TrendingUp, ShoppingCart, Users, BarChart2, Zap, RefreshCw, FileText,
} from "lucide-react";

export interface StoreContext {
  loaded: boolean;
  loadError: boolean;
  connected: boolean;
  shopDomain: string | null;
  platform: string | null;
  syncStatus: string | null;
  setupStatus: string | null;
  monitoringMode: string | null;
  lastSyncedAt: string | null;
  webhooksRegistered: number | null;
  webhooksRequired: number | null;
}

/** Shape returned by GET /store (access_token is stripped server-side). */
export interface StoreSummary {
  id?: string;
  platform?: string | null;
  shop_domain?: string | null;
  status?: string | null;
  connection_status?: string | null;
  sync_status?: string | null;
  setup_status?: string | null;
  monitoring_mode?: string | null;
  last_synced_at?: string | null;
  updated_at?: string | null;
  webhooks_registered?: number | null;
  webhooks_required?: number | null;
}

export interface StoreListEnvelope {
  stores?: StoreSummary[];
  data?: { stores?: StoreSummary[] };
}

export interface StoreListResponse {
  success?: boolean;
  data?: StoreListEnvelope;
}

export const UNKNOWN_STORE: StoreContext = {
  loaded: false, loadError: false, connected: false, shopDomain: null, platform: null,
  syncStatus: null, setupStatus: null, monitoringMode: null, lastSyncedAt: null,
  webhooksRegistered: null, webhooksRequired: null,
};

/**
 * Convert the authenticated GET /stores response into Rev's connection state.
 * A malformed/failed response is an error, never evidence that the merchant has
 * no connected store.
 */
export function storeContextFromResponse(response: StoreListResponse): StoreContext {
  const stores = response?.data?.data?.stores ?? response?.data?.stores;
  if (response?.success !== true || !Array.isArray(stores)) {
    throw new Error("Store connection response was not verifiable.");
  }

  const shopifyStores = stores.filter((store) =>
    String(store?.platform || "").toLowerCase() === "shopify"
  );
  if (shopifyStores.length === 0) return { ...UNKNOWN_STORE, loaded: true };

  const rank = (store: StoreSummary) =>
    (store?.connection_status === "connected" ? 4 : 0) +
    (store?.sync_status === "complete" ? 2 : 0) +
    (store?.status === "active" ? 1 : 0);
  const chosen = [...shopifyStores].sort((a, b) => {
    const delta = rank(b) - rank(a);
    if (delta !== 0) return delta;
    return Date.parse(b?.updated_at || "") - Date.parse(a?.updated_at || "");
  })[0];

  return {
    loaded: true,
    loadError: false,
    connected: chosen?.connection_status === "connected",
    shopDomain: chosen?.shop_domain ?? null,
    platform: chosen?.platform ?? null,
    syncStatus: chosen?.sync_status ?? null,
    setupStatus: chosen?.setup_status ?? null,
    monitoringMode: chosen?.monitoring_mode ?? null,
    lastSyncedAt: chosen?.last_synced_at ?? null,
    webhooksRegistered: chosen?.webhooks_registered ?? null,
    webhooksRequired: chosen?.webhooks_required ?? null,
  };
}

/** "revluma-test-store-v1.myshopify.com" → "revluma-test-store-v1". */
export function storeLabel(ctx: StoreContext): string {
  const domain = (ctx.shopDomain || "").trim();
  if (!domain) return "my store";
  const host = domain.replace(/^https?:\/\//, "").split("/")[0];
  return host.replace(/\.myshopify\.com$/i, "") || host;
}

/** True when the store is connected but its first sync has not completed. */
export function isSyncIncomplete(ctx: StoreContext): boolean {
  if (!ctx.connected) return false;
  return ["pending", "in_progress"].includes(ctx.syncStatus || "")
    || ["awaiting_verified_sync", "sync_only_limited"].includes(ctx.monitoringMode || "");
}

/** True when required webhook topics are missing or failed. */
export function hasWebhookGap(ctx: StoreContext): boolean {
  if (!ctx.connected || ctx.platform !== "shopify") return false;
  if (ctx.webhooksRegistered == null || ctx.webhooksRequired == null) return false;
  return ctx.webhooksRegistered < ctx.webhooksRequired
    || ["webhooks_pending", "failed"].includes(ctx.setupStatus || "");
}

/** True when the last successful sync is old enough that data may be stale. */
export function isSyncStale(ctx: StoreContext, staleMinutes = 90): boolean {
  if (!ctx.connected || !ctx.lastSyncedAt) return false;
  const then = Date.parse(ctx.lastSyncedAt);
  if (Number.isNaN(then)) return false;
  return Date.now() - then > staleMinutes * 60 * 1000;
}

export interface Starter {
  icon: typeof TrendingUp;
  label: string;
  sub: string;
  color: string;
}

/** Build suggestions from this merchant's actual store and sync state. */
export function buildStarters(ctx: StoreContext): Starter[] {
  // A failed status lookup must not be presented as a disconnected store.
  if (ctx.loadError) {
    return [
      { icon: RefreshCw, label: "Retry", sub: "Can you check my Shopify connection again?", color: "#d97706" },
      { icon: FileText, label: "Data", sub: "What data can Rev use once my store is verified?", color: "#7c3aed" },
      { icon: Zap, label: "Capability", sub: "What can Rev do, and what can't it do?", color: "#db2777" },
    ];
  }

  // No usable store data yet: the only honest suggestions are about the
  // connection itself, not about revenue Rev cannot see.
  if (!ctx.connected) {
    return [
      { icon: ShoppingCart, label: "Connect",   sub: "What do I need to connect my Shopify store?", color: "#1F06AC" },
      { icon: FileText,     label: "Data",      sub: "What data will Rev be able to see?",          color: "#7c3aed" },
      { icon: Zap,          label: "Capability", sub: "What can Rev do, and what can't it do?",      color: "#db2777" },
    ];
  }

  if (isSyncIncomplete(ctx)) {
    return [
      { icon: RefreshCw, label: "Sync",      sub: `Is my ${storeLabel(ctx)} data up to date?`,        color: "#0891b2" },
      { icon: FileText,  label: "Coverage",  sub: "Which of my Shopify permissions are missing?",     color: "#7c3aed" },
      { icon: BarChart2, label: "Overview",  sub: "What can you tell me about my store right now?",   color: "#1F06AC" },
    ];
  }

  const store = storeLabel(ctx);
  const starters: Starter[] = [
    { icon: BarChart2,  label: "Overview",  sub: "Give me a clear overview of how my store is performing.", color: "#1F06AC" },
    { icon: TrendingUp, label: "Revenue",   sub: `How much revenue did ${store} generate last month?`,      color: "#059669" },
    { icon: ShoppingCart, label: "Products", sub: "Which products contributed the most to revenue?",         color: "#d97706" },
    { icon: Users,      label: "Customers", sub: "Which customers are most valuable?",                      color: "#7c3aed" },
    { icon: Zap,        label: "Diagnosis", sub: "Why might purchases be dropping?",                        color: "#db2777" },
    { icon: RefreshCw,  label: "Priority",  sub: "What is the most important issue I should look at first?", color: "#0891b2" },
  ];

  // Surface a data-health question first when the feed looks stale or webhook
  // coverage is incomplete, so the merchant is not misled by a confident answer
  // built on old data.
  if (isSyncStale(ctx) || hasWebhookGap(ctx)) {
    starters.unshift({
      icon: FileText, label: "Freshness", sub: "Is my store data up to date?", color: "#dc2626",
    });
  }
  return starters.slice(0, 6);
}
