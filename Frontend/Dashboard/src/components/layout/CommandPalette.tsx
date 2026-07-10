import { Command as Cmdk } from "cmdk";
import { useUI } from "@/store/ui";
import { useThemeStore } from "@/store";
import { useAuth } from "@/context/AuthContext";
import { useCommandRegistry } from "@/store/commandRegistryStore";
import { useCommandPaletteHistory } from "@/store/commandPaletteHistoryStore";
import { buildStaticCommands } from "@/lib/commandPalette/staticCommands";
import { fetchStoreCommands } from "@/lib/commandPalette/dynamicDataSources";
import { scoreCommand } from "@/lib/commandPalette/fuzzy";
import { resolveDashboardRoute } from "@/lib/commandPalette/routes";
import { CATEGORY_LABEL, type CommandCategory, type PaletteCommand } from "@/lib/commandPalette/types";
import { useEffect, useMemo, useState, useCallback, Fragment } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search, Sparkles, Star, Clock, X, CornerDownLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";

const CATEGORY_ORDER: CommandCategory[] = ["recent", "pages", "actions", "integrations", "settings", "ai", "help"];
const MAX_PER_CATEGORY = 6;
const MAX_TOTAL_RESULTS = 40;
const DEBOUNCE_MS = 90;

interface RankedCommand {
  cmd: PaletteCommand;
  titleIndices: number[];
}

/** Renders a title with matched characters bolded/accented for search highlighting. */
function HighlightedTitle({ title, indices }: { title: string; indices: number[] }) {
  if (!indices.length) return <>{title}</>;
  const idxSet = new Set(indices);
  return (
    <>
      {title.split("").map((ch, i) => (
        <Fragment key={i}>
          {idxSet.has(i) ? <span className="font-bold" style={{ color: "hsl(var(--accent))" }}>{ch}</span> : ch}
        </Fragment>
      ))}
    </>
  );
}

function RowSkeleton() {
  return (
    <div className="flex items-center gap-2.5 rounded-md px-2.5 py-2">
      <div className="h-4 w-4 shrink-0 animate-pulse rounded bg-white/[0.08]" />
      <div className="h-3 w-40 animate-pulse rounded bg-white/[0.08]" />
    </div>
  );
}

