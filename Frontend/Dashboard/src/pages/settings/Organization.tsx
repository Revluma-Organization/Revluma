import {
  FC,
  useState,
  useRef,
  type FormEvent,
  type ChangeEvent,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Building2,
  Upload,
  Globe,
  Loader2,
  CheckCircle2,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Organization: FC = () => {
  const [orgName, setOrgName] = useState<string>("Revluma Inc.");
  const [slug, setSlug] = useState<string>("revluma-inc");
  const [industry, setIndustry] = useState<string>("ecommerce");
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">(
    "idle"
  );
  const [errorMessage, setErrorMessage] = useState<string>("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        setSaveStatus("error");
        setErrorMessage("Logo image file size must be under 2MB.");
        return;
      }
      const url = URL.createObjectURL(file);
      setLogoPreview(url);
      setSaveStatus("idle");
    }
  };

  const handleSlugChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .replace(/--+/g, "-");
    setSlug(value);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!orgName.trim() || !slug.trim()) {
      setSaveStatus("error");
      setErrorMessage("Organization name and slug are required.");
      return;
    }

    setIsSaving(true);
    setSaveStatus("idle");

    setTimeout(() => {
      setIsSaving(false);
      setSaveStatus("success");
    }, 1000);
  };

  return (
    <div className="w-full max-w-4xl space-y-8 text-slate-100">
      {/* Header section */}
      <div className="border-b border-slate-800 pb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-500/10 text-sky-400 ring-1 ring-sky-500/20">
            <Building2 className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Organization
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Manage your core workspace identity, logo, and public URL slug.
            </p>
          </div>
        </div>
      </div>

      {/* Main Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Section 1: Workspace Logo Card */}
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 shadow-xl transition-all duration-300 hover:border-slate-700/80 sm:p-8"
        >
          <div className="space-y-2">
            <h2 className="text-lg font-semibold text-white sm:text-xl">
              Workspace Logo
            </h2>
            <p className="text-sm text-slate-400">
              This logo will be displayed across dashboard reports, customer communications, and member invites.
            </p>
          </div>

          <div className="mt-6 flex flex-col items-center gap-6 sm:flex-row sm:items-start">
            <Avatar className="h-20 w-20 border border-slate-700 bg-slate-950 shadow-md sm:h-24 sm:w-24">
              {logoPreview ? (
                <AvatarImage
                  src={logoPreview}
                  alt="Workspace logo preview"
                  className="object-cover"
                />
              ) : null}
              <AvatarFallback className="bg-slate-900 text-slate-400">
                <Building2 className="h-8 w-8 text-sky-400" />
              </AvatarFallback>
            </Avatar>

            <div className="flex flex-col items-center space-y-3 sm:items-start">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml"
                onChange={handleFileChange}
                className="hidden"
                aria-label="Upload logo image file"
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleUploadClick}
                className="flex items-center gap-2 border-slate-700 bg-slate-950/80 px-4 text-slate-200 hover:bg-slate-800 hover:text-white"
              >
                <Upload className="h-4 w-4 text-sky-400" />
                <span>Upload Image</span>
              </Button>
              <p className="text-center text-xs text-slate-500 sm:text-left">
                Recommended size: 400x400px. PNG, JPG, or SVG up to 2MB.
              </p>
            </div>
          </div>
        </motion.section>

        {/* Section 2: Workspace Details Card */}
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 shadow-xl transition-all duration-300 hover:border-slate-700/80 sm:p-8"
        >
          <div className="space-y-2">
            <h2 className="text-lg font-semibold text-white sm:text-xl">
              Workspace Details
            </h2>
            <p className="text-sm text-slate-400">
              Configure your organization name, URL slug, and industry classification.
            </p>
          </div>

          <div className="mt-6 space-y-6">
            {/* Organization Name Input */}
            <div className="space-y-2">
              <Label
                htmlFor="org-name"
                className="text-sm font-medium text-slate-300"
              >
                Organization Name
              </Label>
              <Input
                id="org-name"
                type="text"
                value={orgName}
                onChange={(e) => {
                  setOrgName(e.target.value);
                  setSaveStatus("idle");
                }}
                placeholder="e.g. Revluma Inc."
                required
                className="h-11 w-full border-slate-700 bg-slate-950/80 text-slate-100 placeholder:text-slate-500 focus-visible:border-sky-500 focus-visible:ring-1 focus-visible:ring-sky-500/30"
              />
            </div>

            {/* Workspace Slug Input with Prefix */}
            <div className="space-y-2">
              <Label
                htmlFor="org-slug"
                className="text-sm font-medium text-slate-300"
              >
                Workspace Slug
              </Label>
              <div className="flex h-11 w-full overflow-hidden rounded-lg border border-slate-700 bg-slate-950/80 transition-all focus-within:border-sky-500 focus-within:ring-1 focus-within:ring-sky-500/30">
                <span className="flex select-none items-center border-r border-slate-800 bg-slate-900/80 px-3 font-mono text-sm text-slate-400 sm:px-4">
                  revluma.com/
                </span>
                <input
                  id="org-slug"
                  type="text"
                  value={slug}
                  onChange={handleSlugChange}
                  placeholder="workspace-slug"
                  required
                  className="flex-1 bg-transparent px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none"
                />
              </div>
              <p className="text-xs text-slate-500">
                Only lowercase letters, numbers, and hyphens are allowed.
              </p>
            </div>

            {/* Industry / Category Dropdown */}
            <div className="space-y-2">
              <Label
                htmlFor="org-industry"
                className="text-sm font-medium text-slate-300"
              >
                Industry / Category
              </Label>
              <Select
                value={industry}
                onValueChange={(value) => {
                  setIndustry(value);
                  setSaveStatus("idle");
                }}
              >
                <SelectTrigger
                  id="org-industry"
                  className="h-11 w-full border-slate-700 bg-slate-950/80 text-slate-100 focus:border-sky-500 focus:ring-1 focus:ring-sky-500/30"
                >
                  <SelectValue placeholder="Select an industry category" />
                </SelectTrigger>
                <SelectContent className="border-slate-800 bg-slate-950 text-slate-100">
                  <SelectItem value="ecommerce">E-commerce & Retail</SelectItem>
                  <SelectItem value="saas">SaaS & Technology</SelectItem>
                  <SelectItem value="fintech">Financial Services</SelectItem>
                  <SelectItem value="healthcare">Healthcare & Biotech</SelectItem>
                  <SelectItem value="edtech">Education & EdTech</SelectItem>
                  <SelectItem value="media">Media & Entertainment</SelectItem>
                  <SelectItem value="other">Other Industry</SelectItem>
                </SelectContent>
              </Select>
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
              <span>Organization settings have been saved successfully.</span>
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

        {/* Bottom Bar: Save Changes Button */}
        <div className="flex justify-end pt-2">
          <Button
            type="submit"
            disabled={isSaving}
            className="h-11 w-full min-w-[160px] bg-sky-600 px-6 font-medium text-white shadow-lg shadow-sky-600/20 transition-all hover:bg-sky-500 active:scale-[0.98] sm:w-auto"
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4 text-sky-200" />
                <span>Save Changes</span>
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default Organization;
