import {
  AlertTriangle, Building2, Bell, CreditCard, MonitorSmartphone, Palette,
  ShieldCheck, SlidersHorizontal, UserCircle, Users, Workflow,
  type LucideIcon,
} from "lucide-react";

/**
 * Single source of truth for Settings navigation. The app sidebar's
 * Settings mode, the mobile Settings index, the breadcrumb, the Billing tabs
 * and the command palette all read from here, so a page added once shows up
 * everywhere.
 *
 * Only pages that are actually built are listed. Placeholder routes (AI,
 * Email, SMS, API keys, Security, Audit log, ...) keep their URLs in
 * `routes/index.tsx` but stay out of the menu until they ship.
 */

export const SETTINGS_ROOT = "/dashboard/settings";

/** Minimum workspace role that can use the page (mirrors backend requireRole). */
export type SettingsRole = "owner" | "admin" | "member";

export interface SettingsNavItem {
  id: string;
  label: string;
  to: string;
  icon: LucideIcon;
  description: string;
  keywords: string[];
  /** Extra paths that belong to this entry (aliases, tab pages). */
  matches?: string[];
  minRole?: SettingsRole;
  tone?: "danger";
}

export interface SettingsNavGroup {
  id: string;
  /** Visible group label; omitted for the trailing Danger zone group. */
  label?: string;
  items: SettingsNavItem[];
}

const path = (slug: string) => `${SETTINGS_ROOT}/${slug}`;

export const BILLING_TABS = [
  { label: "Overview", to: path("billing") },
  { label: "Plan", to: path("subscription") },
  { label: "Payment methods", to: path("payment-methods") },
  { label: "Invoices", to: path("invoices"), matches: [path("invoice-history")] },
] as const;

export const SETTINGS_NAV: SettingsNavGroup[] = [
  {
    id: "account",
    label: "Account",
    items: [
      { id: "profile", label: "Profile", to: path("profile"), icon: UserCircle, description: "Name, photo, password and 2-step verification", keywords: ["name", "photo", "avatar", "password", "2fa", "email"] },
      { id: "preferences", label: "Preferences", to: path("preferences"), icon: SlidersHorizontal, description: "Language, time zone and display", keywords: ["language", "timezone", "theme", "display", "locale"] },
      { id: "notifications", label: "Notifications", to: path("notifications"), icon: Bell, description: "What Revluma emails and alerts you about", keywords: ["alerts", "email", "digest"], matches: [path("notification")] },
      { id: "active-sessions", label: "Active sessions", to: path("active-sessions"), icon: MonitorSmartphone, description: "Devices signed in to your account", keywords: ["devices", "sign out", "security", "login"] },
    ],
  },
  {
    id: "workspace",
    label: "Workspace",
    items: [
      { id: "organization", label: "General", to: path("organization"), icon: Building2, description: "Workspace name, logo and details", keywords: ["organization", "company", "workspace name", "logo"] },
      { id: "team", label: "Members", to: path("team"), icon: Users, description: "Invite people and manage access", keywords: ["team", "invite", "staff", "users"] },
      { id: "roles", label: "Roles & permissions", to: path("roles"), icon: ShieldCheck, description: "What each role can do", keywords: ["rbac", "access", "owner", "admin"] },
      { id: "branding", label: "Branding", to: path("branding"), icon: Palette, description: "Colours and logo on customer messages", keywords: ["brand", "colors", "logo", "theme"] },
      { id: "automation", label: "Automation", to: path("automation"), icon: Workflow, description: "Rules Rev runs on your behalf", keywords: ["rules", "workflows", "cart recovery", "triggers"] },
      {
        id: "billing", label: "Billing", to: path("billing"), icon: CreditCard, description: "Plan, payment methods and invoices",
        keywords: ["plan", "subscription", "invoice", "payment", "upgrade"],
        matches: BILLING_TABS.flatMap((tab) => [tab.to, ...("matches" in tab ? tab.matches : [])]),
        minRole: "admin",
      },
    ],
  },
  {
    id: "danger",
    items: [
      { id: "danger-zone", label: "Danger zone", to: path("danger-zone"), icon: AlertTriangle, description: "Transfer ownership or delete the workspace", keywords: ["delete workspace", "transfer ownership", "destructive"], minRole: "owner", tone: "danger" },
    ],
  },
];

const RANK: Record<SettingsRole, number> = { member: 0, admin: 1, owner: 2 };

/**
 * Hides an entry only when the role is *known* to be too low. The auth store
 * holds `"unknown"` while a session is being verified; in that case everything
 * stays visible and the backend's requireRole is the real gate.
 */
export function canSeeSettingsItem(item: SettingsNavItem, role: string | null | undefined): boolean {
  if (!item.minRole) return true;
  const normalized = (role ?? "").trim().toLowerCase();
  if (!(normalized in RANK)) return true;
  return RANK[normalized as SettingsRole] >= RANK[item.minRole];
}

export function visibleSettingsNav(role: string | null | undefined, query = ""): SettingsNavGroup[] {
  const needle = query.trim().toLowerCase();
  return SETTINGS_NAV
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => canSeeSettingsItem(item, role) && (!needle
        || item.label.toLowerCase().includes(needle)
        || (group.label ?? "").toLowerCase().includes(needle)
        || item.keywords.some((keyword) => keyword.includes(needle)))),
    }))
    .filter((group) => group.items.length > 0);
}

const owns = (target: string, pathname: string) => pathname === target || pathname.startsWith(`${target}/`);

export function isSettingsPath(pathname: string): boolean {
  return owns(SETTINGS_ROOT, pathname);
}

export function isSettingsItemActive(item: SettingsNavItem, pathname: string): boolean {
  return [item.to, ...(item.matches ?? [])].some((target) => owns(target, pathname));
}

export function findSettingsLocation(pathname: string): { group?: SettingsNavGroup; item?: SettingsNavItem } {
  for (const group of SETTINGS_NAV) {
    const item = group.items.find((entry) => isSettingsItemActive(entry, pathname));
    if (item) return { group, item };
  }
  return {};
}

export const LAST_APP_ROUTE_KEY = "rv_last_app_route";
const DEFAULT_APP_ROUTE = "/dashboard/overview";

/** Remembers the last non-settings page so "Back to dashboard" returns there. */
export function rememberAppRoute(route: string) {
  try {
    window.sessionStorage.setItem(LAST_APP_ROUTE_KEY, route);
  } catch {
    // Storage can be unavailable (private mode, quota). Back falls back to Overview.
  }
}

export function readLastAppRoute(): string {
  try {
    const stored = window.sessionStorage.getItem(LAST_APP_ROUTE_KEY);
    if (stored && stored.startsWith("/dashboard") && !isSettingsPath(stored.split(/[?#]/)[0])) return stored;
  } catch {
    // Fall through to the default.
  }
  return DEFAULT_APP_ROUTE;
}

export interface SettingsCrumb { label: string; to?: string }

/** Settings trail: Dashboard / Settings / <page> (Dashboard hides on phones). */
export function resolveSettingsCrumbs(pathname: string): SettingsCrumb[] | undefined {
  if (pathname !== SETTINGS_ROOT && !pathname.startsWith(`${SETTINGS_ROOT}/`)) return undefined;
  const { item } = findSettingsLocation(pathname);
  const root: SettingsCrumb[] = [{ label: "Dashboard", to: "/dashboard/overview" }];
  if (!item) return [...root, { label: "Settings" }];
  return [...root, { label: "Settings", to: SETTINGS_ROOT }, { label: item.label }];
}