export function CommandPalette() {
  const { cmdOpen, setCmdOpen } = useUI();
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const { setNotifOpen, startTour, openCopilotWithQuery } = useUI();
  const { logout } = useAuth();
  const navigate = useNavigate();

  const dynamicCommandsMap = useCommandRegistry((s) => s.commands);
  const dynamicCommands = useMemo(() => Object.values(dynamicCommandsMap), [dynamicCommandsMap]);
  const { recentCommandIds, recentQueries, pinnedIds, usageCounts, recordCommandUse, recordQuery, togglePinned } =
    useCommandPaletteHistory();

  // Query state deliberately lives here and is NOT reset on close — the
  // component stays mounted (it just returns null), so this satisfies
  // "remember previous search when reopened within the same session."
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeValue, setActiveValue] = useState<string>("");
  const [storeCommands, setStoreCommands] = useState<PaletteCommand[]>([]);
  const [storeCommandsLoading, setStoreCommandsLoading] = useState(false);

  // Global open shortcuts: Cmd/Ctrl+K, and "/" when nothing is focused.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isTypingTarget =
        document.activeElement instanceof HTMLElement &&
        ["INPUT", "TEXTAREA"].includes(document.activeElement.tagName);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen(!cmdOpen);
      } else if (e.key === "/" && !isTypingTarget && !cmdOpen) {
        e.preventDefault();
        setCmdOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [cmdOpen, setCmdOpen]);

  // Debounce the query so scoring/rendering doesn't thrash on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  // Lazily fetch live store-connection data the first time the palette opens.
  useEffect(() => {
    if (!cmdOpen || storeCommands.length > 0) return;
    setStoreCommandsLoading(true);
    fetchStoreCommands()
      .then(setStoreCommands)
      .finally(() => setStoreCommandsLoading(false));
  }, [cmdOpen, storeCommands.length]);

  const close = useCallback(() => setCmdOpen(false), [setCmdOpen]);

  const allCommands = useMemo<PaletteCommand[]>(() => {
    const staticCmds = buildStaticCommands({ theme, toggleTheme, startTour, setNotifOpen, openCopilotWithQuery, openPalette: () => setCmdOpen(true), logout });
    // Dynamic (self-registered) commands take precedence over static ones with the same id,
    // so a page can override a built-in default when it wants a more specific action.
    const byId = new Map<string, PaletteCommand>();
    for (const c of [...staticCmds, ...storeCommands]) byId.set(c.id, c);
    for (const c of dynamicCommands) byId.set(c.id, c);
    return Array.from(byId.values());
  }, [theme, toggleTheme, startTour, setNotifOpen, openCopilotWithQuery, logout, storeCommands, dynamicCommands]);

  const commandById = useMemo(() => {
    const m = new Map<string, PaletteCommand>();
    for (const c of allCommands) m.set(c.id, c);
    return m;
  }, [allCommands]);

  // ---- Build the ranked / grouped result set ----
  const { groups, flatOrder, hasAnyResults } = useMemo(() => {
    const q = debouncedQuery.trim();
    const groupMap = new Map<CommandCategory, RankedCommand[]>();
    const order: string[] = [];

    const pushTo = (cat: CommandCategory, entry: RankedCommand) => {
      if (!groupMap.has(cat)) groupMap.set(cat, []);
      const arr = groupMap.get(cat)!;
      if (arr.length < MAX_PER_CATEGORY) arr.push(entry);
      order.push(entry.cmd.id);
    };

    if (!q) {
      // Default view: Recent first, then everything else in fixed category order.
      const recentResolved = recentCommandIds
        .map((id) => commandById.get(id))
        .filter((c): c is PaletteCommand => Boolean(c));
      for (const c of recentResolved) pushTo("recent", { cmd: c, titleIndices: [] });

      for (const cat of CATEGORY_ORDER) {
        if (cat === "recent") continue;
        for (const c of allCommands) {
          if (c.category !== cat) continue;
          pushTo(cat, { cmd: c, titleIndices: [] });
        }
      }
    } else {
      const scored = allCommands
        .map((c) => {
          const m = scoreCommand(q, c);
          if (!m) return null;
          let score = m.score;
          if (pinnedIds.includes(c.id)) score += 25;
          const recentIdx = recentCommandIds.indexOf(c.id);
          if (recentIdx !== -1) score += 15 - recentIdx * 1.5;
          score += Math.min(usageCounts[c.id] ?? 0, 10) * 1.2;
          return { cmd: c, titleIndices: m.titleIndices, score };
        })
        .filter((x): x is RankedCommand & { score: number } => Boolean(x))
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_TOTAL_RESULTS);

      for (const cat of CATEGORY_ORDER) {
        if (cat === "recent") continue;
        for (const entry of scored) {
          if (entry.cmd.category !== cat) continue;
          pushTo(cat, entry);
        }
      }
    }

    return { groups: groupMap, flatOrder: order, hasAnyResults: order.length > 0 };
  }, [debouncedQuery, allCommands, commandById, recentCommandIds, pinnedIds, usageCounts]);

  // Auto-highlight the first row whenever the result set changes.
  useEffect(() => {
    setActiveValue(flatOrder[0] ?? "");
  }, [flatOrder]);

  function runCommand(cmd: PaletteCommand) {
    if (debouncedQuery.trim()) recordQuery(debouncedQuery);
    if (!cmd.skipRecentTracking) recordCommandUse(cmd.id);

    const safeNavigate = (to: string | number, options?: { replace?: boolean; state?: unknown }) => {
      if (typeof to === "number") {
        navigate(to);
        return;
      }
      navigate(resolveDashboardRoute(to), options);
    };

    cmd.perform({ navigate: safeNavigate, close });
  }

  function handleAskAI() {
    const q = query.trim();
    recordQuery(q);
    openCopilotWithQuery(q);
    close();
  }

  // Cmd/Ctrl+Enter → toggle pin on the active row. Digit 1-9 (with modifier) → jump to nth visible result.
  function handleKeyDownCapture(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (activeValue) togglePinned(activeValue);
      return;
    }
    if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
      e.preventDefault();
      const idx = Number(e.key) - 1;
      const id = flatOrder[idx];
      const cmd = id ? commandById.get(id) : undefined;
      if (cmd) runCommand(cmd);
    }
  }

  if (!cmdOpen) return null;

  const trimmedQuery = query.trim();
  const orderedCategories = CATEGORY_ORDER.filter((cat) => (groups.get(cat)?.length ?? 0) > 0);
  let runningIndex = 0;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-sm"
      onClick={close}
      role="presentation"
    >
      <Cmdk
        className="flex w-full max-w-[640px] flex-col overflow-hidden rounded-2xl border border-border-md bg-bg-notif shadow-elegant"
        onClick={(e) => e.stopPropagation()}
        onKeyDownCapture={handleKeyDownCapture}
        loop
        shouldFilter={false}
        value={activeValue}
        onValueChange={setActiveValue}
        label="Command palette"
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-t3" />
          <Cmdk.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="Search pages, customers, actions… or ask a question"
            className="flex-1 bg-transparent text-sm text-t1 outline-none placeholder:text-t3"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-t4 transition-colors hover:text-t1"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <kbd className="shrink-0 rounded border border-border bg-bg-3 px-1.5 py-px text-[0.65rem] text-t3">esc</kbd>
        </div>

        {/* Recent query chips — only shown on the empty-query default view */}
        {!trimmedQuery && recentQueries.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2.5">
            <Clock className="h-3 w-3 text-t4" />
            {recentQueries.map((rq) => (
              <button
                key={rq}
                onClick={() => setQuery(rq)}
                className="rounded-full border border-border bg-white/[0.03] px-2.5 py-1 text-[0.7rem] text-t3 transition-colors hover:border-border-md hover:text-t1"
              >
                {rq}
              </button>
            ))}
          </div>
        )}

        <Cmdk.List className="max-h-[440px] overflow-y-auto p-2">
          {storeCommandsLoading && !trimmedQuery && (
            <div className="px-2 pb-1">
              <RowSkeleton />
              <RowSkeleton />
            </div>
          )}

          {!hasAnyResults && !storeCommandsLoading && (
            <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-full"
                style={{ background: "hsl(var(--accent) / 0.12)" }}
              >
                <Sparkles className="h-4 w-4" style={{ color: "hsl(var(--accent))" }} />
              </div>
              <p className="text-sm text-t2">No matches for "{trimmedQuery}"</p>
              {trimmedQuery && (
                <button
                  onClick={handleAskAI}
                  className="flex items-center gap-2 rounded-lg border px-3.5 py-2 text-[0.8rem] font-semibold transition-opacity hover:opacity-90"
                  style={{ background: "hsl(var(--accent) / 0.12)", borderColor: "hsl(var(--accent) / 0.28)", color: "hsl(var(--accent))" }}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Ask Revluma Copilot — "{trimmedQuery}"
                </button>
              )}
            </div>
          )}

          {orderedCategories.map((cat) => {
            const entries = groups.get(cat) ?? [];
            if (entries.length === 0) return null;
            return (
              <Cmdk.Group
                key={cat}
                heading={CATEGORY_LABEL[cat]}
                className="px-2 pb-1 text-[0.62rem] font-bold uppercase tracking-[0.11em] text-t4 [&_[cmdk-group-heading]]:px-1.5 [&_[cmdk-group-heading]]:py-2"
              >
                {entries.map(({ cmd, titleIndices }) => {
                  const Icon = cmd.icon;
                  const isPinned = pinnedIds.includes(cmd.id);
                  const shortcutNumber = ++runningIndex;
                  return (
                    <Cmdk.Item
                      key={cmd.id}
                      value={cmd.id}
                      onSelect={() => runCommand(cmd)}
                      className="group flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-t2 aria-selected:bg-white/[0.065] aria-selected:text-t1"
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">
                        <HighlightedTitle title={cmd.title} indices={titleIndices} />
                        {cmd.description && (
                          <span className="ml-2 truncate text-[0.72rem] text-t4">{cmd.description}</span>
                        )}
                      </span>
                      {isPinned && <Star className="h-3 w-3 shrink-0 fill-current" style={{ color: "hsl(var(--accent))" }} />}
                      {cmd.badge && (
                        <span className="shrink-0 rounded-full bg-white/[0.06] px-1.5 py-px text-[0.62rem] font-semibold text-t3">
                          {cmd.badge}
                        </span>
                      )}
                      {cmd.shortcut && <span className="shrink-0 text-[0.65rem] text-t4">{cmd.shortcut}</span>}
                      {shortcutNumber <= 9 && (
                        <kbd className="hidden shrink-0 rounded border border-border bg-bg-3 px-1 py-px text-[0.62rem] text-t4 opacity-0 transition-opacity group-aria-selected:opacity-100 sm:group-hover:opacity-100">
                          ⌘{shortcutNumber}
                        </kbd>
                      )}
                    </Cmdk.Item>
                  );
                })}
              </Cmdk.Group>
            );
          })}

          {/* AI fallback is always reachable, even with partial results, for open-ended questions */}
          {trimmedQuery && hasAnyResults && (
            <Cmdk.Group
              heading={CATEGORY_LABEL.ai}
              className="px-2 pb-1 text-[0.62rem] font-bold uppercase tracking-[0.11em] text-t4 [&_[cmdk-group-heading]]:px-1.5 [&_[cmdk-group-heading]]:py-2"
            >
              <Cmdk.Item
                value="ai-fallback-ask"
                onSelect={handleAskAI}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-t2 aria-selected:bg-white/[0.065] aria-selected:text-t1"
              >
                <Sparkles className="h-4 w-4 shrink-0" style={{ color: "hsl(var(--accent))" }} />
                <span className="flex-1 truncate">Ask Revluma Copilot — "{trimmedQuery}"</span>
              </Cmdk.Item>
            </Cmdk.Group>
          )}
        </Cmdk.List>

        <div className="flex items-center gap-4 border-t border-border px-4 py-2 text-[0.7rem] text-t3">
          <span><kbd className="mr-1 rounded border border-border bg-bg-3 px-1 py-px">↑↓</kbd>navigate</span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border bg-bg-3 px-1 py-px"><CornerDownLeft className="inline h-2.5 w-2.5" /></kbd>select
          </span>
          <span><kbd className="mr-1 rounded border border-border bg-bg-3 px-1 py-px">⌘↵</kbd>pin</span>
          <span className="ml-auto"><kbd className="mr-1 rounded border border-border bg-bg-3 px-1 py-px">esc</kbd>close</span>
        </div>
      </Cmdk>
    </div>
  );
}