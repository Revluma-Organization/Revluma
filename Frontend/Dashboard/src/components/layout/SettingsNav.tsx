import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { isSettingsItemActive, readLastAppRoute, visibleSettingsNav } from "@/data/settingsNav";
import { side } from "./sidebarTokens";

/**
 * The app sidebar's Settings mode (the Linear "Back to app" pattern). It
 * replaces the workspace links in the same rail, so Settings never shows two
 * sidebars side by side. The brand row and account card around it stay put.
 */
export function SettingsNav({ pathname, role, onNavigate }: { pathname: string; role?: string | null; onNavigate?: () => void }) {
  const [query, setQuery] = useState("");
  const backTo = useMemo(readLastAppRoute, []);
  const groups = visibleSettingsNav(role, query);
  const hasLabelledGroup = groups.some((group) => group.label);
  const navRef = useRef<HTMLElement | null>(null);

  // On short windows the list scrolls; keep the current page visible.
  useEffect(() => {
    const current = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    current?.scrollIntoView?.({ block: "nearest" });
  }, [pathname]);

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && query) {
      // Clear first; a second Escape closes the mobile drawer as usual.
      event.stopPropagation();
      setQuery("");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="settings-nav">
      <div className="shrink-0 px-3 pb-3 pt-1">
        <Link
          to={backTo}
          onClick={onNavigate}
          className={cn("group inline-flex min-h-9 items-center gap-2 rounded-full pl-2.5 pr-3.5 text-[13px] font-medium transition-colors duration-200", side.muted, side.rowHover, side.focus)}
        >
          <ArrowLeft className="h-4 w-4 transition-transform duration-200 group-hover:-translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
          Back to dashboard
        </Link>
        <h2 className={cn("mt-3 px-3 text-[18px] font-semibold leading-6 tracking-[-0.02em]", side.text)}>Settings</h2>
        <div className="relative mt-3">
          <Search className={cn("pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2", side.faint)} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder="Search settings"
            aria-label="Search settings"
            autoComplete="off"
            spellCheck={false}
            className={side.input}
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className={cn("absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full", side.muted, side.rowHover, side.focus)}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      <nav ref={navRef} aria-label="Settings" className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {groups.length === 0 ? (
          <p role="status" className={cn("px-3 py-6 text-center text-[13px]", side.muted)}>
            No settings match “{query.trim()}”.
          </p>
        ) : (
          groups.map((group) => (
            <div
              key={group.id}
              className={cn("mb-4 last:mb-0", !group.label && hasLabelledGroup && cn("border-t pt-3", side.divider))}
            >
              {group.label ? (
                <p id={`settings-group-${group.id}`} className={cn("mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.14em]", side.faint)}>
                  {group.label}
                </p>
              ) : null}
              <ul className="space-y-0.5" aria-labelledby={group.label ? `settings-group-${group.id}` : undefined}>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = isSettingsItemActive(item, pathname);
                  const danger = item.tone === "danger";
                  return (
                    <li key={item.id}>
                      <Link
                        to={item.to}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "group flex min-h-10 items-center gap-3 rounded-full px-3 text-[13.5px] font-medium tracking-[-0.005em] transition-[background-color,color,box-shadow] duration-200 motion-reduce:transition-none",
                          side.focus,
                          active ? (danger ? side.dangerActive : side.active) : (danger ? side.danger : side.item),
                        )}
                      >
                        <Icon
                          aria-hidden="true"
                          strokeWidth={1.8}
                          className={cn("h-4 w-4 shrink-0", active || danger ? "text-current" : side.icon)}
                        />
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </nav>
    </div>
  );
}
