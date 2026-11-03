import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import '../../../assets/js/theme.js';

export type ThemeMode = 'dark' | 'light';
export type ThemePreference = ThemeMode | 'system';

declare global {
  interface Window {
    RevlumaTheme: {
      preference: () => ThemePreference;
      resolve: (preference: ThemePreference) => ThemeMode;
    };
  }
}

export function resolveTheme(preference: ThemePreference): ThemeMode {
  return window.RevlumaTheme.resolve(preference);
}

function initialPreference(): ThemePreference {
  return window.RevlumaTheme.preference();
}
export type SidebarDensity = 'default' | 'compact' | 'spacious';
export type FontSize = 'small' | 'default' | 'large';

export interface UserPreferences {
  theme: ThemePreference;
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
  preference: ThemePreference;
  preferences: UserPreferences | null;
  synced: boolean;
}

interface ThemeActions {
  setTheme: (theme: ThemePreference) => void;
  toggleTheme: () => void;
  setPreferences: (prefs: UserPreferences) => void;
  updatePreference: <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => void;
  fetchPreferences: () => Promise<void>;
  syncPreference: <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => Promise<void>;
  initializeTheme: () => () => void;
}

type ThemeStore = ThemeState & ThemeActions;

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set, get) => ({
      theme: resolveTheme(initialPreference()),
      preference: initialPreference(),
      preferences: null,
      synced: false,

      setTheme: (theme) => {
        set({ preference: theme, theme: resolveTheme(theme) });
      },

      toggleTheme: () => {
        const next = get().theme === 'dark' ? 'light' : 'dark';
        get().setTheme(next);
      },

      setPreferences: (preferences) => {
        set({ preferences, synced: true });
        if (preferences.theme) {
          get().setTheme(preferences.theme);
        }
      },

      updatePreference: (key, value) => {
        const prefs = get().preferences;
        if (!prefs) return;
        const updated = { ...prefs, [key]: value };
        set({ preferences: updated });
        if (key === 'theme') {
          get().setTheme(value as ThemePreference);
        }
      },

      fetchPreferences: async () => {
        // Mock — no backend call
      },

      syncPreference: async () => {
        // Mock — no backend call
      },

      initializeTheme: () => {
        const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
        const update = () => set({ theme: resolveTheme(get().preference) });
        update();
        if (media?.addEventListener) {
          media.addEventListener('change', update);
          return () => media.removeEventListener('change', update);
        }
        media?.addListener?.(update);
        return () => media?.removeListener?.(update);
      }
    }),
    {
      name: 'rv-theme',
      // Older records contain a resolved theme only. Preserve it as an explicit
      // choice: we cannot infer whether an older dark preference was intentional.
      merge: (persisted, current) => {
        const stored = persisted as Partial<ThemeState> | undefined;
        const preference = initialPreference();
        return { ...current, preferences: stored?.preferences || null, preference, theme: resolveTheme(preference) };
      },
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        preference: state.preference,
        theme: state.theme,
        preferences: state.preferences
      })
    }
  )
);
