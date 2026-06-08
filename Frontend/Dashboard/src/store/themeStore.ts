import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import api from '@/lib/api';

export type ThemeMode = 'dark' | 'light';
export type SidebarDensity = 'default' | 'compact' | 'spacious';
export type FontSize = 'small' | 'default' | 'large';

export interface UserPreferences {
  theme: ThemeMode;
  date_format: string;
  time_format: string;
  currency: string;
  language: string;
  sidebar_density: SidebarDensity;
  font_size: FontSize;
  notification_prefs: Record<string, unknown>;
}

interface ThemeState {
  theme: ThemeMode;
  preferences: UserPreferences | null;
  synced: boolean;
}

interface ThemeActions {
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  setPreferences: (prefs: UserPreferences) => void;
  updatePreference: <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => void;
  fetchPreferences: () => Promise<void>;
  syncPreference: <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => Promise<void>;
  initializeTheme: () => void;
}

type ThemeStore = ThemeState & ThemeActions;

function applyThemeClass(theme: ThemeMode) {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('light', theme === 'light');
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      preferences: null,
      synced: false,

      setTheme: (theme) => {
        applyThemeClass(theme);
        set({ theme });
      },

      toggleTheme: () => {
        const next = get().theme === 'dark' ? 'light' : 'dark';
        applyThemeClass(next);
        set({ theme: next });
      },

      setPreferences: (preferences) => {
        set({ preferences, synced: true });
        if (preferences.theme) {
          applyThemeClass(preferences.theme);
          set({ theme: preferences.theme });
        }
      },

      updatePreference: (key, value) => {
        const prefs = get().preferences;
        if (!prefs) return;
        const updated = { ...prefs, [key]: value };
        set({ preferences: updated });
        if (key === 'theme') {
          applyThemeClass(value as ThemeMode);
          set({ theme: value as ThemeMode });
        }
      },

      fetchPreferences: async () => {
        try {
          const response = await api.get('/v1/preferences', { withCredentials: true });
          if (response.data?.success) {
            const prefs = response.data.data as UserPreferences;
            set({ preferences: prefs, synced: true });
            if (prefs.theme) {
              applyThemeClass(prefs.theme);
              set({ theme: prefs.theme });
            }
          }
        } catch {
          // silently fail — preferences not critical
        }
      },

      syncPreference: async (key, value) => {
        const payload: Record<string, unknown> = {};
        payload[key] = value;
        try {
          await api.put('/v1/preferences', payload, { withCredentials: true });
        } catch {
          // silently fail
        }
      },

      initializeTheme: () => {
        const { theme } = get();
        applyThemeClass(theme);
      }
    }),
    {
      name: 'rv-theme',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        theme: state.theme,
        preferences: state.preferences
      })
    }
  )
);
