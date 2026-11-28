import { FC, useEffect, useState } from "react";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { BILLING_TABS, findSettingsLocation, visibleSettingsNav } from "@/data/settingsNav";

/**
 * Settings content frame. Navigation lives in the app sidebar's Settings mode
 * (see components/layout/SettingsNav), so this layout is only the content
 * column: no second sidebar.
 */
const SettingsLayout: FC = () => {
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const { item } = findSettingsLocation(location.pathname);
  const showBillingTabs = item?.id === "billing";

  return (
    <div className="mx-auto w-full max-w-4xl pb-16">
      {showBillingTabs ? <BillingTabs pathname={location.pathname} /> : null}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={location.pathname}
          initial={reduceMotion ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <Outlet />
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

/** One "Billing" menu entry; its four existing pages become tabs. */
function BillingTabs({ pathname }: { pathname: string }) {
  return (
    <nav aria-label="Billing" className="-mx-1 mb-6 overflow-x-auto border-b border-line">
      <ul className="flex min-w-max gap-1 px-1">
        {BILLING_TABS.map((tab) => {
          const active = pathname === tab.to || ("matches" in tab && tab.matches.some((alias) => pathname === alias));
          return (
            <li key={tab.to}>
              <Link
                to={tab.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative inline-flex h-10 items-center px-3 text-[13.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg rounded-t-md",
                  active ? "text-ink" : "text-ink-muted hover:text-ink",
                )}
              >
                {tab.label}
                {active ? <span aria-hidden="true" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand" /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const DESKTOP_QUERY = "(min-width: 768px)";

function useIsDesktop(): boolean {
  const getMatch = () => typeof window === "undefined" || typeof window.matchMedia !== "function" || window.matchMedia(DESKTOP_QUERY).matches;
  const [desktop, setDesktop] = useState(getMatch);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setDesktop(query.matches);
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);
  return desktop;
}

/**
 * `/dashboard/settings`: desktop goes straight to Profile (the sidebar already
 * lists everything). Phones get a grouped, tappable index instead, like iOS
 * Settings, so the menu isn't hidden behind the drawer.
 */
export const SettingsIndex: FC = () => {
  const desktop = useIsDesktop();
  const { user } = useAuth();
  if (desktop) return <Navigate to="profile" replace />;
  const groups = visibleSettingsNav(user?.role);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">Settings</h1>
        <p className="mt-1 text-[13.5px] text-ink-muted">Your account and this workspace.</p>
      </div>
      {groups.map((group) => (
        <section key={group.id} aria-labelledby={group.label ? `settings-index-${group.id}` : undefined}>
          {group.label ? (
            <h2 id={`settings-index-${group.id}`} className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">{group.label}</h2>
          ) : null}
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
            {group.items.map((entry) => {
              const Icon = entry.icon;
              const danger = entry.tone === "danger";
              return (
                <li key={entry.id}>
                  <Link to={entry.to} className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none">
                    <Icon aria-hidden="true" strokeWidth={1.8} className={cn("h-[18px] w-[18px] shrink-0", danger ? "text-danger" : "text-ink-muted")} />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-[14px] font-medium", danger ? "text-danger" : "text-ink")}>{entry.label}</span>
                      <span className="mt-0.5 block truncate text-[12.5px] text-ink-muted">{entry.description}</span>
                    </span>
                    <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-faint" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
};

export default SettingsLayout;
