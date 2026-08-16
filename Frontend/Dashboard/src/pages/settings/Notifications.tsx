import { FC, useState, useEffect, type FormEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/api";
import {
  Bell,
  Mail,
  Smartphone,
  ShieldAlert,
  Users,
  CreditCard,
  BarChart3,
  CheckCircle2,
  Loader2,
  Sparkles,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface NotificationItem {
  id: string;
  categoryGroup: string;
  categoryGroupIcon: JSX.Element;
  title: string;
  description: string;
  isEssential?: boolean;
}

const NOTIFICATION_ITEMS: NotificationItem[] = [
  // Security & Authentication
  {
    id: "security-alerts",
    categoryGroup: "Security & Authentication",
    categoryGroupIcon: <ShieldAlert className="h-4 w-4 text-red-400" />,
    title: "Security Alerts",
    description:
      "Suspicious login attempts, unrecognized device sign-ins, and password changes.",
    isEssential: true,
  },
  {
    id: "api-expiration",
    categoryGroup: "Security & Authentication",
    categoryGroupIcon: <ShieldAlert className="h-4 w-4 text-red-400" />,
    title: "API & Token Expiration",
    description:
      "Warnings when API keys, webhook signing secrets, or tokens are nearing expiration.",
    isEssential: true,
  },

  // Team & Workspace
  {
    id: "new-team-members",
    categoryGroup: "Team & Workspace",
    categoryGroupIcon: <Users className="h-4 w-4 text-sky-400" />,
    title: "New Team Members",
    description:
      "Notifications when a staff member accepts an invitation or leaves your workspace.",
    isEssential: false,
  },
  {
    id: "role-permission-updates",
    categoryGroup: "Team & Workspace",
    categoryGroupIcon: <Users className="h-4 w-4 text-sky-400" />,
    title: "Role Permission Updates",
    description:
      "Alerts when your workspace access tier or administrative privileges are modified.",
    isEssential: false,
  },

  // Billing & Subscription
  {
    id: "invoice-receipts",
    categoryGroup: "Billing & Subscription",
    categoryGroupIcon: <CreditCard className="h-4 w-4 text-emerald-400" />,
    title: "Invoice & Payment Receipts",
    description:
      "Monthly invoice emails, successful charge receipts, and upcoming renewal notices.",
    isEssential: true,
  },
  {
    id: "usage-limits",
    categoryGroup: "Billing & Subscription",
    categoryGroupIcon: <CreditCard className="h-4 w-4 text-emerald-400" />,
    title: "Usage & Limit Thresholds",
    description:
      "Alerts when your workspace approaches plan volume or API rate limit thresholds.",
    isEssential: true,
  },

  // Analytics & Reports
  {
    id: "weekly-reports",
    categoryGroup: "Analytics & Reports",
    categoryGroupIcon: <BarChart3 className="h-4 w-4 text-amber-400" />,
    title: "Weekly Performance Reports",
    description:
      "Automated weekly digest of storefront revenue, conversion rate, and traffic trends.",
    isEssential: false,
  },
  {
    id: "cart-recovery-digest",
    categoryGroup: "Analytics & Reports",
    categoryGroupIcon: <BarChart3 className="h-4 w-4 text-amber-400" />,
    title: "Daily Cart Recovery Digest",
    description:
      "Daily summary of recovered checkout carts and automated email revenue performance.",
    isEssential: false,
  },
];

interface ToggleSwitchProps {
  checked: boolean;
  onToggle: () => void;
  label: string;
}

const IOSDarkToggle: FC<ToggleSwitchProps> = ({ checked, onToggle, label }) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${
        checked
          ? "bg-sky-500 shadow-inner shadow-sky-400/30"
          : "bg-slate-800 border border-slate-700"
      }`}
    >
      <motion.span
        layout
        transition={{
          type: "spring",
          stiffness: 500,
          damping: 30,
        }}
        className={`inline-block h-4 w-4 rounded-full bg-white shadow-md ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
};

export const Notifications: FC = () => {
  // Initialize state with sensible defaults
  const [emailPreferences, setEmailPreferences] = useState<
    Record<string, boolean>
  >({
    "security-alerts": true,
    "api-expiration": true,
    "new-team-members": true,
    "role-permission-updates": false,
    "invoice-receipts": true,
    "usage-limits": true,
    "weekly-reports": true,
    "cart-recovery-digest": false,
  });

  const [inAppPreferences, setInAppPreferences] = useState<
    Record<string, boolean>
  >({
    "security-alerts": true,
    "api-expiration": true,
    "new-team-members": true,
    "role-permission-updates": true,
    "invoice-receipts": true,
    "usage-limits": true,
    "weekly-reports": true,
    "cart-recovery-digest": true,
  });

  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [savedSuccessfully, setSavedSuccessfully] = useState<boolean>(false);

    useEffect(() => {
    const fetchPreferences = async () => {
      try {
        const res = await api.get("/settings/notifications");
        
        const prefsData = res.data?.data || res.data;

        if (prefsData) {
          if (prefsData.emailPreferences) setEmailPreferences(prefsData.emailPreferences);
          if (prefsData.inAppPreferences) setInAppPreferences(prefsData.inAppPreferences);
        }
      } catch (err) {
        console.error("Failed to fetch notification preferences:", err);
      }
    };

    fetchPreferences();
  }, []);
  
  const toggleEmail = (id: string) => {
    setEmailPreferences((prev) => ({ ...prev, [id]: !prev[id] }));
    setSavedSuccessfully(false);
  };

  const toggleInApp = (id: string) => {
    setInAppPreferences((prev) => ({ ...prev, [id]: !prev[id] }));
    setSavedSuccessfully(false);
  };

  const handleEnableAll = () => {
    const allOn: Record<string, boolean> = {};
    NOTIFICATION_ITEMS.forEach((item) => {
      allOn[item.id] = true;
    });
    setEmailPreferences(allOn);
    setInAppPreferences(allOn);
    setSavedSuccessfully(false);
  };

  const handleMuteNonEssential = () => {
    const updatedEmail: Record<string, boolean> = {};
    const updatedInApp: Record<string, boolean> = {};
    NOTIFICATION_ITEMS.forEach((item) => {
      updatedEmail[item.id] = Boolean(item.isEssential);
      updatedInApp[item.id] = Boolean(item.isEssential);
    });
    setEmailPreferences(updatedEmail);
    setInAppPreferences(updatedInApp);
    setSavedSuccessfully(false);
  };

    const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSavedSuccessfully(false);

    try {
      await api.put("/settings/notifications", {
        emailPreferences,
        inAppPreferences
      });
      setSavedSuccessfully(true);
    } catch (err) {
      console.error("Failed to save notification preferences:", err);
    } finally {
      setIsSaving(false);
    }
  };

  // Group items by categoryGroup for clean visual organization
  const groupedCategories = NOTIFICATION_ITEMS.reduce<
    Record<string, { icon: JSX.Element; items: NotificationItem[] }>
  >((acc, item) => {
    if (!acc[item.categoryGroup]) {
      acc[item.categoryGroup] = {
        icon: item.categoryGroupIcon,
        items: [],
      };
    }
    acc[item.categoryGroup].items.push(item);
    return acc;
  }, {});

  return (
    <div className="w-full max-w-5xl space-y-8 rounded-2xl bg-slate-950 p-6 text-slate-100 shadow-2xl sm:p-8 md:p-10">
      {/* Page Header */}
      <div className="flex flex-col justify-between gap-4 border-b border-slate-800 pb-6 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-500/10 text-sky-400 ring-1 ring-sky-500/20">
            <Bell className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Notification Preferences
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Control which email alerts and in-app notifications you receive across workspace events.
            </p>
          </div>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleMuteNonEssential}
            disabled={isSaving}
            className="border-slate-700 bg-slate-900/80 text-xs text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <VolumeX className="mr-1.5 h-3.5 w-3.5 text-slate-400" />
            <span>Mute Non-Essential</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleEnableAll}
            disabled={isSaving}
            className="border-slate-700 bg-slate-900/80 text-xs text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <Volume2 className="mr-1.5 h-3.5 w-3.5 text-sky-400" />
            <span>Enable All</span>
          </Button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {Object.entries(groupedCategories).map(
          ([groupTitle, { icon, items }], groupIdx) => (
            <motion.section
              key={groupTitle}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: groupIdx * 0.08 }}
              className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/50 shadow-xl transition-all duration-300 hover:border-slate-700/80"
            >
              {/* Category Group Header */}
              <div className="flex items-center justify-between border-b border-slate-800/80 bg-slate-950/60 px-6 py-4">
                <div className="flex items-center gap-2.5">
                  {icon}
                  <h2 className="text-base font-bold text-white">
                    {groupTitle}
                  </h2>
                </div>

                {/* Column Headers for Email & In-App */}
                <div className="flex items-center gap-8 text-xs font-semibold uppercase tracking-wider text-slate-400 sm:gap-12">
                  <div className="flex items-center gap-1.5 min-w-[50px] justify-center">
                    <Mail className="h-3.5 w-3.5 text-sky-400" />
                    <span>Email</span>
                  </div>
                  <div className="flex items-center gap-1.5 min-w-[54px] justify-center">
                    <Smartphone className="h-3.5 w-3.5 text-emerald-400" />
                    <span>In-App</span>
                  </div>
                </div>
              </div>

              {/* Rows inside Category Group */}
              <div className="divide-y divide-slate-800/80">
                {items.map((item) => {
                  const emailOn = Boolean(emailPreferences[item.id]);
                  const inAppOn = Boolean(inAppPreferences[item.id]);

                  return (
                    <div
                      key={item.id}
                      className="flex flex-col justify-between gap-4 px-6 py-4 transition-colors hover:bg-slate-800/40 sm:flex-row sm:items-center"
                    >
                      {/* Title & Description */}
                      <div className="max-w-xl space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-white">
                            {item.title}
                          </span>
                          {item.isEssential && (
                            <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[0.65rem] font-medium text-red-400 border border-red-500/20">
                              Essential
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400">
                          {item.description}
                        </p>
                      </div>

                      {/* Toggles (Email & In-App Columns) */}
                      <div className="flex items-center gap-8 self-end sm:gap-12 sm:self-center">
                        {/* Email Column Toggle */}
                        <div className="flex min-w-[50px] justify-center">
                          <IOSDarkToggle
                            checked={emailOn}
                            onToggle={() => toggleEmail(item.id)}
                            label={`Toggle email notifications for ${item.title}`}
                          />
                        </div>

                        {/* In-App Column Toggle */}
                        <div className="flex min-w-[54px] justify-center">
                          <IOSDarkToggle
                            checked={inAppOn}
                            onToggle={() => toggleInApp(item.id)}
                            label={`Toggle in-app notifications for ${item.title}`}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.section>
          )
        )}

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
                Your notification preferences have been updated successfully.
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bottom Bar: Save Button */}
        <div className="flex justify-end pt-2">
          <Button
            type="submit"
            disabled={isSaving}
            className="h-11 w-full min-w-[210px] bg-sky-600 px-6 font-semibold text-white shadow-lg shadow-sky-600/20 transition-all hover:bg-sky-500 active:scale-[0.98] sm:w-auto"
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                <span>Saving Preferences...</span>
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4 text-sky-200" />
                <span>Save Notification Preferences</span>
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default Notifications;
