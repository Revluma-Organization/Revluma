import { useEffect, useMemo, useState } from "react";
import { Search, ShieldAlert, ShieldCheck } from "lucide-react";
import { useInRouterContext, useNavigate } from "react-router-dom";
import { investigationRoute } from "@/lib/workspaceNavigation";
import { Sheet, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { FindingDetailsDrawer } from "./FindingDetailsDrawer";
import {
  SIGNAL_TIERS,
  SIGNALS_PAGE_SIZE,
  countBySignalTier,
  filterSignals,
  signalCategories,
  signalVerificationState,
  sortSignals,
  type SignalSeverityTier,
  type SignalSort,
  type SignalVerificationFilter,
} from "./signalsTable";
import {
  categoryLabelFor,
  dateTime,
  getSeverityMeta,
  relativeTime,
  selectQueueFindings,
} from "./findingDisplay";
import { cc } from "./tokens";
import type { CommandCenterData, Finding } from "./types";

function useWorkspaceNavigation() {
  const inRouter = useInRouterContext();
  const navigate = useNavigate();
  return (route: string) => {
    if (!inRouter) {
      window.location.assign(route);
      return;
    }
    if (!route.startsWith("/dashboard/rev-intell")) {
      navigate(route);
      return;
    }
    const current = new URL(window.location.href);
    const finding = new URL(route, current.origin).searchParams.get("finding");
    if (finding && /^[0-9a-f-]{36}$/i.test(finding)) {
      current.searchParams.set("finding", finding);
    }
    navigate(investigationRoute(route, `${current.pathname}${current.search}${current.hash}`));
  };
}

const tierCountFor = (
  counts: ReturnType<typeof countBySignalTier>,
  tier: SignalSeverityTier,
): number =>
  tier === "all"
    ? counts.all
    : tier === "critical_high"
      ? counts.criticalHigh
      : tier === "medium"
        ? counts.medium
        : counts.low;

function FreshnessValue({ finding }: { finding: Finding }) {
  const { state, observed_at, as_of } = finding.evidence_freshness;
  const label =
    state === "fresh" ? "Fresh" : state === "stale" ? "Stale" : state ? state.replaceAll("_", " ") : "Unknown";
  const iso = observed_at || as_of || null;
  if (!state && !iso) {
    return <span className="text-ink-muted">Unknown</span>;
  }
  return (
    <span title={iso ? dateTime(iso) : undefined}>
      {label}
      {iso ? <span className="text-ink-muted"> · {relativeTime(iso)}</span> : null}
    </span>
  );
}

function DetectedValue({ finding }: { finding: Finding }) {
  const iso = finding.detected_at || finding.last_verified_at || null;
  if (!iso) return <span className="text-ink-muted">Not recorded</span>;
  return (
    <span title={dateTime(iso)} className="tabular-nums">
      {relativeTime(iso)}
    </span>
  );
}

const selectClassName = cn(
  "min-h-9 cursor-pointer rounded-lg border border-line bg-white px-2.5 text-xs font-medium text-ink transition-colors hover:bg-subtle",
  cc.focus,
);

export interface SignalsTableProps {
  data: CommandCenterData;
}

export function SignalsTable({ data }: SignalsTableProps) {
  const openRoute = useWorkspaceNavigation();
  const [tier, setTier] = useState<SignalSeverityTier>("all");
  const [verification, setVerification] = useState<SignalVerificationFilter>("all");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SignalSort>("priority");
  const [visibleCount, setVisibleCount] = useState(SIGNALS_PAGE_SIZE);
  const [openFindingId, setOpenFindingId] = useState<string | null>(null);

  const queue = useMemo(() => selectQueueFindings(data), [data]);
  const counts = useMemo(() => countBySignalTier(queue), [queue]);
  const categories = useMemo(() => signalCategories(queue), [queue]);
  const primaryId = data.priority_finding?.id ?? null;
  const rankById = useMemo(() => {
    const ranks = new Map<string, number>();
    queue.forEach((item, index) => ranks.set(item.id, index + 1));
    return ranks;
  }, [queue]);

  const filtered = useMemo(
    () => sortSignals(filterSignals(queue, { tier, verification, category, query }), sort),
    [queue, tier, verification, category, query, sort],
  );
  const visible = filtered.slice(0, visibleCount);
  const remaining = filtered.length - visible.length;

  // Any filter, search, sort, or payload change restarts pagination from the
  // first page so stale "show more" windows never survive a new result set.
  useEffect(() => {
    setVisibleCount(SIGNALS_PAGE_SIZE);
  }, [tier, verification, category, query, sort, queue]);

  const filtersActive =
    tier !== "all" || verification !== "all" || category !== "all" || query.trim() !== "" || sort !== "priority";
  const clearFilters = () => {
    setTier("all");
    setVerification("all");
    setCategory("all");
    setQuery("");
    setSort("priority");
  };

  if (queue.length === 0) {
    return (
      <div className="min-w-0 rounded-xl border border-line-soft bg-white">
        <div className="mx-auto max-w-[560px] px-5 py-10 text-center sm:px-8">
          <div
            className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-brand-line bg-brand-soft text-brand"
            aria-hidden="true"
          >
            <ShieldCheck className="h-5 w-5" />
          </div>
          <h3 className="mt-4 text-[15px] font-semibold leading-snug tracking-[-0.015em] text-ink">
            No signals recorded
          </h3>
          <p className="mt-2 text-[13px] leading-6 text-ink-muted">
            No findings currently meet the evidence threshold for review. This does not mean
            there are no business problems — further investigation may uncover issues.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-line-soft bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 sm:px-5">
        <h3 id="signals-table-heading" className="text-sm font-semibold tracking-[-0.01em] text-ink">
          Detected signals
        </h3>
        <p role="status" className="text-xs tabular-nums text-ink-muted">
          Showing {visible.length} of {filtered.length} {filtered.length === 1 ? "signal" : "signals"}
        </p>
      </div>

      {/* Filter + search toolbar: every control filters the rendered rows. */}
      <div className="flex flex-wrap items-end gap-x-3 gap-y-3 px-4 py-3 sm:px-5">
        <div role="group" aria-label="Filter by severity" className="flex flex-wrap items-center gap-1.5">
          {(["all", ...SIGNAL_TIERS.map((entry) => entry.id)] as SignalSeverityTier[]).map((value) => {
            const label = value === "all" ? "All" : SIGNAL_TIERS.find((entry) => entry.id === value)!.label;
            const active = tier === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => setTier(value)}
                className={cn(
                  "inline-flex min-h-9 cursor-pointer items-center rounded-lg border px-3 text-xs font-semibold tabular-nums transition-colors",
                  active
                    ? "border-brand bg-brand text-white"
                    : "border-line bg-white text-ink-soft hover:bg-subtle",
                  cc.focus,
                )}
              >
                {label} ({tierCountFor(counts, value)})
              </button>
            );
          })}
        </div>

        <div className="relative min-w-[180px] flex-1">
          <label htmlFor="signals-search" className="sr-only">
            Search signals by title, description, category, or source
          </label>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
            aria-hidden="true"
          />
          <input
            id="signals-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search signals…"
            autoComplete="off"
            className={cn(
              "min-h-9 w-full rounded-lg border border-line bg-white py-2 pl-9 pr-3 text-xs text-ink transition-colors placeholder:text-ink-faint hover:bg-subtle focus:bg-white",
              cc.focus,
            )}
          />
        </div>

        <label className="flex flex-col gap-1 text-[11px] font-semibold text-ink-muted">
          Verification
          <select
            aria-label="Filter by verification state"
            value={verification}
            onChange={(event) => setVerification(event.target.value as SignalVerificationFilter)}
            className={selectClassName}
          >
            <option value="all">All states</option>
            <option value="verified">Verified</option>
            <option value="evidence_limited">Evidence-limited</option>
          </select>
        </label>

        {categories.length > 1 && (
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-ink-muted">
            Category
            <select
              aria-label="Filter by category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className={selectClassName}
            >
              <option value="all">All categories</option>
              {categories.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="flex flex-col gap-1 text-[11px] font-semibold text-ink-muted">
          Sort
          <select
            aria-label="Sort signals"
            value={sort}
            onChange={(event) => setSort(event.target.value as SignalSort)}
            className={selectClassName}
          >
            <option value="priority">Priority order</option>
            <option value="severity">Severity: highest first</option>
            <option value="detected">Detected: newest first</option>
          </select>
        </label>

        {filtersActive && (
          <button type="button" onClick={clearFilters} className={cn("min-h-9 px-1", cc.disclosure)}>
            Clear filters
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="border-t border-line-soft px-5 py-10 text-center sm:px-8">
          <p className="text-sm font-semibold text-ink">No signals match the current filters.</p>
          <p className="mx-auto mt-1 max-w-[440px] text-xs leading-5 text-ink-muted">
            Adjust the search or filters, or clear them to review every detected signal.
          </p>
          <button
            type="button"
            onClick={clearFilters}
            className={cn(
              "mt-4 inline-flex min-h-9 cursor-pointer items-center justify-center rounded-lg border border-line bg-white px-3.5 text-xs font-semibold text-ink transition-colors hover:bg-subtle",
              cc.focus,
            )}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <>
          <div className="border-t border-line-soft">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">
                Detected signals with severity, category, verification, evidence freshness, and
                detection time
              </caption>
              <thead>
                <tr className="border-b border-line-soft bg-subtle text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
                  <th scope="col" className="px-4 py-2.5 sm:px-5">
                    Signal
                  </th>
                  <th scope="col" className="whitespace-nowrap px-3 py-2.5">
                    Severity
                  </th>
                  <th scope="col" className="hidden px-3 py-2.5 md:table-cell">
                    Category
                  </th>
                  <th scope="col" className="hidden px-3 py-2.5 md:table-cell">
                    Verification
                  </th>
                  <th scope="col" className="hidden whitespace-nowrap px-3 py-2.5 md:table-cell">
                    Evidence freshness
                  </th>
                  <th scope="col" className="hidden whitespace-nowrap px-3 py-2.5 md:table-cell">
                    Detected
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right sm:px-5">
                    <span className="sr-only">Row actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((finding) => {
                  const severity = getSeverityMeta(finding.severity);
                  const verified = signalVerificationState(finding) === "verified";
                  const categoryLabel = categoryLabelFor(finding);
                  const selected = openFindingId === finding.id;
                  return (
                    <tr
                      key={finding.id}
                      data-selected={selected ? "true" : undefined}
                      className={cn(
                        "border-b border-line-soft transition-colors last:border-b-0",
                        selected ? "bg-brand-soft/60" : "hover:bg-subtle",
                      )}
                    >
                      <th scope="row" className="min-w-0 max-w-[420px] px-4 py-3 align-top sm:px-5">
                        <span className="block text-sm font-semibold leading-snug text-ink">
                          {finding.title}
                        </span>
                        <span className="mt-0.5 block text-xs leading-5 text-ink-muted line-clamp-2">
                          {finding.description}
                        </span>
                        <span className="mt-1 block text-[11px] leading-4 text-ink-tertiary md:hidden">
                          {categoryLabel} · {verified ? "Verified" : "Evidence-limited"} ·{" "}
                          <FreshnessValue finding={finding} /> · Detected <DetectedValue finding={finding} />
                        </span>
                      </th>
                      <td className="whitespace-nowrap px-3 py-3 align-top">
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink">
                          <span
                            aria-hidden="true"
                            className="inline-block h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: severity.base }}
                          />
                          {severity.label}
                        </span>
                      </td>
                      <td className="hidden max-w-[150px] px-3 py-3 align-top md:table-cell">
                        <span title={categoryLabel} className="block truncate text-xs text-ink-soft">
                          {categoryLabel}
                        </span>
                      </td>
                      <td className="hidden whitespace-nowrap px-3 py-3 align-top md:table-cell">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-4",
                            verified
                              ? "border-brand-lineStrong bg-brand-soft text-brand-deep"
                              : "border-danger-line bg-danger-soft text-danger-limited",
                          )}
                        >
                          {verified ? (
                            <ShieldCheck className="h-3 w-3 shrink-0" aria-hidden="true" />
                          ) : (
                            <ShieldAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
                          )}
                          {verified ? "Verified" : "Evidence-limited"}
                        </span>
                      </td>
                      <td className="hidden whitespace-nowrap px-3 py-3 align-top text-xs text-ink-soft md:table-cell">
                        <FreshnessValue finding={finding} />
                      </td>
                      <td className="hidden whitespace-nowrap px-3 py-3 align-top text-xs text-ink-soft md:table-cell">
                        <DetectedValue finding={finding} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right align-top sm:px-5">
                        <Sheet
                          open={selected}
                          onOpenChange={(open) => setOpenFindingId(open ? finding.id : null)}
                        >
                          <SheetTrigger asChild>
                            <button
                              type="button"
                              className={cn(
                                "inline-flex min-h-9 cursor-pointer items-center justify-center rounded-lg border border-line bg-white px-3 text-xs font-semibold text-ink transition-colors hover:bg-subtle",
                                cc.focus,
                              )}
                            >
                              Inspect
                            </button>
                          </SheetTrigger>
                          <FindingDetailsDrawer
                            finding={finding}
                            rank={rankById.get(finding.id) ?? 0}
                            isPrimary={finding.id === primaryId}
                            onInvestigate={openRoute}
                          />
                        </Sheet>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {filtered.length > SIGNALS_PAGE_SIZE && (
            <div className="flex flex-wrap items-center gap-2 border-t border-line-soft px-4 py-3 sm:px-5">
              {remaining > 0 ? (
                <button
                  type="button"
                  onClick={() => setVisibleCount((count) => count + SIGNALS_PAGE_SIZE)}
                  className={cn(
                    "inline-flex min-h-9 cursor-pointer items-center justify-center rounded-lg border border-line bg-white px-3.5 text-xs font-semibold text-ink transition-colors hover:bg-subtle",
                    cc.focus,
                  )}
                >
                  Show more ({remaining} remaining)
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setVisibleCount(SIGNALS_PAGE_SIZE)}
                  className={cn("min-h-9 px-1", cc.disclosure)}
                >
                  Show less
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default SignalsTable;
