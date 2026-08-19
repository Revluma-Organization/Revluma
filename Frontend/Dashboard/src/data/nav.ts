import {
  LayoutGrid, Sparkles, ShoppingCart, Mail, Users,
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
    group: "Core", label: "Overview", to: "/dashboard/overview", icon: LayoutGrid,
    description: "Your store's live performance at a glance",
    keywords: ["home", "dashboard", "summary", "kpis"],
  },
  {
    group: "Recover", label: "Rev Intell", to: "/dashboard/rev-intell", icon: Sparkles,
    badge: { text: "AI", tone: "new" },
    description: "Your autonomous AI business intelligence advisor",
    keywords: ["ai", "intelligence", "chat", "rev", "advisor", "insights", "revenue"],
    useCustomIcon: true,
  },
  {
    group: "Recover", label: "Cart Recovery", to: "/dashboard/cart-recovery", icon: ShoppingCart,
    description: "Abandoned cart recovery sequences",
    keywords: ["abandoned", "carts", "recovery", "sequences", "checkout"],
  },
  {
    group: "Grow", label: "Campaigns", to: "/dashboard/campaigns", icon: Mail,
    badge: { text: "3", tone: "count" },
    description: "Email and SMS marketing campaigns",
    keywords: ["mail", "email", "sms", "marketing", "automations", "workflows"],
  },
  {
    group: "Grow", label: "Customers", to: "/dashboard/customers", icon: Users,
    description: "Customer profiles and segments",
    keywords: ["users", "clients", "segments", "rfm", "contacts"],
  },
  {
    group: "Analyze", label: "Analytics", to: "/dashboard/analytics", icon: BarChart3,
    description: "Deep dive into store performance",
    keywords: ["reports", "revenue", "stats", "metrics", "charts"],
  },
  {
    group: "Settings", label: "Integrations", to: "/dashboard/integrations", icon: Plug,
    description: "Connect Shopify, WooCommerce, and more",
    keywords: ["shopify", "woocommerce", "connect", "store", "apps", "plugins"],
  },
  {
    group: "Settings", label: "Beta Features", to: "/dashboard/beta", icon: Layers,
    badge: { text: "Beta", tone: "beta" },
    description: "Early access to new Revluma features",
    keywords: ["experimental", "labs", "preview"],
  },
];