import { FC, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Laptop,
  Smartphone,
  Tablet,
  Shield,
  LogOut,
  MapPin,
  Globe,
  Clock,
  CheckCircle2,
  AlertTriangle,
  X,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface DeviceSession {
  id: string;
  deviceName: string;
  browser: string;
  os: string;
  location: string;
  ipAddress: string;
  lastActive: string;
  isCurrent: boolean;
  deviceType: "laptop" | "phone" | "tablet";
}

const INITIAL_SESSIONS: DeviceSession[] = [
  {
    id: "sess-current",
    deviceName: "MacBook Pro (16-inch)",
    browser: "Chrome 126.0",
    os: "macOS Sonoma",
    location: "Lagos, Nigeria",
    ipAddress: "102.89.23.114",
    lastActive: "Active Now",
    isCurrent: true,
    deviceType: "laptop",
  },
  {
    id: "sess-2",
    deviceName: "iPhone 15 Pro Max",
    browser: "Safari Mobile",
    os: "iOS 17.5",
    location: "Lagos, Nigeria",
    ipAddress: "102.89.41.209",
    lastActive: "2 hours ago",
    isCurrent: false,
    deviceType: "phone",
  },
  {
    id: "sess-3",
    deviceName: "Windows Workstation",
    browser: "Microsoft Edge 125.0",
    os: "Windows 11 Pro",
    location: "London, United Kingdom",
    ipAddress: "82.165.197.12",
    lastActive: "Yesterday at 4:15 PM",
    isCurrent: false,
    deviceType: "laptop",
  },
  {
    id: "sess-4",
    deviceName: "iPad Pro (12.9-inch)",
    browser: "Safari Mobile",
    os: "iPadOS 17.4",
    location: "Abuja, Nigeria",
    ipAddress: "197.210.64.88",
    lastActive: "Jul 22, 2026",
    isCurrent: false,
    deviceType: "tablet",
  },
];

export const ActiveSessions: FC = () => {
  const [sessions, setSessions] = useState<DeviceSession[]>(INITIAL_SESSIONS);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const getDeviceIcon = (type: DeviceSession["deviceType"]) => {
    switch (type) {
      case "laptop":
        return <Laptop className="h-6 w-6 text-sky-400" />;
      case "phone":
        return <Smartphone className="h-6 w-6 text-emerald-400" />;
      case "tablet":
        return <Tablet className="h-6 w-6 text-amber-400" />;
      default:
        return <Laptop className="h-6 w-6 text-sky-400" />;
    }
  };

  const handleRevokeSession = (id: string, deviceName: string) => {
    setSessions((prev) => prev.filter((sess) => sess.id !== id));
    setFeedbackMessage(`Revoked access for "${deviceName}" successfully.`);
  };

  const handleLogOutOfAllOthers = () => {
    const onlyCurrent = sessions.filter((sess) => sess.isCurrent);
    const removedCount = sessions.length - onlyCurrent.length;
    setSessions(onlyCurrent);
    setFeedbackMessage(
      `Logged out of ${removedCount} other device session${
        removedCount === 1 ? "" : "s"
      }. Only this device remains active.`
    );
  };

  const handleResetDemoSessions = () => {
    setSessions(INITIAL_SESSIONS);
    setFeedbackMessage("Restored demo device sessions.");
  };

  const otherSessionsCount = sessions.filter((sess) => !sess.isCurrent).length;

  return (
    <div className="w-full max-w-5xl space-y-8 rounded-2xl bg-slate-950 p-6 text-slate-100 shadow-2xl sm:p-8 md:p-10">
      {/* Page Header */}
      <div className="flex flex-col justify-between gap-4 border-b border-slate-800 pb-6 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-500/10 text-sky-400 ring-1 ring-sky-500/20">
            <Shield className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Active Sessions
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Review active login sessions across your devices and revoke unrecognized access immediately.
            </p>
          </div>
        </div>

        {/* Global Action: Log out of all other devices */}
        <div className="flex items-center gap-2">
          {otherSessionsCount === 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleResetDemoSessions}
              className="border-slate-700 bg-slate-900/80 text-xs text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              <span>Reset Demo Sessions</span>
            </Button>
          )}

          <Button
            type="button"
            variant="outline"
            onClick={handleLogOutOfAllOthers}
            disabled={otherSessionsCount === 0}
            className="border-red-500/30 bg-red-500/10 text-xs font-semibold text-red-300 hover:bg-red-500/20 hover:text-red-200 disabled:opacity-40 sm:text-sm"
          >
            <LogOut className="mr-2 h-4 w-4" />
            <span>Log out of all other devices</span>
          </Button>
        </div>
      </div>

      {/* Inline Feedback Toast */}
      <AnimatePresence>
        {feedbackMessage && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              <span>{feedbackMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setFeedbackMessage(null)}
              className="rounded p-1 text-slate-400 hover:text-white"
              aria-label="Dismiss notification"
            >
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Security Tip Banner */}
      <div className="flex items-start gap-3 rounded-xl border border-sky-500/20 bg-sky-500/5 p-4 text-xs text-slate-300 sm:text-sm">
        <AlertTriangle className="h-5 w-5 shrink-0 text-sky-400 mt-0.5" />
        <p className="leading-relaxed">
          If you spot a device or location you do not recognize, revoke its session immediately and update your workspace account password.
        </p>
      </div>

      {/* Sessions List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white sm:text-xl">
            Signed-in Devices ({sessions.length})
          </h2>
          <span className="text-xs text-slate-500">
            Current session highlighted in emerald
          </span>
        </div>

        <div className="space-y-4">
          <AnimatePresence initial={false}>
            {sessions.map((session) => (
              <motion.div
                key={session.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0, scale: 0.96 }}
                transition={{ duration: 0.25 }}
                className={`flex flex-col justify-between gap-4 rounded-2xl border p-5 shadow-xl transition-all duration-300 sm:flex-row sm:items-center ${
                  session.isCurrent
                    ? "border-emerald-500/40 bg-slate-900/80 shadow-emerald-500/5"
                    : "border-slate-800 bg-slate-900/50 hover:border-slate-700/80"
                }`}
              >
                {/* Left Device Info */}
                <div className="flex items-start gap-4 sm:items-center">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-slate-950">
                    {getDeviceIcon(session.deviceType)}
                  </div>

                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-white">
                        {session.deviceName}
                      </span>
                      <span className="text-xs text-slate-400">
                        — {session.browser} ({session.os})
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5 text-slate-500" />
                        <span>{session.location}</span>
                      </span>

                      <span className="inline-flex items-center gap-1">
                        <Globe className="h-3.5 w-3.5 text-slate-500" />
                        <span className="font-mono text-[0.7rem]">
                          {session.ipAddress}
                        </span>
                      </span>

                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5 text-slate-500" />
                        <span>{session.lastActive}</span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right Actions / Status Badge */}
                <div className="flex items-center justify-end gap-3 self-end sm:self-center">
                  {session.isCurrent ? (
                    <Badge
                      variant="outline"
                      className="inline-flex items-center gap-1.5 rounded-full border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300"
                    >
                      <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span>Active Now (Current Session)</span>
                    </Badge>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        handleRevokeSession(session.id, session.deviceName)
                      }
                      className="border-slate-700 bg-slate-950 text-xs font-semibold text-slate-300 transition-colors hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-300"
                    >
                      <span>Revoke</span>
                    </Button>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

export default ActiveSessions;
