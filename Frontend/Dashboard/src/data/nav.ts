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
}

export const NAV: NavItem[] = [
  { group: "Core",     label: "Overview",       to: "/",              icon: LayoutGrid },
  { group: "Recover",  label: "Intelligence",   to: "/intelligence",  icon: Sparkles,     badge: { text: "New", tone: "new" } },
  { group: "Recover",  label: "Cart Recovery",  to: "/cart-recovery", icon: ShoppingCart },
  { group: "Grow",     label: "Campaigns",      to: "/campaigns",     icon: Mail,         badge: { text: "3", tone: "count" } },
  { group: "Grow",     label: "Customers",      to: "/customers",     icon: Users },
  { group: "Analyze",  label: "Analytics",      to: "/analytics",     icon: BarChart3 },
  { group: "Settings", label: "Integrations",   to: "/integrations",  icon: Plug },
  { group: "Settings", label: "Beta Features",  to: "/beta",          icon: Layers,       badge: { text: "Beta", tone: "beta" } },
];
