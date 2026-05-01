import { create } from "zustand";

interface UIState {
  sidebarCollapsed: boolean;
  mobileSidebarOpen: boolean;
  cmdOpen: boolean;
  notifOpen: boolean;
  copilotOpen: boolean;
  tourOpen: boolean;
  tourStep: number;
  theme: "dark" | "light";
  dateRange: "Today" | "Last 7 days" | "Last 30 days" | "Last 90 days" | "This year";
  setSidebarCollapsed: (v: boolean) => void;
  setMobileSidebarOpen: (v: boolean) => void;
  setCmdOpen: (v: boolean) => void;
  setNotifOpen: (v: boolean) => void;
  setCopilotOpen: (v: boolean) => void;
  startTour: () => void;
  endTour: () => void;
  setTourStep: (n: number) => void;
  toggleTheme: () => void;
  setDateRange: (v: UIState["dateRange"]) => void;
}

const persisted = {
  collapsed: typeof window !== "undefined" && localStorage.getItem("rv_collapsed") === "true",
  theme: (typeof window !== "undefined" && (localStorage.getItem("rv_theme") as "dark" | "light")) || "dark",
};

export const useUI = create<UIState>((set, get) => ({
  sidebarCollapsed: persisted.collapsed,
  mobileSidebarOpen: false,
  cmdOpen: false,
  notifOpen: false,
  copilotOpen: false,
  tourOpen: false,
  tourStep: 0,
  theme: persisted.theme,
  dateRange: "Last 30 days",
  setSidebarCollapsed: (v) => {
    localStorage.setItem("rv_collapsed", String(v));
    set({ sidebarCollapsed: v });
  },
  setMobileSidebarOpen: (v) => set({ mobileSidebarOpen: v }),
  setCmdOpen: (v) => set({ cmdOpen: v }),
  setNotifOpen: (v) => set({ notifOpen: v }),
  setCopilotOpen: (v) => set({ copilotOpen: v }),
  startTour: () => set({ tourOpen: true, tourStep: 0 }),
  endTour: () => {
    localStorage.setItem("rv_tour_done", "true");
    set({ tourOpen: false });
  },
  setTourStep: (n) => set({ tourStep: n }),
  toggleTheme: () => {
    const next = get().theme === "dark" ? "light" : "dark";
    localStorage.setItem("rv_theme", next);
    document.documentElement.classList.toggle("light", next === "light");
    set({ theme: next });
  },
  setDateRange: (v) => set({ dateRange: v }),
}));
