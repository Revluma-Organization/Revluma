import { FC, useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Laptop,
  Smartphone,
  Tablet,
  LogOut,
  MapPin,
  Globe,
  Clock,
  CheckCircle2,
  AlertTriangle,
  X,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";

export interface DeviceSession {
  id: string;
  device: string;
  browser: string;
  os: string;
  location: string;
  ipAddress: string;
  lastActive: string;
  current: boolean;
  deviceType: "laptop" | "phone" | "tablet";
}


export const ActiveSessions: FC = () => {
  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.get<DeviceSession[]>("/auth/sessions", undefined, {
        skipAuthRedirect: true,
      });
      const active = res.data?.data?.sessions;
      if (active && Array.isArray(active)) {
        setSessions(active);
      } else {
        setSessions([]);
      }
    } catch (err) {
      console.warn("Failed to fetch sessions from API:", err);
      setSessions([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

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

  const handleRevokeSession = async (id: string, deviceName: string) => {
    try {
      await api.delete(`/auth/sessions/${id}`, { skipAuthRedirect: true });
      setSessions((prev) => prev.filter((sess) => sess.id !== id));
      setFeedbackMessage(`Revoked access for "${deviceName}" successfully.`);
    } catch (err) {
      console.error("Failed API delete session:", err);
    }
  };

  const handleLogOutOfAllOthers = async () => {
    try {
      await api.delete("/auth/sessions/others", { skipAuthRedirect: true });
      const onlyCurrent = sessions.filter((sess) => sess.current);
      const removedCount = sessions.length - onlyCurrent.length;
      setSessions(onlyCurrent);
      setFeedbackMessage(
        `Logged out of ${removedCount} other device session${
          removedCount === 1 ? "" : "s"
        }. Only this device remains active.`
      );
    } catch (err) {
      console.error("Failed API delete other sessions:", err);
    }
  };

  const otherSessionsCount = sessions.filter((sess) => !sess.current).length;

  return (
    <div className="w-full max-w-5xl space-y-8 text-slate-900 dark:text-slate-100">
      {/* Page Header */}
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 dark:border-slate-800 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
            Active Sessions
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Manage signed-in devices across your Revluma workspace account and revoke suspicious logins.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={fetchSessions}
            disabled={isLoading}
            className="border-slate-300 bg-white text-xs text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white sm:text-sm"
          >
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={handleLogOutOfAllOthers}
            disabled={isLoading || otherSessionsCount === 0}
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
            className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-800 dark:text-emerald-200"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              <span>{feedbackMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setFeedbackMessage(null)}
              className="rounded p-1 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              aria-label="Dismiss notification"
            >
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Security Tip Banner */}
      <div className="flex items-start gap-3 rounded-xl border border-sky-500/20 bg-sky-500/5 p-4 text-xs text-slate-700 dark:text-slate-300 sm:text-sm">
        <AlertTriangle className="h-5 w-5 shrink-0 text-sky-400 mt-0.5" />
        <p className="leading-relaxed">
          If you spot a device or location you do not recognize, revoke its session immediately and update your workspace account password.
        </p>
      </div>

      {/* Sessions List or Loading Spinner */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white sm:text-xl">
            Signed-in Devices ({sessions.length})
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-500">
            Current session highlighted in emerald
          </span>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-slate-100/40 py-16 dark:border-slate-800 dark:bg-slate-900/40">
            <Loader2 className="h-8 w-8 animate-spin text-sky-400" />
            <p className="mt-3 text-sm font-medium text-slate-500 dark:text-slate-400">
              Fetching active device sessions...
            </p>
          </div>
        ) : (
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
                    session.current
                      ? "border-emerald-500/40 bg-white shadow-emerald-500/5 dark:bg-slate-900/80"
                      : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/50 dark:hover:border-slate-700/80"
                  }`}
                >
                  {/* Left Device Info */}
                  <div className="flex items-start gap-4 sm:items-center">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-950">
                      {getDeviceIcon(session.device)}
                    </div>

                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-slate-900 dark:text-white">
                          {session.device}
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          — {session.browser} ({session.os})
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
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
                    {session.current ? (
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
                          handleRevokeSession(session.id, session.device)
                        }
                        className="border-slate-300 bg-white text-xs font-semibold text-slate-700 transition-colors hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-red-500/30 dark:hover:bg-red-500/10 dark:hover:text-red-300"
                      >
                        <span>Revoke</span>
                      </Button>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Empty state if no extra devices are found */}
            {(sessions.length === 0 || otherSessionsCount === 0) && (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-100/50 p-8 text-center dark:border-slate-800 dark:bg-slate-900/30">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  No other active device sessions found.
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-500">
                  You are only logged in on this current device.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ActiveSessions;
