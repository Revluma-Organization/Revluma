import { Outlet, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { CommandPalette } from "./CommandPalette";
import { NotificationsPanel } from "./NotificationsPanel";
import { CopilotPanel } from "./CopilotPanel";
import { ProductTour } from "./ProductTour";
import { useEffect } from "react";
import { useUI } from "@/store/ui";
import { useThemeStore } from "@/store";

const SECTION_TITLES: Record<string, string> = {
  "/dashboard/overview":     "Overview",
  "/dashboard/intelligence": "Intelligence",
  "/dashboard/cart-recovery":"Cart Recovery",
  "/dashboard/campaigns":    "Campaigns",
  "/dashboard/customers":    "Customers",
  "/dashboard/analytics":    "Analytics",
  "/dashboard/integrations": "Integrations",
  "/dashboard/beta":         "Beta Features",
};

export function DashboardLayout() {
  const { startTour } = useUI();
  const theme = useThemeStore((s) => s.theme);
  const { pathname } = useLocation();

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
              key={pathname}
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
    </div>
  );
}