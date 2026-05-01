import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { CommandPalette } from "./CommandPalette";
import { NotificationsPanel } from "./NotificationsPanel";
import { CopilotPanel } from "./CopilotPanel";
import { ProductTour } from "./ProductTour";
import { useEffect } from "react";
import { useUI } from "@/store/ui";

const SECTION_TITLES: Record<string, string> = {
  "/": "Overview",
  "/intelligence": "Intelligence",
  "/cart-recovery": "Cart Recovery",
  "/campaigns": "Campaigns",
  "/customers": "Customers",
  "/analytics": "Analytics",
  "/integrations": "Integrations",
  "/beta": "Beta Features",
};

export function DashboardLayout() {
  const { theme, startTour } = useUI();
  const { pathname } = useLocation();

  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
  }, [theme]);

  // Auto-start tour for first-time visitors on the Overview page
  useEffect(() => {
    if (pathname !== "/") return;
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
          <Outlet />
        </div>
      </main>
      <CommandPalette />
      <NotificationsPanel />
      <CopilotPanel />
      <ProductTour />
    </div>
  );
}
