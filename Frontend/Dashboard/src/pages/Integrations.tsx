// src/pages/Integrations.tsx
import { motion, AnimatePresence } from "framer-motion";
import {
  ExternalLink, Plug, WifiOff, X, Info, CheckCircle2, CircleX, Loader2,
  Clock, ShieldCheck, ArrowUpRight, Code2, Sparkles
} from "lucide-react";
import { WooCommerceConnect } from "./WooCommerceConnect";
import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { api, ApiError } from "@/lib/api";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { DESIGN_TOKENS } from "@/lib/DesignConstants";
import magentoLogo from "@/assets/magento-logo.png";
import GlassmorphismCard from "@/components/GlassmorphismCard";
import { createPortal } from "react-dom";

// Types
type ConnectionStatus = "not_connected" | "connecting" | "connected" | "error";

interface Platform {
  id: "shopify" | "woocommerce";
  name: string;
  tagline: string;
  description: string;
  logo: string;
  accentColor: string;
  accentBg: string;
  accentBorder: string;
  docsUrl: string;
  features: string[];
  popular?: boolean;
}

interface ComingSoonPlatform {
  name: string;
  tagline: string;
  logo?: string;
  icon?: React.ElementType;
  accentColor: string;
}

interface WebhookDetail {
  topic: string;
  status: "registered" | "running" | "failed" | "not_attempted" | "unknown";
  error?: string | null;
  attempt_count?: number;
  started_at?: string | null;
  completed_at?: string | null;
}

interface ConnectedStore {
  id: string;
  platform: Platform["id"];
  shop_domain: string;
  status: string;
  installed_at: string | null;
  connection_status: "connected" | "disconnected";
  setup_status: "disconnected" | "webhooks_pending" | "in_progress" | "failed" | "pending" | "complete";
  webhooks_registered: number | null;
  webhooks_required: number | null;
  webhook_details?: WebhookDetail[] | null;
  last_synced_at: string | null;
}

const STORE_STATUS_CACHE_KEY = "revluma:integration-store-status:v1";

function readCachedStores(): ConnectedStore[] {
  try {
    const cached = sessionStorage.getItem(STORE_STATUS_CACHE_KEY);
    if (!cached) return [];
    const parsed: unknown = JSON.parse(cached);
    return Array.isArray(parsed) ? parsed as ConnectedStore[] : [];
  } catch {
    return [];
  }
}

function isStoreSetupComplete(store: ConnectedStore): boolean {
  const webhooksRegistered = store.webhooks_registered ?? 0;
  const webhooksRequired = store.webhooks_required ?? 0;
  return store.connection_status === "connected" &&
    store.setup_status === "complete" &&
    webhooksRequired > 0 &&
    webhooksRegistered >= webhooksRequired &&
    Boolean(store.last_synced_at);
}

function statusesFromStores(stores: ConnectedStore[]): Record<Platform["id"], ConnectionStatus> {
  const statuses: Record<Platform["id"], ConnectionStatus> = {
    shopify: "not_connected",
    woocommerce: "not_connected",
  };
  stores.forEach((store) => {
    if (store.connection_status === "connected") {
      statuses[store.platform] = "connected";
    } else if (store.platform === "shopify" && store.installed_at && statuses.shopify !== "connected") {
      statuses.shopify = "error";
    }
  });
  return statuses;
}

// Platform config
const PLATFORMS: Platform[] = [
  {
    id: "shopify",
    name: "Shopify",
    tagline: "The world's leading e-commerce platform",
    description:
      "Connect your Shopify store to automatically detect abandoned carts, sync customer profiles, and fire recovery sequences — no code required.",
    logo: "https://cdn.simpleicons.org/shopify/5C8F4D",
    accentColor: "#5C8F4D",
    accentBg: "hsl(142 40% 42% / 0.10)",
    accentBorder: "hsl(142 40% 42% / 0.28)",
    docsUrl: "https://shopify.dev/docs/apps/auth/oauth",
    popular: true,
    features: [
      "Automatic cart abandonment detection via pixel",
      "Real-time order and customer sync",
      "Shopify ScriptTag injection — no plugin needed",
      "Webhook-based OOS and inventory updates",
    ],
  },
  {
    id: "woocommerce",
    name: "WooCommerce",
    tagline: "The open-source commerce platform for WordPress",
    description:
      "Connect your WooCommerce store via REST API to start recovering abandoned carts and unlocking customer intelligence across your catalogue.",
    logo: "https://cdn.simpleicons.org/woocommerce/7C5CBF",
    accentColor: "#7C5CBF",
    accentBg: "hsl(258 45% 55% / 0.10)",
    accentBorder: "hsl(258 45% 55% / 0.28)",
    docsUrl: "https://woocommerce.com/document/woocommerce-rest-api/",
    features: [
      "Cart recovery via WooCommerce REST API",
      "Full customer and order history sync",
      "WordPress plugin for pixel installation",
      "Real-time stock and pricing updates",
    ],
  },
];

