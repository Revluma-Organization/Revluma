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
    group: "Core", label: "Command Center", to: "/dashboard/overview", icon: LayoutGrid,
    description: "Your store's live performance at a glance",
    keywords: ["home", "dashboard", "summary", "kpis"],
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