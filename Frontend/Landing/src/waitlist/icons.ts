/**
 * One icon per answer, so the choices read at a glance instead of as a wall
 * of text. Decorative only: every option keeps its full text label.
 */
import {
  Activity,
  ChartColumn,
  CircleHelp,
  CircleSlash,
  Clock,
  Cog,
  CreditCard,
  FileSpreadsheet,
  ListChecks,
  ListOrdered,
  MessageCircleQuestion,
  MousePointerClick,
  PackageX,
  PenLine,
  Radar,
  Rocket,
  Search,
  ShoppingCart,
  Siren,
  Telescope,
  TrendingDown,
  TrendingUp,
  UserX,
  Boxes,
  type LucideIcon,
} from "lucide-react";

export const OPTION_ICONS: Record<string, LucideIcon> = {
  // Challenges
  browse_no_purchase: MousePointerClick,
  cart_abandonment: ShoppingCart,
  declining_sales: TrendingDown,
  operational_inefficiency: Cog,
  inventory_availability: PackageX,
  unclear_whats_wrong: CircleHelp,
  prioritization: ListOrdered,
  other: PenLine,
  // How problems are found
  shopify_analytics: ChartColumn,
  other_analytics: Telescope,
  tools_spreadsheets: FileSpreadsheet,
  manual: Search,
  after_sales_affected: Siren,
  no_process: CircleSlash,
  // Capabilities
  revenue_leaks: Radar,
  why_not_purchasing: UserX,
  checkout_cart: CreditCard,
  unusual_changes: Activity,
  inventory_risks: Boxes,
  prioritized_recommendations: ListChecks,
  monitoring_improvement: TrendingUp,
  // Founding interest
  yes: Rocket,
  maybe: MessageCircleQuestion,
  not_now: Clock,
};
