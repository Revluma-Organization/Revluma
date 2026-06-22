// Connect buttons are stubs. onClick comment: TODO Week 2: initiate OAuth flow
// No API calls in this file.
//
// Week 2 wiring:
//   1. Replace useState statuses with GET /api/v1/stores response
//   2. Wire onConnect() to POST /api/v1/stores/oauth/initiate

import { motion } from "framer-motion";
import { ExternalLink, Plug, WifiOff } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

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

//Platform card

interface CardProps {
  platform: Platform;
  status: ConnectionStatus;
  onConnect: (id: Platform["id"]) => void;
}

function PlatformCard({ platform, status, onConnect }: CardProps) {
  const isConnected  = status === "connected";
  const isConnecting = status === "connecting";

  return (
    <motion.div
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

      {/* Description */}
      <p className="text-[0.82rem] leading-relaxed text-t2">{platform.description}</p>

      {/* Features */}
      <ul className="space-y-2">
        {platform.features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-[0.78rem] text-t2">
            <span className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: platform.accentColor }} />
            {f}
          </li>
        ))}
      </ul>

      {/* Actions */}
      <div className="mt-auto flex items-center gap-2 pt-1">
        {isConnected ? (
          <button className="flex-1 rounded-md border border-border bg-white/[0.035] py-2 text-[0.82rem] font-semibold text-t1 transition-colors hover:border-border-md hover:bg-white/[0.06]">
            Manage Connection
          </button>
        ) : (
          <button
            disabled={isConnecting}
            onClick={() => {
              // TODO Week 2: initiate OAuth flow
              onConnect(platform.id);
            }}
            className="flex flex-1 items-center justify-center gap-2 rounded-md py-2.5 text-[0.82rem] font-bold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
            style={{ background: platform.accentColor, color: "#fff" }}
          >
            <Plug className="h-3.5 w-3.5" />
            {isConnecting ? "Connecting…" : `Connect ${platform.name}`}
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
    </motion.div>
  );
}

//Page

export default function Integrations() {
  // TODO Week 2: replace with real store status from GET /api/v1/stores
  const [statuses, setStatuses] = useState<Record<Platform["id"], ConnectionStatus>>({
    shopify:     "not_connected",
    woocommerce: "not_connected",
  });

  function handleConnect(id: Platform["id"]) {
    // TODO Week 2: initiate OAuth flow
    // Stub: show connecting state for visual feedback
    setStatuses((prev) => ({ ...prev, [id]: "connecting" }));
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
      {!anyConnected && (
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
        {PLATFORMS.map((platform) => (
          <PlatformCard
            key={platform.id}
            platform={platform}
            status={statuses[platform.id]}
            onConnect={handleConnect}
          />
        ))}
      </section>

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
