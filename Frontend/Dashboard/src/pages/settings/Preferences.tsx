import { FC, useState, useEffect, useCallback, type FormEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Monitor,
  Sun,
  Moon,
  Globe,
  Clock,
  Calendar,
  CheckCircle2,
  Loader2,
  Sparkles,
  Sliders,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useThemeStore } from "@/store/themeStore";
import { api } from "@/lib/api";

type ThemeOption = "system" | "light" | "dark";

interface AestheticBlock {
  id: ThemeOption;
  name: string;
  subtitle: string;
  icon: JSX.Element;
  previewBg: string;
}

const THEME_BLOCKS: AestheticBlock[] = [
  {
    id: "system",
    name: "System",
    subtitle: "Syncs with OS setting",
    icon: <Monitor className="h-5 w-5" />,
    previewBg: "bg-gradient-to-r from-slate-200 to-slate-900",
  },
  {
    id: "light",
    name: "Light",
    subtitle: "Bright and crisp UI",
    icon: <Sun className="h-5 w-5 text-amber-400" />,
    previewBg: "bg-slate-100 border border-slate-300",
  },
  {
    id: "dark",
    name: "Dark",
    subtitle: "Sleek slate dark UI",
    icon: <Moon className="h-5 w-5 text-sky-400" />,
    previewBg: "bg-slate-950 border border-slate-800",
  },
];

