import { motion, AnimatePresence } from "framer-motion";
import {
  ExternalLink, Plug, WifiOff, X, Loader2, Info, CheckCircle2,
  Clock, ShieldCheck, ArrowUpRight, Layers, Code2, LayoutTemplate,
} from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { DESIGN_TOKENS } from "@/lib/DesignConstants";

//Types

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

interface ShopifyInstallResponse {
  install_url?: string | null;
  message?: string;
  error?: string;
}

//Platform config

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
  { name: "Magento", tagline: "Adobe Commerce", logo: "/magento-logo.png", accentColor: "#F46F25" },
  { name: "Squarespace", tagline: "All-in-one website builder", logo: "https://cdn.simpleicons.org/squarespace/111111", accentColor: "#111111" },
  { name: "Custom API", tagline: "Bring your own stack", icon: Code2, accentColor: "#4C8DFF" },
];

//Status badge

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  not_connected: "Not Connected",
  connecting: "Connecting…",
  connected: "Connected",
  error: "Connection Error",
};

const STATUS_STYLE: Record<ConnectionStatus, { color: string; bg: string }> = {
  not_connected: { color: "hsl(var(--t3))", bg: "hsl(var(--bg-4))" },
  connecting: { color: "hsl(var(--amber))", bg: "hsl(var(--amber)  / 0.12)" },
  connected: { color: "hsl(var(--green))", bg: "hsl(var(--green)  / 0.12)" },
  error: { color: "hsl(var(--red))", bg: "hsl(var(--red)    / 0.12)" },
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

// Info popover — explains where to find a credential

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

// Logo badge — consistent white tile treatment for every brand mark

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

//Page

export default function Integrations() {
  const [statuses, setStatuses] = useState<Record<Platform["id"], ConnectionStatus>>({
    shopify: "not_connected",
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
      const res = await api.get<{ data: { stores: { platform: "shopify" | "woocommerce"; status: string }[] } }>('/stores');
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

  async function handleShopifySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!shopDomain.trim()) return;

    // Clean the input, remove trailing dots, and append the Shopify suffix
    let cleanShop = shopDomain.trim();
    if (cleanShop.endsWith('.')) {
      cleanShop = cleanShop.slice(0, -1);
    }
    if (!cleanShop.endsWith('.myshopify.com')) {
      cleanShop = `${cleanShop}.myshopify.com`;
    }

    try {
      const response = await api.get<ShopifyInstallResponse>('/shopify/install', {
  shop: cleanShop,
});
      const installUrl = response.data?.install_url?.trim();
      if (!installUrl) {
        throw new Error(response.data?.message ?? 'Shopify install URL was not returned by the server.');
      }

      window.location.assign(installUrl);
    } catch (e) {
      console.error('Shopify connect failed', e);
    }
  }

  async function handleWooSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!wooData.shop_url || !wooData.consumer_key || !wooData.consumer_secret) return;
    setWooSubmitting(true);
    try {
      await api.post('/woocommerce/connect', wooData);
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

  const connectedCount = Object.values(statuses).filter((s) => s === "connected").length;
  const anyConnected = connectedCount > 0;

  return (
    <div className="mx-auto max-w-[1480px] space-y-6">

      {/* Page header */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28 }}
        className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"
      >
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
            style={{ background: anyConnected ? "hsl(var(--green))" : "hsl(var(--t4))" }}
          />
          {connectedCount} of {PLATFORMS.length} platforms connected
        </div>
      </motion.div>

      {/* No-store warning -> Premium Empty State */}
      {!loading && !anyConnected && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className={DESIGN_TOKENS.emptyState.container}
        >
          <div className={DESIGN_TOKENS.emptyState.iconWrapper}>
            <WifiOff className={DESIGN_TOKENS.emptyState.icon} strokeWidth={1.5} />
          </div>
          <h3 className={DESIGN_TOKENS.emptyState.title}>No Store Connected</h3>
          <p className={DESIGN_TOKENS.emptyState.description}>
            Connect your Shopify or WooCommerce store to activate recovery sequences and unlock your live dashboard.
          </p>
          <button
            onClick={() => handleConnectClick('shopify')}
            className={`mt-2 px-6 py-2.5 rounded-lg font-bold text-sm transition-opacity hover:opacity-90 ${DESIGN_TOKENS.buttonPrimary}`}
          >
            Connect Store
          </button>
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
              className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-950 transition-all duration-300 hover:border-slate-400 dark:hover:border-slate-600 hover:bg-white dark:hover:bg-slate-900 shadow-sm"
            >
              {/* accent hairline */}
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
                  <StatusBadge status={status} />
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
                  <form onSubmit={handleWooSubmit} className="flex flex-col gap-3.5 mt-1">
                    <div className="flex items-start gap-2 rounded-lg border border-border-md bg-glass/[0.02] px-3 py-2.5 text-[0.72rem] leading-relaxed text-t3">
                      <ShieldCheck className="mt-[1px] h-3.5 w-3.5 shrink-0" style={{ color: platform.accentColor }} />
                      Your credentials are encrypted and only ever used to sync orders and customers from your store.
                    </div>

                    <div className="space-y-1.5">
                      <label className="flex items-center gap-1.5 text-[0.75rem] font-medium text-t2">
                        Store URL
                        <FieldInfo title="Store URL">
                          <p>The full web address of your WooCommerce store, including <span className="text-t1">https://</span> — the same URL your customers use to shop.</p>
                          <p className="text-t3">Example: https://yourstore.com</p>
                        </FieldInfo>
                      </label>
                      <input
                        type="url"
                        placeholder="https://yourstore.com"
                        required
                        className="w-full rounded-md border border-border bg-bg-3 px-3 py-2 text-[0.82rem] text-t1 outline-none transition-colors focus:border-[color:var(--woo-focus)]"
                        style={{ ["--woo-focus" as string]: platform.accentColor }}
                        value={wooData.shop_url}
                        onChange={e => setWooData({ ...wooData, shop_url: e.target.value })}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="flex items-center gap-1.5 text-[0.75rem] font-medium text-t2">
                        Consumer Key
                        <FieldInfo title="Consumer Key">
                          <p>Found in your WordPress admin under:</p>
                          <p className="text-t1">WooCommerce → Settings → Advanced → REST API</p>
                          <p>Click <span className="text-t1">Add key</span>, set permissions to <span className="text-t1">Read/Write</span>, then generate. It starts with <span className="text-t1">ck_</span>.</p>
                        </FieldInfo>
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="ck_..."
                        className="w-full rounded-md border border-border bg-bg-3 px-3 py-2 text-[0.82rem] text-t1 outline-none transition-colors focus:border-[color:var(--woo-focus)]"
                        style={{ ["--woo-focus" as string]: platform.accentColor }}
                        value={wooData.consumer_key}
                        onChange={e => setWooData({ ...wooData, consumer_key: e.target.value })}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="flex items-center gap-1.5 text-[0.75rem] font-medium text-t2">
                        Consumer Secret
                        <FieldInfo title="Consumer Secret">
                          <p>Generated alongside your Consumer Key on the same screen. It starts with <span className="text-t1">cs_</span> and is shown only once — copy it immediately.</p>
                          <p className="text-t3">Lost it? Just generate a new key pair and paste the new values here.</p>
                        </FieldInfo>
                      </label>
                      <input
                        type="password"
                        required
                        placeholder="cs_..."
                        className="w-full rounded-md border border-border bg-bg-3 px-3 py-2 text-[0.82rem] text-t1 outline-none transition-colors focus:border-[color:var(--woo-focus)]"
                        style={{ ["--woo-focus" as string]: platform.accentColor }}
                        value={wooData.consumer_secret}
                        onChange={e => setWooData({ ...wooData, consumer_secret: e.target.value })}
                      />
                    </div>

                    <div className="flex gap-2 mt-1">
                      <button type="button" onClick={() => setWooFormOpen(false)} className="flex-1 rounded-md border border-border bg-bg-2 py-2 text-[0.82rem] font-medium text-t2 hover:bg-glass/[0.04]">Cancel</button>
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
                      <button className="flex flex-1 items-center justify-center gap-2 rounded-md border border-border bg-glass/[0.035] py-2 text-[0.82rem] font-semibold text-t1 transition-colors hover:border-border-md hover:bg-glass/[0.06]">
                        <CheckCircle2 className="h-3.5 w-3.5" style={{ color: "hsl(var(--green))" }} />
                        Manage Connection
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
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[0.72rem] font-bold uppercase tracking-[0.11em] text-t4">
            More platforms — coming in Phase 2
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {COMING_SOON.map((p) => (
            <div
              key={p.name}
              className="group relative flex items-center gap-3 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-950 px-4 py-3.5 transition-all hover:border-slate-400 dark:hover:border-slate-600 hover:bg-white dark:hover:bg-slate-900 shadow-sm"
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
      <div className="flex items-center justify-center gap-2 pt-2 pb-6 text-[0.72rem] text-t4">
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
