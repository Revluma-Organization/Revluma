import {
  LogOut, Moon, Sun, Compass, Bell, Sparkles, KeyRound, ShieldCheck,
  CreditCard, UserCircle, Download, Search,
} from "lucide-react";
import { NAV } from "@/data/nav";
import { resolveDashboardRoute } from "./routes";
import type { PaletteCommand, CommandContext } from "./types";

interface StaticCommandDeps {
  theme: "light" | "dark";
  toggleTheme: () => void;
  startTour: () => void;
  setNotifOpen: (v: boolean) => void;
  openCopilotWithQuery: (q: string) => void;
  openPalette: () => void;
  logout: () => void | Promise<void>;
}

/** Pages — derived directly from NAV, the same source that drives the sidebar. */
function buildPageCommands(): PaletteCommand[] {
  return NAV.map((n) => ({
    id: `page-${n.to}`,
    title: n.label,
    description: n.description,
    category: "pages",
    icon: n.icon,
    keywords: n.keywords,
    badge: n.badge?.text,
    perform: ({ navigate, close }: CommandContext) => {
      navigate(resolveDashboardRoute(n.to));
      close();
    },
  }));
}

/** Core, always-available actions that exist regardless of which page you're on. */
function buildActionCommands(deps: StaticCommandDeps): PaletteCommand[] {
  return [
    {
      id: "action-open-palette",
      title: "Open Command Palette",
      description: "Search everything in Revluma instantly",
      category: "actions",
      icon: Search,
      shortcut: "⌘K",
      keywords: ["command palette", "search", "find", "jump", "open"],
      aliases: ["palette", "global search", "quick search"],
      perform: ({ close }) => { deps.openPalette(); close(); },
    },
    {
      id: "action-toggle-theme",
      title: deps.theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode",
      description: "Toggle the dashboard color theme",
      category: "actions",
      icon: deps.theme === "dark" ? Sun : Moon,
      shortcut: "⌘⇧L",
      keywords: ["theme", "dark mode", "light mode", "appearance"],
      aliases: ["color mode", "visual theme"],
      perform: ({ close }) => { deps.toggleTheme(); close(); },
    },
    {
      id: "action-start-tour",
      title: "Take a Product Tour",
      description: "Guided walkthrough of the dashboard",
      category: "actions",
      icon: Compass,
      shortcut: "⌘⇧T",
      keywords: ["tour", "onboarding", "walkthrough", "guide"],
      aliases: ["product tour", "guided tour"],
      perform: ({ close }) => { deps.startTour(); close(); },
    },
    {
      id: "action-open-notifications",
      title: "View Notifications",
      category: "actions",
      icon: Bell,
      shortcut: "⌘⇧N",
      keywords: ["notifications", "alerts", "inbox"],
      aliases: ["alerts", "messages"],
      perform: ({ close }) => { deps.setNotifOpen(true); close(); },
    },
    {
      id: "action-open-copilot",
      title: "Ask Revluma Copilot",
      description: "Chat with your AI revenue assistant",
      category: "ai",
      icon: Sparkles,
      shortcut: "⌘⇧A",
      keywords: ["ai", "copilot", "chat", "assistant", "ask"],
      aliases: ["intelligence", "assistant", "ask ai"],
      perform: ({ close }) => { deps.openCopilotWithQuery(""); close(); },
    },
    {
      id: "action-export-overview",
      title: "Export Overview Report (CSV)",
      category: "actions",
      icon: Download,
      keywords: ["export", "csv", "download", "report"],
      // Navigates to Invoice History where the real CSV export button lives
      perform: ({ navigate, close }: CommandContext) => {
        navigate("/dashboard/settings/invoice-history");
        close();
      },
    },
    {
      id: "action-logout",
      title: "Log Out",
      category: "actions",
      icon: LogOut,
      keywords: ["sign out", "logout", "exit"],
      perform: async ({ close }) => { close(); await deps.logout(); },
    },
  ];
}

/**
 * Account & security commands. These map to real, common enterprise-app
 * intents (password, 2FA, billing) that don't yet have dedicated settings
 * pages in this build — so instead of linking to a dead route, they
 * surface an honest "coming soon" toast. Swap `perform` for real
 * navigation the moment those pages ship; nothing else about the palette
 * needs to change.
 */
function buildSettingsCommands(): PaletteCommand[] {
  return [
    {
      id: "settings-change-password",
      title: "Change Password",
      category: "settings",
      icon: KeyRound,
      keywords: ["password", "pass", "reset password", "forgot password", "security"],
      aliases: ["change pass", "login security", "sign in security"],
      // Routes to the Security & System settings section where password change lives
      perform: ({ navigate, close }: CommandContext) => {
        navigate("/dashboard/settings/security");
        close();
      },
    },
    {
      id: "settings-2fa",
      title: "Two-Factor Authentication",
      category: "settings",
      icon: ShieldCheck,
      keywords: ["2fa", "security", "mfa", "authentication", "codes"],
      aliases: ["two factor", "auth", "login security"],
      // Routes to the Security & System settings section where 2FA lives
      perform: ({ navigate, close }: CommandContext) => {
        navigate("/dashboard/settings/security");
        close();
      },
    },
    {
      id: "settings-billing",
      title: "Billing & Subscription",
      category: "settings",
      icon: CreditCard,
      keywords: ["billing", "invoices", "payment", "subscription", "upgrade plan"],
      aliases: ["plan", "invoice", "payment method"],
      // Routes directly to the Billing Overview settings page
      perform: ({ navigate, close }: CommandContext) => {
        navigate("/dashboard/settings/billing");
        close();
      },
    },
    {
      id: "settings-profile",
      title: "Edit Profile",
      category: "settings",
      icon: UserCircle,
      keywords: ["profile", "account", "name", "email"],
      perform: ({ navigate, close }: CommandContext) => {
        navigate("/dashboard/settings/profile");
        close();
      },
    },
    {
      id: "settings-danger-zone",
      title: "Danger Zone",
      category: "settings",
      icon: ShieldCheck,
      keywords: ["delete workspace", "transfer ownership", "danger", "destructive"],
      aliases: ["delete", "transfer", "nuke"],
      perform: ({ navigate, close }: CommandContext) => {
        navigate("/dashboard/settings/danger-zone");
        close();
      },
    },
    {
      id: "settings-team",
      title: "Team Members",
      category: "settings",
      icon: UserCircle,
      keywords: ["team", "members", "invite", "staff", "colleagues"],
      aliases: ["staff", "invite member"],
      perform: ({ navigate, close }: CommandContext) => {
        navigate("/dashboard/settings/team-members");
        close();
      },
    },
  ];
}

export function buildStaticCommands(deps: StaticCommandDeps): PaletteCommand[] {
  return [
    ...buildPageCommands(),
    ...buildActionCommands(deps),
    ...buildSettingsCommands(),
  ];
}