export const Preferences: FC = () => {
  const globalTheme = useThemeStore((state) => state.theme);
  const setThemeGlobal = useThemeStore((state) => state.setTheme);
  const updatePreference = useThemeStore((state) => state.updatePreference);

  const [theme, setTheme] = useState<ThemeOption>(
    globalTheme === "light" ? "light" : "dark"
  );
  const [language, setLanguage] = useState<string>("");
  const [timezone, setTimezone] = useState<string>("");
  const [dateFormat, setDateFormat] = useState<string>("");

  const fetchUserPreferences = useCallback(async () => {
    try {
      const res = await api.get<{
        theme?: ThemeOption;
        language?: string;
        timezone?: string;
        dateFormat?: string;
      }>("/user/preferences", undefined, { skipAuthRedirect: true });
        const prefs = res.data?.data; 
        
        if (prefs) {
          if (prefs.language) {
            setLanguage(prefs.language);
            updatePreference("language", prefs.language);
            if (typeof document !== "undefined") {
              document.documentElement.lang = prefs.language;
            }
          }
          if (prefs.timezone) setTimezone(prefs.timezone);
        
          if (prefs.dateFormat) setDateFormat(prefs.dateFormat); 
        }
    } catch (err) {
      console.warn("Failed to fetch preferences from API:", err);
    }
  }, [updatePreference]);

  useEffect(() => {
    fetchUserPreferences();
  }, [fetchUserPreferences]);

  const handleThemeSelect = (mode: ThemeOption) => {
    setTheme(mode);
    setSavedSuccessfully(false);
    if (mode === "system") {
      const isSystemDark = window.matchMedia(
        "(prefers-color-scheme: dark)"
      ).matches;
      setThemeGlobal(isSystemDark ? "dark" : "light");
    } else {
      setThemeGlobal(mode);
    }
  };

  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [savedSuccessfully, setSavedSuccessfully] = useState<boolean>(false);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSavedSuccessfully(false);
    const payload = {
      theme: theme === "system" ? globalTheme : theme,
      language,
      dateFormat: dateFormat,
      timezone,
    };
    try {
      await api.put("/user/preferences", payload, { skipAuthRedirect: true });
      if (language) {
        updatePreference("language", language);
        if (typeof document !== "undefined") {
          document.documentElement.lang = language;
        }
      }
      if (dateFormat) {
        updatePreference("date_format", dateFormat);
      }
      setSavedSuccessfully(true);
    } catch (err) {
      console.error("Failed API PUT /user/preferences:", err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="w-full max-w-5xl space-y-8 rounded-2xl bg-slate-950 p-6 text-slate-100 shadow-2xl sm:p-8 md:p-10">
      {/* Page Header */}
      <div className="flex flex-col justify-between gap-4 border-b border-slate-800 pb-6 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-500/10 text-sky-400 ring-1 ring-sky-500/20">
            <Sliders className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              User Preferences
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Customize your interface theme, regional localization, and timestamp formatting.
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Card 1: Interface Theme */}
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 shadow-xl transition-all duration-300 hover:border-slate-700 hover:bg-slate-900/80 sm:p-8"
        >
          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold text-white sm:text-xl">
              Interface Theme
            </h2>
            <p className="text-xs text-slate-400 sm:text-sm">
              Select your preferred appearance for the Revluma dashboard and navigation.
            </p>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {THEME_BLOCKS.map((block) => {
              const isSelected = theme === block.id;
              return (
                <div
                  key={block.id}
                  onClick={() => {
                    handleThemeSelect(block.id);
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      handleThemeSelect(block.id);
                    }
                  }}
                  className={`group relative flex flex-col justify-between overflow-hidden rounded-xl border p-4 transition-all duration-200 cursor-pointer ${
                    isSelected
                      ? "border-sky-500 bg-sky-500/10 text-sky-200 ring-1 ring-sky-500/30 shadow-lg shadow-sky-500/10"
                      : "border-slate-800 bg-slate-950/70 text-slate-300 hover:border-slate-700 hover:bg-slate-900"
                  }`}
                >
                  {/* Top Preview Banner */}
                  <div className="flex items-center justify-between">
                    <div
                      className={`h-9 w-14 rounded-md ${block.previewBg} flex items-center justify-center`}
                    >
                      {block.icon}
                    </div>

                    {isSelected && (
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-500 text-white">
                        <CheckCircle2 className="h-4 w-4" />
                      </span>
                    )}
                  </div>

                  {/* Label & Description */}
                  <div className="mt-4">
                    <div className="text-sm font-bold text-white group-hover:text-sky-300 transition-colors">
                      {block.name}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-400">
                      {block.subtitle}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </motion.section>

        {/* Card 2: Localization */}
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 shadow-xl transition-all duration-300 hover:border-slate-700 hover:bg-slate-900/80 sm:p-8"
        >
          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold text-white sm:text-xl">
              Localization
            </h2>
            <p className="text-xs text-slate-400 sm:text-sm">
              Configure your language preferences and local geographic timezone for metrics and schedules.
            </p>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Default Language Dropdown */}
            <div className="space-y-2">
              <Label
                htmlFor="default-language"
                className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400"
              >
                <Globe className="h-3.5 w-3.5 text-sky-400" />
                <span>Default Language</span>
              </Label>
              <Select
                value={language}
                onValueChange={(val) => {
                  setLanguage(val);
                  setSavedSuccessfully(false);
                  updatePreference("language", val);
                  if (typeof document !== "undefined") {
                    document.documentElement.lang = val;
                  }
                  localStorage.setItem("rv_locale_language", val);
                }}
              >
                <SelectTrigger
                  id="default-language"
                  className="h-11 w-full border-slate-700 bg-slate-950 text-slate-100 focus:border-sky-500 focus:ring-1 focus:ring-sky-500/30"
                >
                  <SelectValue placeholder="Select language" />
                </SelectTrigger>
                <SelectContent className="border-slate-800 bg-slate-950 text-slate-100">
                  <SelectItem value="en-US">
                    American English (en-US) — Default
                  </SelectItem>
                  <SelectItem value="en-GB">
                    British English (en-GB)
                  </SelectItem>
                  <SelectItem value="es-ES">
                    Spanish — Español (es-ES)
                  </SelectItem>
                  <SelectItem value="fr-FR">
                    French — Français (fr-FR)
                  </SelectItem>
                  <SelectItem value="de-DE">
                    German — Deutsch (de-DE)
                  </SelectItem>
                  <SelectItem value="ja-JP">
                    Japanese — 日本語 (ja-JP)
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[0.75rem] text-slate-500">
                Determines UI copy and numerical formatting across all dashboard modules.
              </p>
            </div>

            {/* Timezone Dropdown */}
            <div className="space-y-2">
              <Label
                htmlFor="timezone-select"
                className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400"
              >
                <Clock className="h-3.5 w-3.5 text-sky-400" />
                <span>Timezone</span>
              </Label>
              <Select
                value={timezone}
                onValueChange={(val) => {
                  setTimezone(val);
                  setSavedSuccessfully(false);
                }}
              >
                <SelectTrigger
                  id="timezone-select"
                  className="h-11 w-full border-slate-700 bg-slate-950 text-slate-100 focus:border-sky-500 focus:ring-1 focus:ring-sky-500/30"
                >
                  <SelectValue placeholder="Select timezone" />
                </SelectTrigger>
                <SelectContent className="border-slate-800 bg-slate-950 text-slate-100">
                  <SelectItem value="America/Los_Angeles">
                    Pacific Time (US & Canada) — UTC-08:00
                  </SelectItem>
                  <SelectItem value="America/New_York">
                    Eastern Time (US & Canada) — UTC-05:00
                  </SelectItem>
                  <SelectItem value="Europe/London">
                    Greenwich Mean Time (London) — UTC+00:00
                  </SelectItem>
                  <SelectItem value="Europe/Paris">
                    Central European Time (Paris, Berlin) — UTC+01:00
                  </SelectItem>
                  <SelectItem value="Asia/Tokyo">
                    Japan Standard Time (Tokyo) — UTC+09:00
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[0.75rem] text-slate-500">
                Used for analytics charts, scheduled email campaigns, and order timestamps.
              </p>
            </div>
          </div>
        </motion.section>

        {/* Card 3: Date & Time Format */}
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
          className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 shadow-xl transition-all duration-300 hover:border-slate-700 hover:bg-slate-900/80 sm:p-8"
        >
          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold text-white sm:text-xl">
              Date & Time Format
            </h2>
            <p className="text-xs text-slate-400 sm:text-sm">
              Choose how dates and timestamps appear across data tables, audit logs, and reports.
            </p>
          </div>

          <div className="mt-6 max-w-md">
            {/* Preferred Format Dropdown */}
            <div className="space-y-2">
              <Label
                htmlFor="date-format-select"
                className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400"
              >
                <Calendar className="h-3.5 w-3.5 text-sky-400" />
                <span>Preferred Format</span>
              </Label>
              <Select
                value={dateFormat}
                onValueChange={(val) => {
                  setDateFormat(val);
                  setSavedSuccessfully(false);
                }}
              >
                <SelectTrigger
                  id="date-format-select"
                  className="h-11 w-full border-slate-700 bg-slate-950 text-slate-100 focus:border-sky-500 focus:ring-1 focus:ring-sky-500/30"
                >
                  <SelectValue placeholder="Select date format" />
                </SelectTrigger>
                <SelectContent className="border-slate-800 bg-slate-950 text-slate-100">
                  <SelectItem value="MM/DD/YYYY">
                    MM/DD/YYYY (e.g., 07/26/2026) — American Standard
                  </SelectItem>
                  <SelectItem value="DD/MM/YYYY">
                    DD/MM/YYYY (e.g., 26/07/2026) — International
                  </SelectItem>
                  <SelectItem value="YYYY-MM-DD">
                    YYYY-MM-DD (e.g., 2026-07-26) — ISO 8601 Standard
                  </SelectItem>
                  <SelectItem value="MMM DD, YYYY">
                    MMM DD, YYYY (e.g., Jul 26, 2026) — Verbose Standard
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[0.75rem] text-slate-500">
                Applies immediately across all tables and export files.
              </p>
            </div>
          </div>
        </motion.section>

        {/* Feedback Message */}
        <AnimatePresence>
          {savedSuccessfully && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-300"
            >
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
              <span>
                Your interface theme and localization preferences have been saved successfully.
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bottom Bar: Save Preferences Button */}
        <div className="flex justify-end pt-2">
          <Button
            type="submit"
            disabled={isSaving}
            className="h-11 w-full min-w-[170px] bg-sky-600 px-6 font-semibold text-white shadow-lg shadow-sky-600/20 transition-all hover:bg-sky-500 active:scale-[0.98] sm:w-auto"
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                <span>Saving Preferences...</span>
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4 text-sky-200" />
                <span>Save Preferences</span>
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default Preferences;
