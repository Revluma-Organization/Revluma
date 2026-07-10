import {
  LogOut, Moon, Sun, Compass, Bell, Sparkles, KeyRound, ShieldCheck,
  CreditCard, UserCircle, Download,
} from "lucide-react";
import { NAV } from "@/data/nav";
import type { PaletteCommand, CommandContext } from "./types";
import { toast } from "@/hooks/use-toast";

interface StaticCommandDeps {
  theme: "light" | "dark";
  toggleTheme: () => void;
  startTour: () => void;
  setNotifOpen: (v: boolean) => void;
  openCopilotWithQuery: (q: string) => void;
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
      navigate(n.to);
      close();
    },
  }));
}

/** Core, always-available actions that exist regardless of which page you're on. */
function buildActionCommands(deps: StaticCommandDeps): PaletteCommand[] {
  return [
    {
      id: "action-toggle-theme",
      title: deps.theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode",
      description: "Toggle the dashboard color theme",
      category: "actions",
      icon: deps.theme === "dark" ? Sun : Moon,
      keywords: ["theme", "dark mode", "light mode", "appearance"],
      perform: ({ close }) => { deps.toggleTheme(); close(); },
    },
    {
      id: "action-start-tour",
      title: "Take a Product Tour",
      description: "Guided walkthrough of the dashboard",
      category: "actions",
      icon: Compass,
      keywords: ["tour", "onboarding", "walkthrough", "guide"],
      perform: ({ close }) => { deps.startTour(); close(); },
    },
    {
      id: "action-open-notifications",
      title: "View Notifications",
      category: "actions",
      icon: Bell,
      keywords: ["notifications", "alerts", "inbox"],
      perform: ({ close }) => { deps.setNotifOpen(true); close(); },
    },
    {
      id: "action-open-copilot",
      title: "Ask Revluma Copilot",
      description: "Chat with your AI revenue assistant",
      category: "ai",
      icon: Sparkles,
      keywords: ["ai", "copilot", "chat", "assistant", "ask"],
      perform: ({ close }) => { deps.openCopilotWithQuery(""); close(); },
    },
    {
      id: "action-export-overview",
      title: "Export Overview Report (CSV)",
      category: "actions",
      icon: Download,
      keywords: ["export", "csv", "download", "report"],
      perform: ({ close }) => {
        toast({ title: "Export queued", description: "We'll email you a CSV shortly." });
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
  const comingSoon = (title: string) => ({ close }: CommandContext) => {
    toast({ title, description: "This isn't wired up yet — coming soon." });
    close();
  };

  return [
    {
      id: "settings-change-password",
      title: "Change Password",
      category: "settings",
      icon: KeyRound,
      keywords: ["password", "pass", "reset password", "forgot password"],
      perform: comingSoon("Change Password"),
    },
    {
      id: "settings-2fa",
      title: "Two-Factor Authentication",
      category: "settings",
      icon: ShieldCheck,
      keywords: ["2fa", "security", "mfa", "authentication"],
      perform: comingSoon("Two-Factor Authentication"),
    },
    {
      id: "settings-billing",
      title: "Billing & Subscription",
      category: "settings",
      icon: CreditCard,
      keywords: ["billing", "invoices", "payment", "subscription", "upgrade plan"],
      perform: comingSoon("Billing & Subscription"),
    },
    {
      id: "settings-profile",
      title: "Edit Profile",
      category: "settings",
      icon: UserCircle,
      keywords: ["profile", "account", "name", "email"],
      perform: ({ close }) => { window.location.href = "/profile"; close(); },
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