const COMING_SOON: ComingSoonPlatform[] = [
  { name: "BigCommerce", tagline: "Open SaaS commerce", logo: "https://cdn.simpleicons.org/bigcommerce/34313F", accentColor: "#34313F" },
  { name: "Magento", tagline: "Adobe Commerce", logo: magentoLogo, accentColor: "#F46F25" },
  { name: "Squarespace", tagline: "All-in-one website builder", logo: "https://cdn.simpleicons.org/squarespace/111111", accentColor: "#111111" },
  { name: "Custom API", tagline: "Bring your own stack", icon: Code2, accentColor: "#4C8DFF" },
];

// Status badge
const STATUS_LABEL: Record<ConnectionStatus, string> = {
  not_connected: "Not Connected",
  connecting: "Connecting…",
  connected: "Connected",
  error: "Connection Error",
};

const STATUS_STYLE: Record<ConnectionStatus, { color: string; bg: string }> = {
  not_connected: { color: "hsl(var(--t3))", bg: "hsl(var(--bg-4))" },
  connecting: { color: "hsl(var(--amber))", bg: "hsl(var(--amber) / 0.12)" },
  connected: { color: "hsl(var(--accent))", bg: "hsl(var(--accent) / 0.12)" },
  error: { color: "hsl(var(--red))", bg: "hsl(var(--red) / 0.12)" },
};

function StatusBadge({ status }: { status: ConnectionStatus }) {
  const { color, bg } = STATUS_STYLE[status];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.72rem] font-semibold"
      style={{ color, background: bg }}
    >
      <span
        className={cn("h-1.5 w-1.5 rounded-full", status === "connecting" && "animate-pulse")}
        style={{ background: color }}
      />
      {STATUS_LABEL[status]}
    </span>
  );
}

function FieldInfo({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`How to find your ${title}`}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-t3 transition-colors hover:text-t1"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-[280px] border-border-md bg-bg-3 p-3.5 text-t2 shadow-elegant"
      >
        <p className="mb-1.5 flex items-center gap-1.5 text-[0.78rem] font-semibold text-t1">
          <ShieldCheck className="h-3.5 w-3.5" style={{ color: "hsl(var(--accent))" }} />
          {title}
        </p>
        <div className="space-y-1.5 text-[0.74rem] leading-relaxed text-t2">{children}</div>
      </PopoverContent>
    </Popover>
  );
}

function LogoTile({ src, alt, size = 14 }: { src: string; alt: string; size?: number }) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-black/[0.06]",
        size === 14 ? "h-14 w-14 p-2.5" : "h-10 w-10 p-2",
      )}
    >
      <img src={src} alt={alt} className="h-full w-full object-contain" />
    </div>
  );
}

