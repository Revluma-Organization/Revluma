import {
  LayoutGrid, ListOrdered, Activity, Sparkles, ShoppingCart, Mail, Users,
  BarChart3, Plug, Layers, type LucideIcon,
} from "lucide-react";

export interface NavItem {
  group: string;
  label: string;
  to: string;
  icon: LucideIcon;
  badge?: { text: string; tone: "new" | "beta" | "count" };
  description?: string;
  /** Aliases / synonyms so fuzzy search finds this page from related terms. */
  keywords?: string[];
  /** Use a custom image instead of a Lucide icon */
  useCustomIcon?: boolean;
}

export const NAV: NavItem[] = [
  {
    group: "Core", label: "Command Center", to: "/dashboard/overview", icon: LayoutGrid,
    description: "Your store's live performance at a glance",
    keywords: ["home", "dashboard", "summary", "kpis"],
  },
  // Priorities and Signals are views of the single Command Center dataset,
  // so they are overview deep links (anchors), not separate routes — the
  // single-endpoint data contract stays intact. The sidebar and breadcrumb
  // treat their `?section=` values as owned navigation state.
  {
    group: "Core", label: "Priorities", to: "/dashboard/overview?section=priority", icon: ListOrdered,
    description: "Ranked findings that need action first",
    keywords: ["priorities", "top", "urgent", "ranked", "findings", "action"],
  },
  {
    group: "Core", label: "Signals", to: "/dashboard/overview?section=signals", icon: Activity,
    description: "Signal evaluation coverage and recent activity",
    keywords: ["signals", "activity", "events", "feed", "coverage", "evaluation"],
  },
  {
    group: "Intelligence", label: "Rev Intell", to: "/dashboard/rev-intell", icon: Sparkles,
    badge: { text: "AI", tone: "new" },
    description: "Your autonomous AI business intelligence advisor",
    keywords: ["ai", "intelligence", "chat", "rev", "advisor", "insights", "revenue"],
    useCustomIcon: true,
  },
  {
    group: "Operations", label: "Cart Recovery", to: "/dashboard/cart-recovery", icon: ShoppingCart,
    description: "Abandoned cart recovery sequences",
    keywords: ["abandoned", "carts", "recovery", "sequences", "checkout"],
  },
  {
    group: "Operations", label: "Campaigns", to: "/dashboard/campaigns", icon: Mail,
    
    description: "Email and SMS marketing campaigns",
    keywords: ["mail", "email", "sms", "marketing", "automations", "workflows"],
  },
  {
    group: "Intelligence", label: "Customers", to: "/dashboard/customers", icon: Users,
    description: "Customer profiles and segments",
    keywords: ["users", "clients", "segments", "rfm", "contacts"],
  },
  {
    group: "Intelligence", label: "Analytics", to: "/dashboard/analytics", icon: BarChart3,
    description: "Deep dive into store performance",
    keywords: ["reports", "revenue", "stats", "metrics", "charts"],
  },
  {
    group: "Workspace", label: "Integrations", to: "/dashboard/integrations", icon: Plug,
    description: "Connect Shopify, WooCommerce, and more",
    keywords: ["shopify", "woocommerce", "connect", "store", "apps", "plugins"],
  },
  {
    group: "Workspace", label: "Beta Features", to: "/dashboard/beta", icon: Layers,
    badge: { text: "Beta", tone: "beta" },
    description: "Early access to new Revluma features",
    keywords: ["experimental", "labs", "preview"],
  },
];

// MVP visibility only. Legacy pages and routes remain preserved.
const MVP_ROUTES = new Set([
  "/dashboard/overview",
  "/dashboard/overview?section=priority",
  "/dashboard/overview?section=signals",
  "/dashboard/rev-intell",
  "/dashboard/integrations",
]);

const MVP_DESCRIPTIONS: Record<string, string> = {
  "/dashboard/overview": "Store health, priority findings, and next steps",
  "/dashboard/overview?section=priority": "Ranked findings that need action first",
  "/dashboard/overview?section=signals": "Signal evaluation coverage and recent activity",
  "/dashboard/rev-intell": "Investigate available store evidence with Rev",
  "/dashboard/integrations": "Manage Shopify connection and synchronization",
};

export const MVP_NAV: NavItem[] = NAV
  .filter((item) => MVP_ROUTES.has(item.to))
  .map((item) => ({
    ...item,
    group: "Workspace",
    description: MVP_DESCRIPTIONS[item.to] ?? item.description,
  }));
