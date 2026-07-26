import {
  FC,
  useState,
  useEffect,
  useCallback,
  useRef,
  type FormEvent,
  type ChangeEvent,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Palette,
  Upload,
  Image as ImageIcon,
  Globe,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";

export const Branding: FC = () => {
  const [primaryColor, setPrimaryColor] = useState<string>("#0EA5E9");
  const [accentColor, setAccentColor] = useState<string>("#10B981");

  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoFileName, setLogoFileName] = useState<string>("");

  const [faviconPreview, setFaviconPreview] = useState<string | null>(null);
  const [faviconFileName, setFaviconFileName] = useState<string>("");

  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">(
    "idle"
  );
  const [errorMessage, setErrorMessage] = useState<string>("");

  const logoInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);

  const fetchBranding = useCallback(async () => {
    try {
      const res = await api.get<{
        primaryColor?: string;
        accentColor?: string;
      }>("/settings/branding", undefined, { skipAuthRedirect: true });
      if (res && res.data) {
        if (res.data.primaryColor) {
          setPrimaryColor(res.data.primaryColor);
          document.documentElement.style.setProperty(
            "--primary",
            res.data.primaryColor
          );
        }
        if (res.data.accentColor) {
          setAccentColor(res.data.accentColor);
          document.documentElement.style.setProperty(
            "--accent",
            res.data.accentColor
          );
        }
      } else {
        const savedPrimary = localStorage.getItem("rv_primary_color");
        const savedAccent = localStorage.getItem("rv_accent_color");
        if (savedPrimary) {
          setPrimaryColor(savedPrimary);
          document.documentElement.style.setProperty("--primary", savedPrimary);
        }
        if (savedAccent) {
          setAccentColor(savedAccent);
          document.documentElement.style.setProperty("--accent", savedAccent);
        }
      }
    } catch (err) {
      console.warn("Failed to fetch branding from API:", err);
      const savedPrimary = localStorage.getItem("rv_primary_color");
      const savedAccent = localStorage.getItem("rv_accent_color");
      if (savedPrimary) {
        setPrimaryColor(savedPrimary);
        document.documentElement.style.setProperty("--primary", savedPrimary);
      }
      if (savedAccent) {
        setAccentColor(savedAccent);
        document.documentElement.style.setProperty("--accent", savedAccent);
      }
    }
  }, []);

  useEffect(() => {
    fetchBranding();
  }, [fetchBranding]);

  const handlePrimaryColorChange = (e: ChangeEvent<HTMLInputElement>) => {
    const newColor = e.target.value;
    setPrimaryColor(newColor);
    setSaveStatus("idle");
    if (typeof document !== "undefined") {
      document.documentElement.style.setProperty("--primary", newColor);
    }
  };

  const handleAccentColorChange = (e: ChangeEvent<HTMLInputElement>) => {
    const newColor = e.target.value;
    setAccentColor(newColor);
    setSaveStatus("idle");
    if (typeof document !== "undefined") {
      document.documentElement.style.setProperty("--accent", newColor);
    }
  };

  const handleLogoSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        setSaveStatus("error");
        setErrorMessage("Brand logo file size must be under 2MB.");
        return;
      }
      const url = URL.createObjectURL(file);
      setLogoPreview(url);
      setLogoFileName(file.name);
      setSaveStatus("idle");
    }
  };

  const handleFaviconSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 512 * 1024) {
        setSaveStatus("error");
        setErrorMessage("Favicon image file size must be under 512KB.");
        return;
      }
      const url = URL.createObjectURL(file);
      setFaviconPreview(url);
      setFaviconFileName(file.name);
      setSaveStatus("idle");
    }
  };

  const handleResetDefaults = () => {
    setPrimaryColor("#0EA5E9");
    setAccentColor("#10B981");
    setLogoPreview(null);
    setLogoFileName("");
    setFaviconPreview(null);
    setFaviconFileName("");
    setSaveStatus("idle");
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveStatus("idle");
    try {
      await api.put(
        "/settings/branding",
        { primaryColor, accentColor },
        { skipAuthRedirect: true }
      );
      localStorage.setItem("rv_primary_color", primaryColor);
      localStorage.setItem("rv_accent_color", accentColor);
      setSaveStatus("success");
    } catch (err) {
      console.warn("Failed API PUT branding, storing locally:", err);
      localStorage.setItem("rv_primary_color", primaryColor);
      localStorage.setItem("rv_accent_color", accentColor);
      setSaveStatus("success");
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
            <Palette className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Branding Customization
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Customize the color palette, logo, and favicon for your specific storefront and customer emails.
            </p>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleResetDefaults}
          disabled={isSaving}
          className="flex items-center gap-2 border-slate-700 bg-slate-900/80 text-xs text-slate-300 hover:bg-slate-800 hover:text-white"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>Reset Defaults</span>
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Section 1: Color Palette */}
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 shadow-xl transition-all duration-300 hover:border-slate-700/80 sm:p-8"
        >
          <div className="space-y-2">
            <h2 className="text-lg font-semibold text-white sm:text-xl">
              Color Palette
            </h2>
            <p className="text-sm text-slate-400">
              Pick your primary and accent brand colors visually. Click any swatch to open your standard system color picker.
            </p>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Primary Color Picker (Native <input type="color"> + Dynamic Hex Display) */}
            <div className="space-y-2.5">
              <Label
                htmlFor="primary-color-picker"
                className="text-sm font-medium text-slate-300"
              >
                Primary Color
              </Label>
              <div className="flex items-center gap-4 rounded-xl border border-slate-800 bg-slate-950/80 p-3 shadow-sm transition-colors hover:border-slate-700">
                {/* Visual native color picker */}
                <div className="relative flex h-12 w-16 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-slate-700 shadow-md transition-transform hover:scale-105 active:scale-95">
                  <input
                    id="primary-color-picker"
                    type="color"
                    value={primaryColor}
                    onChange={handlePrimaryColorChange}
                    className="absolute -inset-2 h-20 w-24 cursor-pointer border-0 bg-transparent opacity-0"
                    aria-label="Pick primary brand color"
                  />
                  <div
                    className="h-full w-full pointer-events-none"
                    style={{ backgroundColor: primaryColor }}
                  />
                </div>

                {/* Dynamically displayed hex code text */}
                <div className="flex flex-col">
                  <span className="font-mono text-base font-bold tracking-wider text-white">
                    {primaryColor.toUpperCase()}
                  </span>
                  <span className="text-[0.7rem] text-slate-400">
                    Click swatch to pick color
                  </span>
                </div>
              </div>
              <p className="text-xs text-slate-500">
                Used for primary navigation, primary buttons, and active link states.
              </p>
            </div>

            {/* Accent Color Picker (Native <input type="color"> + Dynamic Hex Display) */}
            <div className="space-y-2.5">
              <Label
                htmlFor="accent-color-picker"
                className="text-sm font-medium text-slate-300"
              >
                Accent Color
              </Label>
              <div className="flex items-center gap-4 rounded-xl border border-slate-800 bg-slate-950/80 p-3 shadow-sm transition-colors hover:border-slate-700">
                {/* Visual native color picker */}
                <div className="relative flex h-12 w-16 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-slate-700 shadow-md transition-transform hover:scale-105 active:scale-95">
                  <input
                    id="accent-color-picker"
                    type="color"
                    value={accentColor}
                    onChange={handleAccentColorChange}
                    className="absolute -inset-2 h-20 w-24 cursor-pointer border-0 bg-transparent opacity-0"
                    aria-label="Pick accent brand color"
                  />
                  <div
                    className="h-full w-full pointer-events-none"
                    style={{ backgroundColor: accentColor }}
                  />
                </div>

                {/* Dynamically displayed hex code text */}
                <div className="flex flex-col">
                  <span className="font-mono text-base font-bold tracking-wider text-white">
                    {accentColor.toUpperCase()}
                  </span>
                  <span className="text-[0.7rem] text-slate-400">
                    Click swatch to pick color
                  </span>
                </div>
              </div>
              <p className="text-xs text-slate-500">
                Used for secondary callouts, badges, success metrics, and highlights.
              </p>
            </div>

            {/* Live Theme Preview Box */}
            <div className="flex flex-col justify-center rounded-xl border border-slate-800 bg-slate-950 p-4 shadow-inner">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Live Swatch Preview
              </span>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="rounded-lg px-4 py-2 text-xs font-semibold text-white shadow-md transition-transform hover:scale-105"
                  style={{ backgroundColor: primaryColor }}
                >
                  Primary Button
                </button>
                <span
                  className="rounded-full px-3 py-1 text-xs font-medium"
                  style={{
                    backgroundColor: `${accentColor}20`,
                    color: accentColor,
                    border: `1px solid ${accentColor}40`,
                  }}
                >
                  Accent Badge
                </span>
              </div>
            </div>
          </div>
        </motion.section>

        {/* Section 2: Assets (Brand Logo & Favicon) */}
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 shadow-xl transition-all duration-300 hover:border-slate-700/80 sm:p-8"
        >
          <div className="space-y-2">
            <h2 className="text-lg font-semibold text-white sm:text-xl">
              Brand Assets
            </h2>
            <p className="text-sm text-slate-400">
              Upload your primary store logo and favicon using the dashed upload dropzones below.
            </p>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Brand Logo Upload Zone */}
            <div className="flex flex-col justify-between rounded-2xl border-2 border-dashed border-slate-800 bg-slate-950/60 p-6 transition-all duration-200 hover:border-slate-700">
              <div className="flex flex-col items-center text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-900 text-sky-400 border border-slate-800">
                  {logoPreview ? (
                    <img
                      src={logoPreview}
                      alt="Brand logo preview"
                      className="h-9 w-9 object-contain"
                    />
                  ) : (
                    <ImageIcon className="h-7 w-7" />
                  )}
                </div>

                <h3 className="mt-4 text-base font-bold text-white">
                  Brand Logo
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  Primary logo displayed on your storefront header, checkout, and email notifications.
                </p>

                {logoFileName && (
                  <span className="mt-2 inline-block max-w-[220px] truncate rounded-full bg-slate-800 px-3 py-1 text-[0.7rem] text-slate-300">
                    {logoFileName}
                  </span>
                )}
              </div>

              <div className="mt-6 flex flex-col items-center gap-2">
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  onChange={handleLogoSelect}
                  className="hidden"
                  aria-label="Upload brand logo file"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => logoInputRef.current?.click()}
                  className="w-full border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 hover:text-white"
                >
                  <Upload className="mr-2 h-4 w-4 text-sky-400" />
                  <span>{logoPreview ? "Change Logo" : "Upload Logo"}</span>
                </Button>
                <span className="text-[0.68rem] text-slate-500">
                  PNG, SVG, or WEBP. 400x120px max 2MB.
                </span>
              </div>
            </div>

            {/* Favicon Upload Zone */}
            <div className="flex flex-col justify-between rounded-2xl border-2 border-dashed border-slate-800 bg-slate-950/60 p-6 transition-all duration-200 hover:border-slate-700">
              <div className="flex flex-col items-center text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-900 text-emerald-400 border border-slate-800">
                  {faviconPreview ? (
                    <img
                      src={faviconPreview}
                      alt="Favicon preview"
                      className="h-7 w-7 object-contain"
                    />
                  ) : (
                    <Globe className="h-7 w-7" />
                  )}
                </div>

                <h3 className="mt-4 text-base font-bold text-white">
                  Favicon
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  Small square icon shown in browser tabs, favorites bars, and mobile bookmark icons.
                </p>

                {faviconFileName && (
                  <span className="mt-2 inline-block max-w-[220px] truncate rounded-full bg-slate-800 px-3 py-1 text-[0.7rem] text-slate-300">
                    {faviconFileName}
                  </span>
                )}
              </div>

              <div className="mt-6 flex flex-col items-center gap-2">
                <input
                  ref={faviconInputRef}
                  type="file"
                  accept="image/x-icon,image/png,image/svg+xml"
                  onChange={handleFaviconSelect}
                  className="hidden"
                  aria-label="Upload favicon file"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => faviconInputRef.current?.click()}
                  className="w-full border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 hover:text-white"
                >
                  <Upload className="mr-2 h-4 w-4 text-emerald-400" />
                  <span>{faviconPreview ? "Change Favicon" : "Upload Favicon"}</span>
                </Button>
                <span className="text-[0.68rem] text-slate-500">
                  ICO, PNG, or SVG. Square ratio max 512KB.
                </span>
              </div>
            </div>
          </div>
        </motion.section>

        {/* Feedback Messages */}
        <AnimatePresence>
          {saveStatus === "success" && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-300"
            >
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
              <span>
                Branding settings and color palette saved successfully.
              </span>
            </motion.div>
          )}

          {saveStatus === "error" && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300"
            >
              <AlertCircle className="h-5 w-5 shrink-0 text-red-400" />
              <span>{errorMessage}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bottom Bar: Save Branding Button */}
        <div className="flex justify-end pt-2">
          <Button
            type="submit"
            disabled={isSaving}
            className="h-11 w-full min-w-[170px] bg-sky-600 px-6 font-semibold text-white shadow-lg shadow-sky-600/20 transition-all hover:bg-sky-500 active:scale-[0.98] sm:w-auto"
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                <span>Saving Branding...</span>
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4 text-sky-200" />
                <span>Save Branding</span>
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default Branding;
