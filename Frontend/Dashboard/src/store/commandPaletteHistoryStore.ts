import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

const MAX_RECENT_COMMANDS = 8;
const MAX_RECENT_QUERIES = 6;

interface CommandPaletteHistoryState {
  /** Most-recently-used command ids, most recent first. */
  recentCommandIds: string[];
  /** Most-recently-typed raw search queries, most recent first. */
  recentQueries: string[];
  /** Pinned command ids (user-curated shortlist). */
  pinnedIds: string[];
  /** Lifetime usage counts, used as a ranking signal ("frequently used"). */
  usageCounts: Record<string, number>;

  recordCommandUse: (id: string) => void;
  recordQuery: (query: string) => void;
  togglePinned: (id: string) => void;
  clearRecent: () => void;
}

export const useCommandPaletteHistory = create<CommandPaletteHistoryState>()(
  persist(
    (set, get) => ({
      recentCommandIds: [],
      recentQueries: [],
      pinnedIds: [],
      usageCounts: {},

      recordCommandUse: (id) => {
        const { recentCommandIds, usageCounts } = get();
        set({
          recentCommandIds: [id, ...recentCommandIds.filter((x) => x !== id)].slice(0, MAX_RECENT_COMMANDS),
          usageCounts: { ...usageCounts, [id]: (usageCounts[id] ?? 0) + 1 },
        });
      },

      recordQuery: (query) => {
        const q = query.trim();
        if (q.length < 2) return;
        const { recentQueries } = get();
        set({
          recentQueries: [q, ...recentQueries.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, MAX_RECENT_QUERIES),
        });
      },

      togglePinned: (id) => {
        const { pinnedIds } = get();
        set({
          pinnedIds: pinnedIds.includes(id) ? pinnedIds.filter((x) => x !== id) : [...pinnedIds, id],
        });
      },

      clearRecent: () => set({ recentCommandIds: [], recentQueries: [] }),
    }),
    {
      name: "rv-command-palette-history",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);