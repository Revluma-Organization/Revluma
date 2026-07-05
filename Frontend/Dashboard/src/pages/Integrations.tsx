import { motion, AnimatePresence } from "framer-motion";
import { ExternalLink, Plug, WifiOff, X, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

//Types

type ConnectionStatus = "not_connected" | "connecting" | "connected" | "error";

interface Platform {
  id: "shopify" | "woocommerce";
  name: string;
  tagline: string;
  description: string;
  logoInitial: string;
  accentColor: string;
  accentBg: string;
  accentBorder: string;
  docsUrl: string;
  features: string[];
}

//Platform config

const PLATFORMS: Platform[] = [
  {
    id: "shopify",
    name: "Shopify",
    tagline: "The world's leading e-commerce platform",
    description:
      "Connect your Shopify store to automatically detect abandoned carts, sync customer profiles, and fire recovery sequences — no code required.",
    logoInitial: "S",
    accentColor: "#5C8F4D",
    accentBg: "hsl(142 40% 42% / 0.10)",
    accentBorder: "hsl(142 40% 42% / 0.28)",
    docsUrl: "https://shopify.dev/docs/apps/auth/oauth",
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
    logoInitial: "W",
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

//Status badge

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  not_connected: "Not Connected",
  connecting:    "Connecting…",
  connected:     "Connected",
  error:         "Connection Error",
};

const STATUS_STYLE: Record<ConnectionStatus, { color: string; bg: string }> = {
  not_connected: { color: "hsl(var(--t3))",   bg: "hsl(var(--bg-4))" },
  connecting:    { color: "hsl(var(--amber))", bg: "hsl(var(--amber)  / 0.12)" },
  connected:     { color: "hsl(var(--green))", bg: "hsl(var(--green)  / 0.12)" },
  error:         { color: "hsl(var(--red))",   bg: "hsl(var(--red)    / 0.12)" },
};

function StatusBadge({ status }: { status: ConnectionStatus }) {
  const { color, bg } = STATUS_STYLE[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.72rem] font-semibold"
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

//Page

export default function Integrations() {
  const [statuses, setStatuses] = useState<Record<Platform["id"], ConnectionStatus>>({
    shopify:     "not_connected",
    woocommerce: "not_connected",
  });
  const [loading, setLoading] = useState(true);

  // Shopify Modal State
  const [shopifyModalOpen, setShopifyModalOpen] = useState(false);
  const [shopDomain, setShopDomain] = useState("");

  // WooCommerce Inline Form State
  const [wooFormOpen, setWooFormOpen] = useState(false);
  const [wooData, setWooData] = useState({ shop_url: "", consumer_key: "", consumer_secret: "" });
  const [wooSubmitting, setWooSubmitting] = useState(false);

  // Fetch initial statuses
  const fetchStatuses = async () => {
    try {
      const res = await api.get<{ data: { stores: { platform: "shopify" | "woocommerce"; status: string }[] } }>('/api/v1/stores');
      const stores = res.data?.data?.stores || [];
      const newStatuses = { shopify: "not_connected", woocommerce: "not_connected" } as Record<Platform["id"], ConnectionStatus>;
      
      stores.forEach(store => {
        if (store.status === "active") {
          newStatuses[store.platform] = "connected";
        }
      });
      setStatuses(newStatuses);
    } catch (e) {
      console.error("Failed to fetch store statuses", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatuses();
  }, []);

  function handleConnectClick(id: Platform["id"]) {
    if (id === "shopify") {
      setShopifyModalOpen(true);
    } else if (id === "woocommerce") {
      setWooFormOpen(true);
    }
  }

  function handleShopifySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!shopDomain.trim()) return;
    const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:8000";
    window.location.href = `${apiUrl}/api/v1/shopify/install?shop=${shopDomain.trim()}`;
  }

  async function handleWooSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!wooData.shop_url || !wooData.consumer_key || !wooData.consumer_secret) return;
    setWooSubmitting(true);
    try {
      await api.post('/api/v1/woocommerce/connect', wooData);
      setWooFormOpen(false);
      setStatuses(prev => ({ ...prev, woocommerce: "connected" }));
      // Optional: re-fetch statuses
      fetchStatuses();
    } catch (e) {
      console.error("WooCommerce connect failed", e);
      setStatuses(prev => ({ ...prev, woocommerce: "error" }));
    } finally {
      setWooSubmitting(false);
    }
  }

  const anyConnected = Object.values(statuses).some((s) => s === "connected");

  return (
    <div className="mx-auto max-w-[1480px] space-y-6">
      
      {/* Page header */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28 }}
      >
        <h1 className="display text-[1.6rem] font-extrabold tracking-tight text-t1 sm:text-[1.85rem]">
          Connect Your Store
        </h1>
        <p className="mt-1 text-[0.85rem] text-t2">
          Connect your Shopify or WooCommerce store to start recovering abandoned carts.
        </p>
      </motion.div>

      {/* No-store warning */}
      {!loading && !anyConnected && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center gap-3 rounded-xl border border-border bg-bg-2 px-4 py-3"
        >
          <WifiOff className="h-4 w-4 shrink-0 text-t3" />
          <p className="text-[0.82rem] text-t2">
            <strong className="text-t1">No store connected.</strong>{" "}
            Connect at least one store to activate recovery sequences and unlock your live dashboard.
          </p>
        </motion.div>
      )}

      {/* Platform cards — side by side */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2" aria-label="Platform integrations">
        {PLATFORMS.map((platform) => {
          const status = statuses[platform.id];
          const isConnected = status === "connected";
          
          return (
            <motion.div
              key={platform.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="glass-card flex flex-col gap-5 p-6"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border text-[1.25rem] font-extrabold"
                    style={{ background: platform.accentBg, borderColor: platform.accentBorder, color: platform.accentColor }}
                  >
                    {platform.logoInitial}
                  </div>
                  <div>
                    <h2 className="text-[1rem] font-bold leading-tight text-t1">{platform.name}</h2>
                    <p className="mt-0.5 text-[0.72rem] text-t3">{platform.tagline}</p>
                  </div>
                </div>
                <StatusBadge status={status} />
              </div>

              {/* Description & Features */}
              {!(platform.id === "woocommerce" && wooFormOpen) && (
                <>
                  <p className="text-[0.82rem] leading-relaxed text-t2">{platform.description}</p>
                  <ul className="space-y-2">
                    {platform.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-[0.78rem] text-t2">
                        <span className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: platform.accentColor }} />
                        {f}
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {/* WooCommerce Inline Form */}
              {platform.id === "woocommerce" && wooFormOpen && !isConnected && (
                <form onSubmit={handleWooSubmit} className="flex flex-col gap-3 mt-2">
                  <div className="space-y-1">
                    <label className="text-[0.75rem] font-medium text-t2">Store URL</label>
                    <input 
                      type="url" 
                      placeholder="https://yourstore.com"
                      required
                      className="w-full rounded-md border border-border bg-bg-3 px-3 py-2 text-[0.82rem] text-t1 outline-none focus:border-border-focus"
                      value={wooData.shop_url}
                      onChange={e => setWooData({...wooData, shop_url: e.target.value})}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[0.75rem] font-medium text-t2">Consumer Key</label>
                    <input 
                      type="text" 
                      required
                      placeholder="ck_..."
                      className="w-full rounded-md border border-border bg-bg-3 px-3 py-2 text-[0.82rem] text-t1 outline-none focus:border-border-focus"
                      value={wooData.consumer_key}
                      onChange={e => setWooData({...wooData, consumer_key: e.target.value})}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[0.75rem] font-medium text-t2">Consumer Secret</label>
                    <input 
                      type="password" 
                      required
                      placeholder="cs_..."
                      className="w-full rounded-md border border-border bg-bg-3 px-3 py-2 text-[0.82rem] text-t1 outline-none focus:border-border-focus"
                      value={wooData.consumer_secret}
                      onChange={e => setWooData({...wooData, consumer_secret: e.target.value})}
                    />
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button type="button" onClick={() => setWooFormOpen(false)} className="flex-1 rounded-md border border-border bg-bg-2 py-2 text-[0.82rem] font-medium text-t2 hover:bg-white/[0.04]">Cancel</button>
                    <button type="submit" disabled={wooSubmitting} className="flex flex-1 items-center justify-center gap-2 rounded-md py-2 text-[0.82rem] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50" style={{ background: platform.accentColor }}>
                      {wooSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />}
                      Connect
                    </button>
                  </div>
                </form>
              )}

              {/* Actions */}
              {!(platform.id === "woocommerce" && wooFormOpen) && (
                <div className="mt-auto flex items-center gap-2 pt-1">
                  {isConnected ? (
                    <button className="flex-1 rounded-md border border-border bg-white/[0.035] py-2 text-[0.82rem] font-semibold text-t1 transition-colors hover:border-border-md hover:bg-white/[0.06]">
                      Manage Connection
                    </button>
                  ) : (
                    <button
                      onClick={() => handleConnectClick(platform.id)}
                      className="flex flex-1 items-center justify-center gap-2 rounded-md py-2.5 text-[0.82rem] font-bold transition-opacity hover:opacity-90"
                      style={{ background: platform.accentColor, color: "#fff" }}
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
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-white/[0.025] text-t3 transition-colors hover:border-border-md hover:text-t1"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              )}
            </motion.div>
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
                className="absolute right-4 top-4 text-t3 hover:text-t1 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
              
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#5C8F4D]/10 text-[#5C8F4D] border border-[#5C8F4D]/30">
                  <Plug className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-t1">Connect Shopify</h3>
                  <p className="text-sm text-t3">Enter your store domain</p>
                </div>
              </div>

              <form onSubmit={handleShopifySubmit} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-t2">Shopify Domain</label>
                  <div className="relative">
                    <input 
                      type="text" 
                      placeholder="mystore"
                      autoFocus
                      required
                      className="w-full rounded-md border border-border bg-bg-3 py-2.5 pl-3 pr-[110px] text-sm text-t1 outline-none focus:border-border-focus"
                      value={shopDomain}
                      onChange={e => setShopDomain(e.target.value.replace('.myshopify.com', ''))}
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-t4 pointer-events-none">
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

      {/* Coming soon */}
      <section>
        <p className="mb-3 text-[0.72rem] font-bold uppercase tracking-[0.11em] text-t4">
          More platforms — coming in Phase 2
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {["BigCommerce", "Magento", "Squarespace", "Custom API"].map((name) => (
            <div
              key={name}
              className="flex items-center gap-2.5 rounded-xl border border-border bg-bg-2 px-4 py-3 opacity-45"
            >
              <div
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-[0.72rem] font-bold text-t3"
                style={{ background: "hsl(var(--bg-4))", borderColor: "hsl(var(--border-soft) / 0.10)" }}
              >
                {name[0]}
              </div>
              <span className="text-[0.8rem] font-medium text-t2">{name}</span>
            </div>
          ))}
        </div>
      </section>

    </div>
  );
}