export default function Integrations() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialCachedStores = readCachedStores();
  const [stores, setStores] = useState<ConnectedStore[]>(initialCachedStores);
  const [statuses, setStatuses] = useState<Record<Platform["id"], ConnectionStatus>>(() => statusesFromStores(initialCachedStores));
  const [loading, setLoading] = useState(initialCachedStores.length === 0);
  const [storeLoadError, setStoreLoadError] = useState(false);
  const [retryingStoreIds, setRetryingStoreIds] = useState<string[]>([]);
  const [webhookDetailsStoreId, setWebhookDetailsStoreId] = useState<string | null>(null);
  const [retryFeedback, setRetryFeedback] = useState<{ storeId: string; state: "running" | "success" | "partial" | "failed"; message: string } | null>(null);

  // Shopify Modal State
  const [shopifyModalOpen, setShopifyModalOpen] = useState(false);
  const [shopDomain, setShopDomain] = useState("");

  // WooCommerce Inline Form State
  const [wooFormOpen, setWooFormOpen] = useState(false);

  // Connect success/failure feedback
  const [statusCard, setStatusCard] = useState<{
    open: boolean;
    type: "success" | "error";
    title: string;
    message: string;
    buttonText?: string;
  }>({ open: false, type: "success", title: "", message: "" });

  const showStatusCard = useCallback((type: "success" | "error", title: string, message: string, buttonText?: string) => {
    setStatusCard({ open: true, type, title, message, buttonText });
  }, []);

  function closeStatusCard() {
    setStatusCard((prev) => ({ ...prev, open: false }));
  }

  function getErrorMessage(e: unknown, fallback: string): string {
    if (e instanceof ApiError) {
      const body = e.body as { error?: string; message?: string } | null;
      return body?.error || body?.message || fallback;
    }
    if (e instanceof Error && e.message) return e.message;
    return fallback;
  }

  // Fetch initial statuses
  const fetchStatuses = useCallback(async (): Promise<ConnectedStore[] | null> => {
    try {
      const res = await api.get<{ data: { stores: ConnectedStore[] } }>("/stores");
      const stores = res.data?.data?.stores;
      if (!Array.isArray(stores)) {
        throw new Error("The store list response was invalid.");
      }
      setStatuses(statusesFromStores(stores));
      setStores(stores);
      try {
        sessionStorage.setItem(STORE_STATUS_CACHE_KEY, JSON.stringify(stores));
      } catch {
        // The page still works when browser storage is unavailable.
      }
      setStoreLoadError(false);
      return stores;
    } catch (e) {
      console.error("Failed to fetch store statuses", e);
      setStoreLoadError(true);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const callbackStatus = searchParams.get("shopify");
    if (callbackStatus === "cancelled") {
      showStatusCard("error", "Shopify Authorization Cancelled", "No Shopify connection was saved. You can start the connection again whenever you're ready.");
      const next = new URLSearchParams(searchParams);
      next.delete("shopify");
      next.delete("shop");
      next.delete("stage");
      next.delete("reference");
      setSearchParams(next, { replace: true });
      void fetchStatuses();
      return;
    }
    const connectionAttempt = callbackStatus === "connected" ||
      callbackStatus === "error" ||
      searchParams.has("connected");
    if (connectionAttempt) {
      const callbackShop = searchParams.get("shop");
      const failureStage = searchParams.get("stage");
      const failureReference = searchParams.get("reference");
      void fetchStatuses().then((result) => {
        const shopifyStore = result?.find(
          (store) => store.platform === "shopify" &&
            store.connection_status === "connected" &&
            (!callbackShop || store.shop_domain === callbackShop),
        );
        if (!result) {
          showStatusCard("error", "Connection Could Not Be Verified", "Revluma could not confirm the saved Shopify connection. Refresh the page or try again.");
        } else if (!shopifyStore) {
          showStatusCard(
            "error",
            "Shopify Connection Not Found",
            callbackStatus === "error"
              ? `The connection could not be completed${failureStage ? ` during ${failureStage.replace(/_/g, " ")}` : ""}.${failureReference ? ` Reference: ${failureReference}.` : ""} Please try connecting again.`
              : "Shopify returned to Revluma, but no saved connection was found for this store in your account. Please try connecting again.",
          );
        } else if (!isStoreSetupComplete(shopifyStore)) {
          showStatusCard(
            "error",
            shopifyStore.setup_status === "failed"
              ? "Shopify Connected — Setup Needs Attention"
              : "Shopify Connected — Setup Incomplete",
            shopifyStore.setup_status === "failed"
              ? "Your store credentials are saved, but webhook setup or synchronization failed. Use Retry setup on the store card."
              : "Your store credentials are saved. Webhook registration or initial synchronization is still pending; the current setup status is shown below.",
            "View setup status",
          );
        } else {
          showStatusCard(
            "success",
            "Shopify Store Connected",
            "Your saved Shopify connection and initial synchronization have been verified.",
            "Got it",
          );
        }
      });
      const next = new URLSearchParams(searchParams);
      next.delete("shopify");
      next.delete("connected");
      next.delete("shop");
      next.delete("stage");
      next.delete("reference");
      setSearchParams(next, { replace: true });
    } else {
      void fetchStatuses();
    }
  }, [fetchStatuses, searchParams, setSearchParams, showStatusCard]);

  const shopifySetupInProgress = stores.some((store) => store.platform === "shopify" && store.setup_status === "in_progress");
  useEffect(() => {
    if (!shopifySetupInProgress) return;
    const intervalId = window.setInterval(() => {
      void fetchStatuses();
    }, 2000);
    return () => window.clearInterval(intervalId);
  }, [shopifySetupInProgress, fetchStatuses]);

  async function handleRetryStoreSetup(storeId: string) {
    if (retryingStoreIds.includes(storeId)) return;
    setRetryingStoreIds((current) => [...current, storeId]);
    setRetryFeedback({ storeId, state: "running", message: "Starting the Shopify setup retry…" });
    try {
      await api.post("/shopify/retry-setup", { store_id: storeId });
      setRetryFeedback({ storeId, state: "running", message: "Retry accepted. Checking webhook registration and initial sync status…" });

      // The API starts the retry asynchronously. Poll the saved store status instead
      // of claiming success just because the request was accepted.
      const deadline = Date.now() + 60000;
      let latest: ConnectedStore | undefined;
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
        const result = await fetchStatuses();
        latest = result?.find((store) => store.id === storeId);
        if (!latest) continue;

        const webhookCount = latest.webhooks_registered ?? 0;
        const requiredCount = latest.webhooks_required ?? 0;
        if (latest.setup_status === "complete" && requiredCount > 0 && webhookCount >= requiredCount && latest.last_synced_at) {
          setRetryFeedback({ storeId, state: "success", message: "All required webhooks are registered and the initial sync is complete." });
          showStatusCard("success", "Shopify Store Connected", "All required setup checks passed. Your store is connected and its initial sync has completed.", "Got it");
          return;
        }
        if (latest.setup_status === "failed") {
          const detail = `Setup is still failing. ${webhookCount}/${requiredCount || "?"} webhooks are registered. Check the setup logs or try again after the underlying error is fixed.`;
          setRetryFeedback({ storeId, state: "failed", message: detail });
          showStatusCard("error", "Shopify Setup Needs Attention", detail);
          return;
        }
      }

      const webhookCount = latest?.webhooks_registered ?? 0;
      const requiredCount = latest?.webhooks_required ?? 0;
      const detail = latest
        ? `The retry is still running or incomplete after 60 seconds. ${webhookCount}/${requiredCount || "?"} webhooks are registered. You can keep this page open and refresh the status.`
        : "Revluma accepted the retry, but could not confirm the latest status. Refresh the page before retrying again.";
      setRetryFeedback({ storeId, state: "partial", message: detail });
      showStatusCard("error", "Shopify Setup Not Yet Complete", detail);
    } catch (e) {
      const detail = getErrorMessage(e, "We couldn't restart Shopify setup. Please try again shortly.");
      setRetryFeedback({ storeId, state: "failed", message: detail });
      showStatusCard("error", "Shopify Setup Retry Failed", detail);
    } finally {
      setRetryingStoreIds((current) => current.filter((id) => id !== storeId));
      await fetchStatuses();
    }
  }

  function handleConnectClick(id: Platform["id"]) {
    if (id === "shopify") {
      setShopifyModalOpen(true);
    } else if (id === "woocommerce") {
      setWooFormOpen(true);
    }
  }

  async function handleShopifySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!shopDomain.trim()) return;

    let cleanShop = shopDomain.trim();
    if (cleanShop.endsWith(".")) {
      cleanShop = cleanShop.slice(0, -1);
    }
    if (!cleanShop.endsWith(".myshopify.com")) {
      cleanShop = `${cleanShop}.myshopify.com`;
    }

    try {
      const res = await api.get("/shopify/install", { shop: cleanShop });
      const targetUrl = (res.data as { redirectUrl?: string; install_url?: string })?.redirectUrl || (res.data as { install_url?: string })?.install_url;

      if (targetUrl) {
        window.location.href = targetUrl;
      } else {
        throw new Error("No redirect URL returned from the backend");
      }
    } catch (e) {
      console.error("Shopify connect failed", e);
      showStatusCard(
        "error",
        "Shopify Connection Failed",
        getErrorMessage(e, "We couldn't start the Shopify connection. Try Again"),
      );
    }
  }

  const connectedCount = Object.values(statuses).filter((s) => s === "connected").length;
  const anyConnected = connectedCount > 0;
  const anyFullySetup = stores.some(isStoreSetupComplete);

  return (
    <div className="mx-auto max-w-[1480px] space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="display text-[1.6rem] font-extrabold tracking-tight text-t1 sm:text-[1.85rem]">
            Connect Your Store
          </h1>
          <p className="mt-1 text-[0.85rem] text-t2">
            Connect your Shopify or WooCommerce store to start recovering abandoned carts.
          </p>
        </div>
        <div className="flex items-center gap-2 self-start rounded-full border border-border bg-bg-2 px-3 py-1.5 text-[0.72rem] font-semibold text-t2 sm:self-auto">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: anyConnected ? "hsl(var(--accent))" : "hsl(var(--t4))" }}
          />
          {connectedCount} of {PLATFORMS.length} platforms connected
        </div>
      </div>

      {/* Active Store Sync & Onboarding Card */}
      {!loading && anyConnected && (
        <div className="flex flex-col justify-between gap-4 rounded-2xl border border-emerald-500/25 bg-bg-2 p-5 sm:flex-row sm:items-center">
          <div className="space-y-2">
            <div className={cn("inline-flex items-center gap-2 rounded-full px-3 py-1 text-[0.72rem] font-bold uppercase tracking-wider", anyFullySetup ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-300")}>
              {anyFullySetup ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
              {anyFullySetup ? "Store Connection Active" : "Store Connection Saved — Setup Incomplete"}
            </div>
            <p className="text-[0.82rem] text-t2">
              {anyFullySetup
                ? "Your store connection, required webhooks, and initial sync have been verified."
                : "Your store credentials are saved, but setup is not fully verified yet. Follow the webhook and sync checklist below."}
            </p>
          </div>
          <button
            onClick={() => navigate("/dashboard/settings/automation")}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-[0.82rem] font-bold text-black shadow-md transition-all hover:bg-emerald-400"
          >
            Configure Automation
            <ArrowUpRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {!loading && storeLoadError && (
        <div role="alert" className="rounded-xl border border-red-500/25 bg-red-500/5 p-4 text-sm text-t2">
          Could not load your saved store connections. Refresh the list before trying to connect a store again.
          <button
            type="button"
            onClick={() => void fetchStatuses()}
            className="ml-2 font-semibold text-t1 underline underline-offset-2"
          >
            Retry
          </button>
        </div>
      )}

      {/* No-store warning -> Premium Empty State */}
      {!loading && !storeLoadError && !anyConnected && (
        <div className={DESIGN_TOKENS.emptyState.container}>
          <div className={DESIGN_TOKENS.emptyState.iconWrapper}>
            <WifiOff className={DESIGN_TOKENS.emptyState.icon} strokeWidth={1.5} />
          </div>
          <h3 className={DESIGN_TOKENS.emptyState.title}>No Store Connected</h3>
          <p className={DESIGN_TOKENS.emptyState.description}>
            Connect your Shopify or WooCommerce store to activate recovery sequences and unlock your live dashboard.
          </p>
          <button
            onClick={() => handleConnectClick("shopify")}
            className="mt-4 rounded-md bg-[#007FFF] px-6 py-2 font-semibold text-white shadow-md transition-colors hover:bg-[#007FFF]/90"
          >
            Connect Store
          </button>
        </div>
      )}

      {/* Platform cards — side by side */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2" aria-label="Platform integrations">
        {PLATFORMS.map((platform) => {
          const status = statuses[platform.id];
          const isConnected = status === "connected";

          return (
            <div
              key={platform.id}
              className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-gray-50 shadow-sm transition-colors hover:border-slate-400 hover:bg-white dark:border-slate-800 dark:bg-slate-950 dark:hover:border-slate-600 dark:hover:bg-slate-900"
            >
              <div
                className="h-[3px] w-full shrink-0"
                style={{ background: `linear-gradient(90deg, ${platform.accentColor}, transparent)` }}
              />

              <div className="flex flex-1 flex-col gap-5 p-6">
                {/* Header */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    <LogoTile src={platform.logo} alt={platform.name} />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-[1.05rem] font-bold leading-tight text-t1">{platform.name}</h2>
                        {platform.popular && (
                          <span
                            className="rounded-full px-2 py-0.5 text-[0.62rem] font-bold uppercase tracking-[0.06em]"
                            style={{ background: "hsl(var(--accent) / 0.14)", color: "hsl(var(--accent))" }}
                          >
                            Most Popular
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[0.74rem] text-t3">{platform.tagline}</p>
                    </div>
                  </div>
                  {loading ? (
                    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-bg-3 px-3 py-1.5 text-xs font-medium text-t2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking status</span>
                  ) : <StatusBadge status={status} />}
                </div>

                {/* Description & Features */}
                {!(platform.id === "woocommerce" && wooFormOpen) && (
                  <>
                    <p className="text-[0.82rem] leading-relaxed text-t2">{platform.description}</p>
                    <div className="grid grid-cols-1 gap-x-3 gap-y-2.5 rounded-xl border border-border bg-glass/[0.015] p-3.5 sm:grid-cols-2">
                      {platform.features.map((f) => (
                        <div key={f} className="flex items-start gap-2 text-[0.76rem] leading-snug text-t2">
                          <CheckCircle2 className="mt-[1px] h-3.5 w-3.5 shrink-0" style={{ color: platform.accentColor }} />
                          {f}
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* WooCommerce Inline Form */}
                {platform.id === "woocommerce" && wooFormOpen && !isConnected && (
                  <WooCommerceConnect
                    accentColor={platform.accentColor}
                    onCancel={() => setWooFormOpen(false)}
                    onSuccess={() => {
                      setWooFormOpen(false);
                      fetchStatuses();
                      showStatusCard(
                        "success",
                        "WooCommerce Connected!",
                        "Your store is connected. Cart recovery sequences are ready to activate.",
                        "Got it",
                      );
                    }}
                    onError={(msg) => showStatusCard("error", "WooCommerce Connection Failed", msg, "Try Again")}
                  />
                )}

                {platform.id === "shopify" && stores
                  .filter((store) => store.platform === "shopify")
                  .map((store) => {
                    const isRetrying = retryingStoreIds.includes(store.id) || store.setup_status === "in_progress";
                    const setupDone = isStoreSetupComplete(store);
                    const details = store.webhook_details ?? [];
                    const topics = [
                      ["APP_UNINSTALLED", "App uninstalled"],
                      ["ORDERS_CREATE", "Order created"],
                      ["ORDERS_UPDATED", "Order updated"],
                      ["ORDERS_CANCELLED", "Order cancelled"],
                      ["ORDERS_DELETE", "Order deleted"],
                      ["CUSTOMERS_CREATE", "Customer created"],
                      ["CUSTOMERS_UPDATE", "Customer updated"],
                      ["CHECKOUTS_CREATE", "Checkout created"],
                      ["CHECKOUTS_UPDATE", "Checkout updated"],
                    ] as const;
                    const registeredCount = details.filter((item) => item.status === "registered").length;
                    const failedCount = details.filter((item) => item.status === "failed").length;
                    const runningCount = details.filter((item) => item.status === "running").length;
                    const syncRunning = store.status === "syncing";
                    const syncFailed = store.status === "error";
                    const heading = setupDone ? "Your store is ready!" : failedCount > 0 || store.setup_status === "failed" ? "Setup needs attention" : isRetrying ? "Getting your store ready..." : "Shopify setup";
                    const rowDetail = (topic: string) => details.find((item) => item.topic === topic);
                    const rowState = (topic: string) => rowDetail(topic)?.status ?? "unknown";
                    return (
                      <>
                      <div className="mt-3 rounded-2xl border border-slate-200 bg-white px-4 py-5 text-slate-900 shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 sm:px-6">
                        <p className="truncate text-xs font-medium text-slate-500 dark:text-slate-400">{store.shop_domain}</p>
                        <h3 className="mt-1 text-xl font-semibold tracking-tight text-slate-900 dark:text-white">Setup needs attention</h3>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Connecting your store and configuring its webhook subscriptions.</p>
                        {!setupDone && store.connection_status === "connected" && (
                          <button type="button" onClick={() => { setWebhookDetailsStoreId(store.id); void handleRetryStoreSetup(store.id); }} disabled={isRetrying}
                            className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800">
                            {isRetrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpRight className="h-4 w-4" />}
                            {isRetrying ? "Setup running" : "Retry setup"}
                          </button>
                        )}
                      </div>
                      {webhookDetailsStoreId === store.id && createPortal(
                        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Shopify setup details">
                          <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-slate-900 shadow-2xl dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 sm:px-6">
                            <button type="button" onClick={() => setWebhookDetailsStoreId(null)} aria-label="Close setup details" className="sticky top-0 z-20 mb-3 inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">
                              <X className="h-4 w-4" /> Cancel
                            </button>
                        <div className="mx-auto w-full max-w-xl">
                          <p className="truncate text-xs font-medium text-slate-500 dark:text-slate-400">{store.shop_domain}</p>
                          <h3 className="mt-1 text-xl font-semibold tracking-tight text-slate-900 dark:text-white">{heading}</h3>
                          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                            {setupDone ? "Your Shopify store is connected and synchronized." : "Connecting your store and configuring its webhook subscriptions."}
                          </p>
                          <div className="mt-5 mb-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                            <span>{registeredCount} of 9 webhooks registered</span>
                            <span>{store.last_synced_at ? "Initial sync complete" : "Initial sync pending"}</span>
                            {runningCount > 0 && <span className="font-medium text-teal-700 dark:text-teal-400">{runningCount} in progress</span>}
                            {failedCount > 0 && <span className="font-medium text-red-600 dark:text-red-400">{failedCount} failed</span>}
                          </div>
                          <ol className="relative">
                            {topics.map(([topic, label], index) => {
                              const status = rowState(topic);
                              const registered = status === "registered";
                              const failed = status === "failed";
                              const running = status === "running";
                              const detail = rowDetail(topic);
                              const notAttempted = status === "not_attempted";
                              const lineDone = registered;
                              return (
                                <li key={topic} className="relative flex min-h-[66px] gap-3 sm:gap-4">
                                  {index < topics.length - 1 && (
                                    <span aria-hidden="true" className={cn("absolute left-[13px] top-7 h-[calc(100%-7px)] w-px", lineDone ? "bg-emerald-500/60" : "bg-slate-200 dark:bg-slate-700")} />
                                  )}
                                  <span aria-label={registered ? "Successful" : failed ? "Failed" : running ? "Running" : notAttempted ? "Not attempted" : "Pending"} className={cn("relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-slate-50 dark:bg-slate-950", registered ? "border-emerald-600 bg-emerald-600 text-white dark:bg-emerald-600" : failed ? "border-red-500 text-red-600 dark:text-red-400" : running ? "border-teal-600 text-teal-700 dark:text-teal-400" : "border-slate-300 text-slate-400 dark:border-slate-600")}>
                                    {registered ? <CheckCircle2 className="h-4 w-4" /> : failed ? <X className="h-4 w-4" /> : running ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <span className="h-2 w-2 rounded-full bg-current opacity-50" />}
                                  </span>
                                  <div className="min-w-0 flex-1 pb-5">
                                    <p className={cn("text-sm font-medium", registered ? "text-emerald-700 dark:text-emerald-400" : failed ? "text-red-700 dark:text-red-400" : running ? "font-semibold text-slate-900 dark:text-white" : "text-slate-500 dark:text-slate-400")}>{label}</p>
                                    <p className={cn("mt-0.5 break-words text-xs", registered ? "text-emerald-700/80 dark:text-emerald-400/80" : failed ? "text-red-600 dark:text-red-400" : running ? "text-teal-700 dark:text-teal-400" : "text-slate-400 dark:text-slate-500")}>
                                      {registered ? "Registered successfully" : failed ? (detail?.error || "Registration failed. Check server diagnostics and retry setup.") : running ? "Registration in progress" : notAttempted ? "Not attempted" : "No individual result recorded yet"}
                                    </p>
                                  </div>
                                </li>
                              );
                            })}
                            <li className="relative flex gap-3 sm:gap-4">
                              <span aria-hidden="true" className={cn("relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-slate-50 dark:bg-slate-950", store.last_synced_at ? "border-emerald-600 bg-emerald-600 text-white dark:bg-emerald-600" : syncFailed ? "border-red-500 text-red-600 dark:text-red-400" : syncRunning ? "border-teal-600 text-teal-700 dark:text-teal-400" : "border-slate-300 text-slate-400 dark:border-slate-600")}>
                                {store.last_synced_at ? <CheckCircle2 className="h-4 w-4" /> : syncFailed ? <X className="h-4 w-4" /> : syncRunning ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Clock className="h-4 w-4" />}
                              </span>
                              <div className="min-w-0 flex-1 pb-2">
                                <p className={cn("text-sm font-medium", store.last_synced_at ? "text-emerald-700 dark:text-emerald-400" : syncFailed ? "text-red-700 dark:text-red-400" : syncRunning ? "font-semibold text-slate-900 dark:text-white" : "text-slate-500 dark:text-slate-400")}>Synchronizing store data</p>
                                <p className={cn("mt-0.5 break-words text-xs", syncFailed ? "text-red-600 dark:text-red-400" : "text-slate-400 dark:text-slate-500")}>{store.last_synced_at ? `Completed ${new Date(store.last_synced_at).toLocaleString()}` : syncFailed ? "Initial synchronization failed. Check server diagnostics." : syncRunning ? "Initial synchronization in progress" : "Initial sync pending"}</p>
                              </div>
                            </li>
                          </ol>
                          {retryFeedback?.storeId === store.id && (
                            <p role={retryFeedback.state === "failed" ? "alert" : "status"} className={cn("mt-4 rounded-lg border p-3 text-xs leading-relaxed", retryFeedback.state === "success" ? "border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300" : retryFeedback.state === "failed" ? "border-red-500/25 bg-red-500/5 text-red-700 dark:text-red-300" : "border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300")}>{retryFeedback.message}</p>
                          )}
                          {!setupDone && store.connection_status === "connected" && (
                            <button
                              type="button"
                              onClick={() => void handleRetryStoreSetup(store.id)}
                              disabled={isRetrying}
                              className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                            >
                              {isRetrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpRight className="h-4 w-4" />}
                              {isRetrying ? "Setup running" : "Retry setup"}
                            </button>
                          )}
                        </div>
                          </div>
                        </div>, document.body)}
                      </>
                    );
                  })}
                {/* Actions */}
                {!(platform.id === "woocommerce" && wooFormOpen) && (
                  <div className="mt-auto flex items-center gap-2 pt-1">
                    {loading ? (
                      <div className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-bg-3 py-2.5 text-xs text-t2"><Loader2 className="h-4 w-4 animate-spin" /> Loading saved connection…</div>
                    ) : isConnected ? (
                      <button
                        onClick={() => navigate("/dashboard/settings/automation")}
                        className="flex flex-1 items-center justify-center gap-2 rounded-md border border-border bg-glass/[0.035] py-2 text-[0.82rem] font-semibold text-t1 transition-colors hover:border-border-md hover:bg-glass/[0.06]"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" style={{ color: "hsl(var(--accent))" }} />
                        Configure Automation
                      </button>
                    ) : (
                      <button
                        onClick={() => handleConnectClick(platform.id)}
                        className={`flex flex-1 items-center justify-center gap-2 rounded-md py-2.5 text-[0.82rem] transition-opacity hover:opacity-90 ${DESIGN_TOKENS.buttonPrimary}`}
                      >
                        <Plug className="h-3.5 w-3.5" />
                        Connect {platform.name}
                      </button>
                    )}
                    <a
                      href={platform.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`${platform.name} developer docs`}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-glass/[0.025] text-t3 transition-colors hover:border-border-md hover:text-t1"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </section>

      {/* Shopify Prompt Modal */}
      <AnimatePresence>
        {shopifyModalOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
              onClick={() => setShopifyModalOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed left-1/2 top-1/2 z-50 w-full max-w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-bg p-6 shadow-2xl"
            >
              <button
                onClick={() => setShopifyModalOpen(false)}
                className="absolute right-4 top-4 text-t3 transition-colors hover:text-t1"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="mb-5 flex items-center gap-3">
                <LogoTile src="https://cdn.simpleicons.org/shopify/5C8F4D" alt="Shopify" size={10} />
                <div>
                  <h3 className="text-lg font-bold text-t1">Connect Shopify</h3>
                  <p className="text-sm text-t3">Enter your store domain</p>
                </div>
              </div>

              <form onSubmit={handleShopifySubmit} className="space-y-4">
                <div className="space-y-2">
                  <label className="flex items-center gap-1.5 text-sm font-medium text-t2">
                    Shopify Domain
                    <FieldInfo title="Shopify Domain">
                      <p>The subdomain shown when you're logged into your Shopify admin, before <span className="text-t1">.myshopify.com</span>.</p>
                      <p className="text-t3">Find it in Shopify Admin → Settings → Domains, or in your browser's address bar.</p>
                    </FieldInfo>
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="mystore"
                      autoFocus
                      required
                      className="w-full rounded-md border border-border bg-bg-3 py-2.5 pl-3 pr-[110px] text-sm text-t1 outline-none focus:border-[#5C8F4D]/50"
                      value={shopDomain}
                      onChange={(e) => setShopDomain(e.target.value.replace(".myshopify.com", ""))}
                    />
                    <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-t4">
                      .myshopify.com
                    </div>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={!shopDomain.trim()}
                  className="w-full rounded-md py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ background: "#5C8F4D" }}
                >
                  Continue to Shopify
                </button>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Connect success/failure feedback */}
      <GlassmorphismCard
        isOpen={statusCard.open}
        type={statusCard.type}
        title={statusCard.title}
        message={statusCard.message}
        buttonText={statusCard.buttonText}
        onClose={closeStatusCard}
      />

      {/* Coming soon */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[0.72rem] font-bold uppercase tracking-[0.11em] text-t4">
            More platforms — coming in Phase 2
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {COMING_SOON.map((p) => (
            <div
              key={p.name}
              className="group relative flex items-center gap-3 overflow-hidden rounded-xl border border-slate-200 bg-gray-50 px-4 py-3.5 shadow-sm transition-all hover:border-slate-400 hover:bg-white dark:border-slate-800 dark:bg-slate-950 dark:hover:border-slate-600 dark:hover:bg-slate-900"
            >
              {p.logo ? (
                <LogoTile src={p.logo} alt={p.name} size={10} />
              ) : (
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl"
                  style={{ background: `${p.accentColor}14`, border: `1px solid ${p.accentColor}30` }}
                >
                  {p.icon && <p.icon className="h-4 w-4" style={{ color: p.accentColor }} />}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.85rem] font-semibold text-t1">{p.name}</p>
                <p className="truncate text-[0.68rem] text-t3">{p.tagline}</p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border-md bg-bg-3 px-2 py-1 text-[0.62rem] font-bold uppercase tracking-[0.05em] text-t3">
                <Clock className="h-2.5 w-2.5" />
                Soon
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Footer note */}
      <div className="flex items-center justify-center gap-2 pb-6 pt-2 text-[0.72rem] text-t4">
        <ShieldCheck className="h-3 w-3" />
        All store connections are encrypted in transit and at rest.
        <a
          href="https://revlumaai.com/security"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 font-medium text-t3 hover:text-t1"
        >
          Learn more <ArrowUpRight className="h-2.5 w-2.5" />
        </a>
      </div>
    </div>
  );
}