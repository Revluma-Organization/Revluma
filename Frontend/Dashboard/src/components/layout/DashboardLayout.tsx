import { Outlet, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Bell, Sparkles, Compass } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { CommandPalette } from "./CommandPalette";
import { NotificationsPanel } from "./NotificationsPanel";
import { CopilotPanel } from "./CopilotPanel";
import { ProductTour } from "./ProductTour";
import { useEffect, useMemo, useState } from "react";
import { useUI } from "@/store/ui";
import { useThemeStore } from "@/store";
import { useRegisterCommands } from "@/store/commandRegistryStore";
import type { PaletteCommand } from "@/lib/commandPalette/types";
import { OnboardingPaywallModal } from "./OnboardingPaywallModal";
import { useAuth } from "@/context/AuthContext";

const SECTION_TITLES: Record<string, string> = {
  "/dashboard/overview": "Overview",
  "/dashboard/intelligence": "Intelligence",
  "/dashboard/cart-recovery": "Cart Recovery",
  "/dashboard/campaigns": "Campaigns",
  "/dashboard/customers": "Customers",
  "/dashboard/analytics": "Analytics",
  "/dashboard/integrations": "Integrations",
  "/dashboard/beta": "Beta Features",
};

export function DashboardLayout() {
  const { startTour, setCmdOpen, setNotifOpen, setCopilotOpen } = useUI();
  const theme = useThemeStore((s) => s.theme);
  const { pathname } = useLocation();
  // Use basePath for animation key to prevent re-mounting the entire layout for nested routes
  const basePath = pathname.split('/').slice(0, 3).join('/');
  const { user } = useAuth(); // Grabs the logged-in user
  const [isPaywallOpen, setIsPaywallOpen] = useState(true);

  const globalCommands = useMemo<PaletteCommand[]>(() => [
    {
      id: "layout-open-palette",
      title: "Open Command Palette",
      description: "Search pages, actions, and tools instantly",
      category: "actions",
      icon: Search,
      shortcut: "⌘K",
      keywords: ["search", "palette", "jump", "find"],
      aliases: ["global search", "quick search"],
      perform: ({ close }) => { setCmdOpen(true); close(); },
    },
    {
      id: "layout-open-notifications",
      title: "View Notifications",
      description: "Open your inbox and activity feed",
      category: "actions",
      icon: Bell,
      shortcut: "⌘⇧N",
      keywords: ["notifications", "alerts", "inbox"],
      aliases: ["alerts", "messages"],
      perform: ({ close }) => { setNotifOpen(true); close(); },
    },
    {
      id: "layout-open-copilot",
      title: "Ask Revluma Copilot",
      description: "Open the AI assistant with your current context",
      category: "ai",
      icon: Sparkles,
      shortcut: "⌘⇧A",
      keywords: ["ai", "copilot", "assistant", "chat"],
      aliases: ["intelligence", "ask ai"],
      perform: ({ close }) => { setCopilotOpen(true); close(); },
    },
    {
      id: "layout-start-tour",
      title: "Take a Product Tour",
      description: "Launch the guided onboarding walkthrough",
      category: "actions",
      icon: Compass,
      shortcut: "⌘⇧T",
      keywords: ["tour", "onboarding", "walkthrough", "guide"],
      aliases: ["guided tour"],
      perform: ({ close }) => { startTour(); close(); },
    },
  ], [setCmdOpen, setNotifOpen, setCopilotOpen, startTour]);

  useRegisterCommands(globalCommands);

  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
  }, [theme]);

  // Auto-start tour for first-time visitors on the Overview page
  useEffect(() => {
    if (pathname !== "/dashboard/overview") return;
    if (typeof window === "undefined") return;
    if (localStorage.getItem("rv_tour_done") === "true") return;
    const t = window.setTimeout(() => startTour(), 700);
    return () => window.clearTimeout(t);
  }, [pathname, startTour]);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-bg">
      <Sidebar />
      <main className="flex flex-1 flex-col overflow-y-auto overflow-x-hidden bg-bg">
        <Topbar section={SECTION_TITLES[pathname] ?? "Overview"} />
        <div className="px-4 py-5 sm:px-6 sm:py-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={basePath}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
      <CommandPalette />
      <NotificationsPanel />
      <CopilotPanel />
      <ProductTour />
      <OnboardingPaywallModal 
        isOpen={isPaywallOpen} 
        onClose={() => setIsPaywallOpen(false)} 
        userStatus={user?.status || "free"} 
      />
    </div>
  );
}
