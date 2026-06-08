import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type DateRange = 'Today' | 'Last 7 days' | 'Last 30 days' | 'Last 90 days' | 'This year';

interface UIState {
  sidebarCollapsed: boolean;
  mobileSidebarOpen: boolean;
  cmdOpen: boolean;
  notifOpen: boolean;
  copilotOpen: boolean;
  tourOpen: boolean;
  tourStep: number;
  tourDismissed: boolean;
  dateRange: DateRange;
  activeModal: string | null;
}

interface UIActions {
  setSidebarCollapsed: (v: boolean) => void;
  setMobileSidebarOpen: (v: boolean) => void;
  setCmdOpen: (v: boolean) => void;
  setNotifOpen: (v: boolean) => void;
  setCopilotOpen: (v: boolean) => void;
  startTour: () => void;
  endTour: () => void;
  setTourStep: (n: number) => void;
  setDateRange: (v: DateRange) => void;
  setActiveModal: (v: string | null) => void;
}

type UIStore = UIState & UIActions;

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      mobileSidebarOpen: false,
      cmdOpen: false,
      notifOpen: false,
      copilotOpen: false,
      tourOpen: false,
      tourStep: 0,
      tourDismissed: false,
      dateRange: 'Last 30 days',
      activeModal: null,

      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
      setMobileSidebarOpen: (v) => set({ mobileSidebarOpen: v }),
      setCmdOpen: (v) => set({ cmdOpen: v }),
      setNotifOpen: (v) => set({ notifOpen: v }),
      setCopilotOpen: (v) => set({ copilotOpen: v }),
      startTour: () => set({ tourOpen: true, tourStep: 0 }),
      endTour: () => set({ tourOpen: false, tourDismissed: true }),
      setTourStep: (n) => set({ tourStep: n }),
      setDateRange: (v) => set({ dateRange: v }),
      setActiveModal: (v) => set({ activeModal: v })
    }),
    {
      name: 'rv-ui',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        tourDismissed: state.tourDismissed,
        dateRange: state.dateRange
      })
    }
  )
);
