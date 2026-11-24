import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, Reorder, motion, useReducedMotion } from "framer-motion";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowDownUp,
  ArrowRight,
  ArrowUp,
  Calendar,
  Check,
  ChevronDown,
  CircleDot,
  Clock,
  Compass,
  Database,
  Flag,
  Flame,
  GripVertical,
  History,
  Info,
  LayoutList,
  Radar,
  RotateCcw,
  Rows3,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import { useInRouterContext, useNavigate } from "react-router-dom";
import { investigationRoute } from "@/lib/workspaceNavigation";
import { cn } from "@/lib/utils";
import { StateBadge, type CommandCenterAppState } from "./StateBadge";
import { cc } from "./tokens";
import type { CommandCenterData, Finding } from "./types";

export interface TopPrioritiesSectionProps {
  data: CommandCenterData;
  refreshing?: boolean;
}

type SeverityFilter = "all" | "critical" | "high" | "medium" | "low";
type QueueSortMode = "rank" | "severity" | "custom";
type QueueDensity = "comfortable" | "compact";

const EASE_OUT_EXPO = [0.22, 1, 0.36, 1] as const;

const SEVERITY_ORDER: Record<Finding["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const money = (value: number, currency: string) => {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
  } catch {
    return `${value} ${currency}`;
  }
};

const dateTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(value),
      )
    : "Not recorded";

function observationText(
  item: Finding["evidence"]["observations"][number],
): string {
  if (item.value === null || item.availability !== "available") return "Unavailable";
  if (item.unit === "money" && typeof item.value === "number" && item.currency) {
    return money(item.value, item.currency);
  }
  return `${item.value}${item.unit === "count" ? "" : ` ${item.unit}`}`;
}

function isVerifiedFinding(finding: Finding): boolean {
  return (
    finding.evidence?.classification === "verified_observation" &&
    ["high", "moderate"].includes(finding.confidence?.classification)
  );
}

function findingEvidenceAppState(finding: Finding): CommandCenterAppState {
  if (finding.evidence_freshness.state === "stale") return "stale";
  if (finding.coverage.state === "partial" || finding.coverage.state === "incomplete") {
    return "partial";
  }
  if (finding.evidence_freshness.state === "fresh" && finding.coverage.complete) {
    return "current";
  }
  return "unavailable";
}

interface SeverityVisual {
  label: string;
  pillClass: string;
  borderLeftClass: string;
  dotClass: string;
  iconBgClass: string;
  Icon: typeof Flame;
}

function getSeverityVisual(severity: Finding["severity"]): SeverityVisual {
  if (severity === "critical") {
    return {
      label: "Critical",
      pillClass: "border-[#FECACA] bg-[#FEF2F2] text-[#B42318]",
      borderLeftClass: "border-l-[#B42318]",
      dotClass: "bg-[#DC2626]",
      iconBgClass: "border-[#FECACA] bg-[#FEF2F2] text-[#B42318]",
      Icon: Flame,
    };
  }
  if (severity === "high") {
    return {
      label: "High",
      pillClass: "border-[#FECACA] bg-[#FEF2F2] text-[#B42318]",
      borderLeftClass: "border-l-[#B42318]",
      dotClass: "bg-[#E11D48]",
      iconBgClass: "border-[#FECACA] bg-[#FEF2F2] text-[#B42318]",
      Icon: AlertTriangle,
    };
  }
  if (severity === "medium") {
    return {
      label: "Medium",
      pillClass: "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]",
      borderLeftClass: "border-l-[#D97706]",
      dotClass: "bg-[#D97706]",
      iconBgClass: "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]",
      Icon: Flag,
    };
  }
  return {
    label: "Low",
    pillClass: "border-[#D4D3FA] bg-[#EEF0FF] text-[#4438E8]",
    borderLeftClass: "border-l-[#4438E8]",
    dotClass: "bg-[#4438E8]",
    iconBgClass: "border-[#D4D3FA] bg-[#EEF0FF] text-[#4438E8]",
    Icon: CircleDot,
  };
}

function usePriorityNavigation() {
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

export function TopPrioritiesSection({
  data,
  refreshing = false,
}: TopPrioritiesSectionProps) {
  const openRoute = usePriorityNavigation();
  const prefersReducedMotion = useReducedMotion();
  const cardRef = useRef<HTMLElement | null>(null);

  const finding = data.priority_finding;
  const secondary = useMemo(
    () => (data.findings || []).filter((item) => item.id !== finding?.id),
    [data.findings, finding?.id],
  );
  const allFindings = useMemo(
    () => (finding ? [finding, ...secondary] : secondary),
    [finding, secondary],
  );

  // Interactive priority-list triage state (local UI only — never mutates backend authority)
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [sortMode, setSortMode] = useState<QueueSortMode>("rank");
  const [density, setDensity] = useState<QueueDensity>("comfortable");
  const [customSecondaryIds, setCustomSecondaryIds] = useState<string[]>([]);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [reviewedIds, setReviewedIds] = useState<Record<string, boolean>>({});
  const [showTierGuide, setShowTierGuide] = useState(false);

  // Synchronize custom secondary order whenever authoritative secondary IDs change
  const secondaryIdSignature = useMemo(
    () => secondary.map((item) => item.id).join("|"),
    [secondary],
  );
  useEffect(() => {
    const incomingIds = secondary.map((item) => item.id);
    setCustomSecondaryIds((prev) => {
      if (prev.length === 0) return incomingIds;
      const kept = prev.filter((id) => incomingIds.includes(id));
      const added = incomingIds.filter((id) => !kept.includes(id));
      return [...kept, ...added];
    });
  }, [secondaryIdSignature, secondary]);

  const authoritativeRankById = useMemo(() => {
    const map = new Map<string, number>();
    if (finding) map.set(finding.id, 1);
    secondary.forEach((item, index) => {
      map.set(item.id, index + 2);
    });
    return map;
  }, [finding, secondary]);

  const severityCounts = useMemo(() => {
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    allFindings.forEach((item) => {
      counts[item.severity] = (counts[item.severity] ?? 0) + 1;
    });
    return counts;
  }, [allFindings]);

  const orderedSecondary = useMemo(() => {
    const byId = new Map(secondary.map((item) => [item.id, item]));
    let list: Finding[];

    if (sortMode === "custom" && customSecondaryIds.length > 0) {
      list = customSecondaryIds
        .map((id) => byId.get(id))
        .filter((item): item is Finding => Boolean(item));
    } else if (sortMode === "severity") {
      list = [...secondary].sort(
        (a, b) =>
          (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) ||
          (authoritativeRankById.get(a.id) ?? 99) - (authoritativeRankById.get(b.id) ?? 99),
      );
    } else {
      list = secondary;
    }

    if (severityFilter === "all") return list;
    return list.filter((item) => item.severity === severityFilter);
  }, [secondary, sortMode, customSecondaryIds, severityFilter, authoritativeRankById]);

  const handleReorderSecondary = useCallback((reordered: Finding[]) => {
    setSortMode("custom");
    setCustomSecondaryIds((prev) => {
      const reorderedIds = reordered.map((item) => item.id);
      const hiddenIds = prev.filter((id) => !reorderedIds.includes(id));
      return [...reorderedIds, ...hiddenIds];
    });
  }, []);

  const moveSecondaryItem = useCallback(
    (id: string, direction: -1 | 1) => {
      const currentIds = orderedSecondary.map((item) => item.id);
      const idx = currentIds.indexOf(id);
      const target = idx + direction;
      if (idx === -1 || target < 0 || target >= currentIds.length) return;
      const nextVisible = [...currentIds];
      const [moved] = nextVisible.splice(idx, 1);
      nextVisible.splice(target, 0, moved);

      setSortMode("custom");
      setCustomSecondaryIds((prev) => {
        const hiddenIds = prev.filter((itemId) => !nextVisible.includes(itemId));
        return [...nextVisible, ...hiddenIds];
      });
    },
    [orderedSecondary],
  );

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const toggleReviewed = useCallback((id: string) => {
    setReviewedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const eligibleCount = data.priority_selection.eligible_count;
  const isCritical = Boolean(finding && ["critical", "high"].includes(finding.severity));
  const verified = finding ? isVerifiedFinding(finding) : false;
  const primarySeverityVisual = finding ? getSeverityVisual(finding.severity) : null;
  const showPrimaryUnderFilter =
    Boolean(finding) && (severityFilter === "all" || finding?.severity === severityFilter);

  const availableResourceCount = (data.evidence?.resources || []).filter(
    (item) => item.availability === "available",
  ).length;
  const reportingPeriodLabel =
    data.reporting_period?.label ||
    (typeof data.reporting_period?.days === "number"
      ? `Last ${data.reporting_period.days} days`
      : null);

  const sectionState: CommandCenterAppState = refreshing
    ? "updating"
    : data.business_state.presentation_status === "failed"
      ? "unavailable"
      : data.business_state.stale
        ? "stale"
        : finding
          ? findingEvidenceAppState(finding)
          : "empty";

  const statusText = refreshing
    ? "Updating"
    : eligibleCount > 0
      ? `${eligibleCount} ${eligibleCount === 1 ? "eligible priority" : "eligible priorities"}`
      : "No verified priorities";

  // Subtle GPU-friendly pointer spotlight via CSS vars (zero React re-renders)
  const handlePointerMove = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (prefersReducedMotion || !cardRef.current) return;
      const rect = cardRef.current.getBoundingClientRect();
      cardRef.current.style.setProperty("--priority-mx", `${event.clientX - rect.left}px`);
      cardRef.current.style.setProperty("--priority-my", `${event.clientY - rect.top}px`);
    },
    [prefersReducedMotion],
  );

  const topRailGradient = isCritical
    ? "from-[#B42318] via-[#E11D48]/75 to-transparent"
    : finding
      ? "from-[#4438E8] via-[#7B72F8]/75 to-transparent"
      : "from-[#4438E8]/55 via-[#8E86FA]/30 to-transparent";

  const filterOptions: Array<{
    id: SeverityFilter;
    label: string;
    count: number;
    dotClass?: string;
  }> = [
    { id: "all", label: "All", count: allFindings.length },
    ...(severityCounts.critical > 0
      ? [
          {
            id: "critical" as const,
            label: "Critical",
            count: severityCounts.critical,
            dotClass: "bg-[#DC2626]",
          },
        ]
      : []),
    ...(severityCounts.high > 0
      ? [
          {
            id: "high" as const,
            label: "High",
            count: severityCounts.high,
            dotClass: "bg-[#E11D48]",
          },
        ]
      : []),
    ...(severityCounts.medium > 0
      ? [
          {
            id: "medium" as const,
            label: "Medium",
            count: severityCounts.medium,
            dotClass: "bg-[#D97706]",
          },
        ]
      : []),
    ...(severityCounts.low > 0
      ? [
          {
            id: "low" as const,
            label: "Low",
            count: severityCounts.low,
            dotClass: "bg-[#4438E8]",
          },
        ]
      : []),
  ];

  const hasMultipleFindings = allFindings.length > 1;
  const primaryReviewed = finding ? Boolean(reviewedIds[finding.id]) : false;

  return (
    <motion.section
      ref={cardRef}
      id="priority-finding"
      aria-labelledby="priority-findings-heading"
      onMouseMove={handlePointerMove}
      initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.36, ease: EASE_OUT_EXPO }}
      className={cn(
        finding ? cc.intelligence : cc.surface,
        "group/priority relative overflow-hidden scroll-mt-24 transition-colors duration-200",
        !finding && "hover:border-[#D9DCE8]",
      )}
    >
      {/* Precision Top Semantic Accent Rail */}
      <div
        aria-hidden="true"
        className={cn("h-[2px] w-full bg-gradient-to-r", topRailGradient)}
      />

      {/* Subtle Pointer-Tracking Ambient Aura */}
      {!prefersReducedMotion && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover/priority:opacity-100"
          style={{
            background: isCritical
              ? "radial-gradient(520px circle at var(--priority-mx, 50%) var(--priority-my, 0%), rgba(180,35,24,0.045), transparent 65%)"
              : "radial-gradient(520px circle at var(--priority-mx, 50%) var(--priority-my, 0%), rgba(68,56,232,0.055), transparent 65%)",
          }}
        />
      )}

      {/* Section Header */}
      <div
        className={cn(
          "relative flex flex-col gap-3 border-b bg-gradient-to-b from-[#FAFBFD] to-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6",
          cc.divider,
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div
            aria-hidden="true"
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border",
              isCritical
                ? "border-[#FECACA] bg-[#FEF2F2] text-[#B42318]"
                : finding
                  ? "border-[#D8D7FA] bg-[#EEF0FF] text-[#4438E8]"
                  : "border-[#E3E5F2] bg-[#F6F7FC] text-[#4438E8]",
            )}
          >
            {isCritical ? (
              <ShieldAlert className="h-4 w-4" />
            ) : finding ? (
              <Target className="h-4 w-4" />
            ) : (
              <Radar className="h-4 w-4" />
            )}
          </div>
          <div className="min-w-0">
            <h2 id="priority-findings-heading" className={cc.sectionTitle}>
              Top priorities
            </h2>
            <p className="mt-0.5 text-[13px] leading-5 text-[#707582]">
              The most important issues identified across your store.
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <StateBadge state={sectionState} label={statusText} />
        </div>
      </div>

      {/* Fast Triage Toolbar (Filter by Urgency, Sort, Compact/Comfortable View) */}
      {hasMultipleFindings && (
        <div
          role="toolbar"
          aria-label="Priority list filters and sorting"
          className={cn(
            "relative flex flex-col gap-2.5 border-b bg-[#FAFBFD]/85 px-5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-6",
            cc.divider,
          )}
        >
          {/* Priority Level Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by priority level">
            {filterOptions.map((option) => {
              const active = severityFilter === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSeverityFilter(option.id)}
                  className={cn(
                    "relative inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4438E8] focus-visible:ring-offset-1",
                    active
                      ? "text-[#17191F]"
                      : "text-[#525866] hover:bg-white/80 hover:text-[#17191F]",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId={prefersReducedMotion ? undefined : "priority-filter-active-pill"}
                      transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
                      aria-hidden="true"
                      className="absolute inset-0 rounded-full border border-[#D8D7FA] bg-white"
                    />
                  )}
                  <span className="relative inline-flex items-center gap-1.5">
                    {option.dotClass && (
                      <span
                        aria-hidden="true"
                        className={cn("h-1.5 w-1.5 rounded-full", option.dotClass)}
                      />
                    )}
                    <span>{option.label}</span>
                    <span className="rounded-full bg-[#F1F2F6] px-1.5 py-px text-[10px] font-semibold text-[#525866] tabular-nums">
                      {option.count}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* Sort & Density Quick Controls */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                setSortMode((prev) => (prev === "severity" ? "rank" : "severity"))
              }
              aria-label={`Sort secondary priorities. Currently sorted by ${sortMode}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#E7E9EF] bg-white px-2.5 py-1 text-xs font-medium text-[#343844] transition-colors hover:border-[#D4D3FA] hover:text-[#17191F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4438E8]"
            >
              <ArrowDownUp className="h-3.5 w-3.5 text-[#707582]" aria-hidden="true" />
              <span>
                {sortMode === "severity"
                  ? "Sorted: Severity"
                  : sortMode === "custom"
                    ? "Sorted: Custom"
                    : "Sorted: Rank"}
              </span>
            </button>

            {sortMode === "custom" && (
              <button
                type="button"
                onClick={() => {
                  setSortMode("rank");
                  setCustomSecondaryIds(secondary.map((item) => item.id));
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-[#E7E9EF] bg-white px-2 py-1 text-xs font-medium text-[#525866] transition-colors hover:border-[#D4D3FA] hover:text-[#4438E8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4438E8]"
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                <span>Reset order</span>
              </button>
            )}

            <div
              className="inline-flex items-center rounded-lg border border-[#E7E9EF] bg-white p-0.5"
              role="group"
              aria-label="Queue row density"
            >
              <button
                type="button"
                aria-pressed={density === "comfortable"}
                aria-label="Comfortable card rows"
                onClick={() => setDensity("comfortable")}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4438E8]",
                  density === "comfortable"
                    ? "bg-[#EEF0FF] text-[#4438E8]"
                    : "text-[#707582] hover:text-[#17191F]",
                )}
              >
                <LayoutList className="h-3 w-3" aria-hidden="true" />
                <span className="hidden sm:inline">Cards</span>
              </button>
              <button
                type="button"
                aria-pressed={density === "compact"}
                aria-label="Compact single-line rows"
                onClick={() => setDensity("compact")}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4438E8]",
                  density === "compact"
                    ? "bg-[#EEF0FF] text-[#4438E8]"
                    : "text-[#707582] hover:text-[#17191F]",
                )}
              >
                <Rows3 className="h-3 w-3" aria-hidden="true" />
                <span className="hidden sm:inline">Compact</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tier 1: Populated #1 Priority Spotlight */}
      {finding ? (
        showPrimaryUnderFilter ? (
          <article
            aria-labelledby="current-priority-title"
            className={cn(
              "relative border-l-[3px] px-5 py-5 transition-opacity duration-200 sm:px-6 sm:py-6",
              isCritical ? "border-l-[#B42318]" : "border-l-[#4438E8]",
              primaryReviewed && "bg-[#FCFDFE]",
            )}
          >
            {/* Priority Signal Strip: Check toggle, Rank #1, Icon-backed Urgency Pill, Verification & Freshness */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium">
                <button
                  type="button"
                  aria-pressed={primaryReviewed}
                  aria-label={
                    primaryReviewed
                      ? `Unmark ${finding.title} as reviewed`
                      : `Mark ${finding.title} as reviewed`
                  }
                  onClick={() => toggleReviewed(finding.id)}
                  className={cn(
                    "inline-flex h-5 w-5 items-center justify-center rounded-full border transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4438E8] focus-visible:ring-offset-1",
                    primaryReviewed
                      ? "border-[#12B76A] bg-[#12B76A] text-white"
                      : "border-[#D0D5DD] bg-white text-transparent hover:border-[#4438E8]",
                  )}
                >
                  <Check className="h-3 w-3" strokeWidth={2.75} aria-hidden="true" />
                </button>

                <span className="inline-flex items-center rounded-md bg-[#17191F] px-2 py-0.5 font-semibold tracking-tight text-white tabular-nums">
                  #1
                </span>

                {primarySeverityVisual && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-semibold capitalize",
                      primarySeverityVisual.pillClass,
                    )}
                  >
                    {isCritical && !prefersReducedMotion ? (
                      <span className="relative flex h-2 w-2" aria-hidden="true">
                        <motion.span
                          className="absolute inline-flex h-full w-full rounded-full bg-[#DC2626] opacity-60"
                          animate={{ scale: [1, 1.9, 1], opacity: [0.65, 0, 0.65] }}
                          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
                        />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-[#DC2626]" />
                      </span>
                    ) : (
                      <primarySeverityVisual.Icon
                        className="h-3 w-3 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                    <span>{finding.priority.classification} priority</span>
                  </span>
                )}

                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5",
                    verified
                      ? "border-[#ABEFC6] bg-[#ECFDF3] text-[#067647]"
                      : "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      verified ? "bg-[#12B76A]" : "bg-[#D97706]",
                    )}
                  />
                  <span>{verified ? "Verified finding" : "Hypothesis"}</span>
                </span>

                <span className="inline-flex items-center rounded-full border border-[#E7E9EF] bg-[#F8F9FB] px-2.5 py-0.5 text-[#525866]">
                  {finding.confidence.classification.replaceAll("_", " ")} confidence
                </span>

                <span className="inline-flex items-center rounded-full border border-[#E7E9EF] bg-[#F8F9FB] px-2.5 py-0.5 text-[#525866]">
                  {finding.evidence_freshness.state} evidence · {finding.coverage.state} coverage
                </span>
              </div>

              {primaryReviewed && (
                <span className="inline-flex items-center gap-1 rounded-full border border-[#ABEFC6] bg-[#ECFDF3] px-2.5 py-0.5 text-[11px] font-medium text-[#067647]">
                  <Check className="h-3 w-3" aria-hidden="true" />
                  <span>Reviewed</span>
                </span>
              )}
            </div>

            {/* 1. Primary Title & Summary */}
            <h3
              id="current-priority-title"
              className={cn(
                "mt-3.5 text-lg font-semibold leading-snug tracking-[-0.025em] text-[#17191F] sm:text-[1.3125rem]",
                primaryReviewed && "text-[#525866]",
              )}
            >
              {finding.title}
            </h3>
            <p className={cn("mt-1.5 max-w-3xl", cc.body)}>{finding.description}</p>

            {/* 2. Asymmetric Bento Rationale & Observations Grid */}
            <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.06fr)_minmax(0,0.94fr)]">
              <div className="space-y-3">
                <div className="rounded-xl border border-[#ECEEF4] bg-[#FAFBFD] p-4">
                  <div className="flex items-center gap-2">
                    <Target
                      className="h-3.5 w-3.5 shrink-0 text-[#4438E8]"
                      aria-hidden="true"
                    />
                    <h4 className={cc.cardTitle}>Why this is the priority</h4>
                  </div>
                  <ul className={cn("mt-2 space-y-1.5", cc.metadata)}>
                    {finding.priority.rationale.map((reason) => (
                      <li key={reason} className="flex gap-2">
                        <span
                          aria-hidden="true"
                          className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[#4438E8]/60"
                        />
                        <span className="text-[#343844]">{reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-xl border border-[#ECEEF4] bg-[#FAFBFD] p-4">
                  <div className="flex items-center gap-2">
                    <ShieldCheck
                      className="h-3.5 w-3.5 shrink-0 text-[#067647]"
                      aria-hidden="true"
                    />
                    <h4 className={cc.cardTitle}>Confidence</h4>
                  </div>
                  <ul className={cn("mt-2 space-y-1.5", cc.metadata)}>
                    {finding.confidence.rationale.map((reason) => (
                      <li key={reason} className="flex gap-2">
                        <span
                          aria-hidden="true"
                          className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[#98A2B3]"
                        />
                        <span className="text-[#343844]">{reason}</span>
                      </li>
                    ))}
                  </ul>
                  {finding.priority.tie && (
                    <p className="mt-2.5 rounded-lg border border-[#E7E9EF] bg-white px-3 py-2 text-xs leading-5 text-[#525866]">
                      {finding.priority.tie.statement}
                    </p>
                  )}
                </div>

                {finding.limitations.length > 0 && (
                  <div className="rounded-xl border border-[#FDE68A]/70 bg-[#FFFDF7] p-4">
                    <div className="flex items-center gap-2">
                      <AlertCircle
                        className="h-3.5 w-3.5 shrink-0 text-[#92400E]"
                        aria-hidden="true"
                      />
                      <h4 className={cc.cardTitle}>Limits of this conclusion</h4>
                    </div>
                    <ul className={cn("mt-2 space-y-1.5", cc.metadata)}>
                      {finding.limitations.map((limit) => (
                        <li key={limit} className="flex gap-2">
                          <span
                            aria-hidden="true"
                            className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[#D97706]/70"
                          />
                          <span className="text-[#525866]">{limit}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Supporting Observations KPI Deck */}
              <div className={cn(cc.surfaceSubtle, "flex flex-col justify-between p-4")}>
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h4 className={cc.cardTitle}>Supporting observations</h4>
                    <span className="text-[11px] font-medium text-[#707582]">
                      {finding.reporting_period.timezone}
                    </span>
                  </div>
                  <dl className="mt-3 grid grid-cols-1 gap-2.5 min-[420px]:grid-cols-2">
                    {finding.evidence.observations.map((item, idx) => (
                      <motion.div
                        key={`${item.period}-${item.label}`}
                        initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{
                          duration: 0.28,
                          delay: prefersReducedMotion ? 0 : idx * 0.045,
                          ease: EASE_OUT_EXPO,
                        }}
                        whileHover={prefersReducedMotion ? undefined : { y: -2 }}
                        className="min-w-0 rounded-xl border border-[#E7E9EF] bg-white px-3.5 py-3 transition-colors duration-150 hover:border-[#D4D3FA]"
                      >
                        <dt className="text-[11px] font-medium text-[#707582]">{item.label}</dt>
                        <dd className="mt-1.5 break-words text-[1.125rem] font-semibold tracking-[-0.02em] text-[#17191F] tabular-nums">
                          {observationText(item)}
                        </dd>
                      </motion.div>
                    ))}
                  </dl>
                </div>

                <div
                  className={cn(
                    "mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t pt-3 text-[11px] text-[#707582] tabular-nums",
                    cc.divider,
                  )}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="h-3 w-3 shrink-0 text-[#98A2B3]" aria-hidden="true" />
                    <span>
                      {finding.reporting_period.kind.replaceAll("_", " ")} ·{" "}
                      {finding.reporting_period.timezone}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="h-3 w-3 shrink-0 text-[#98A2B3]" aria-hidden="true" />
                    <span>Last verified {dateTime(finding.last_verified_at)}</span>
                  </span>
                </div>
              </div>
            </div>

            {/* 3. Recommended Next Step — Signature Indigo Callout */}
            <div className="mt-5 rounded-xl border border-[#DCDAFA] border-l-[3px] border-l-[#4438E8] bg-gradient-to-br from-[#F8F7FF] via-[#F5F5FF] to-[#EEF0FF]/70 p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  aria-hidden="true"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#4438E8]/10 text-[#4438E8]"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                </span>
                <h4 className={cc.cardTitle}>
                  Recommended next step{" "}
                  <span className="font-normal text-[#707582]">
                    · merchant action, not executed by Revluma
                  </span>
                </h4>
              </div>
              {finding.recommendation.available ? (
                <div className="mt-2.5 space-y-2">
                  <p className="text-sm font-medium leading-6 text-[#17191F]">
                    {finding.recommendation.step}
                  </p>
                  {(finding.recommendation.rationale ||
                    finding.recommendation.expected_result) && (
                    <div className="grid gap-2 pt-0.5 sm:grid-cols-2">
                      {finding.recommendation.rationale && (
                        <p className="rounded-lg border border-[#E4E2FB] bg-white/75 px-3 py-2 text-xs leading-5 text-[#525866]">
                          <span className="font-semibold text-[#17191F]">Why it matters: </span>
                          {finding.recommendation.rationale}
                        </p>
                      )}
                      {finding.recommendation.expected_result && (
                        <p className="rounded-lg border border-[#E4E2FB] bg-white/75 px-3 py-2 text-xs leading-5 text-[#525866]">
                          <span className="font-semibold text-[#17191F]">Look for: </span>
                          {finding.recommendation.expected_result}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <p className={cn("mt-2", cc.metadata)}>
                  {finding.recommendation.prerequisites.join(" ")}
                </p>
              )}
            </div>

            {/* 4. Native Progressive Disclosure for Provenance & Uncertainty */}
            <details className="group mt-4">
              <summary
                className={cn(
                  "inline-flex list-none items-center gap-1.5 rounded-lg border border-transparent px-2.5 py-1.5 -ml-2.5 transition-colors hover:border-[#E0DFFA] hover:bg-[#F7F6FF] [&::-webkit-details-marker]:hidden",
                  cc.disclosure,
                )}
              >
                <ChevronDown
                  className="h-3.5 w-3.5 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
                  aria-hidden="true"
                />
                Inspect evidence, provenance and uncertainty
              </summary>
              <div className={cn("mt-3 grid gap-5 p-4 sm:grid-cols-2", cc.surfaceSubtle)}>
                <div>
                  <h4 className={cc.cardTitle}>Authoritative references</h4>
                  <ul className={cn("mt-2 space-y-2 break-all", cc.metadata)}>
                    {finding.evidence.references.map((ref) => (
                      <li
                        key={ref.id}
                        className="rounded-lg border border-[#E7E9EF] bg-white px-3 py-2"
                      >
                        <span className="font-semibold text-[#17191F]">{ref.source_type}</span>
                        <br />
                        <span className="font-mono text-[11px]">{ref.source_record_id}</span>
                      </li>
                    ))}
                  </ul>
                  <p className={cn("mt-3 font-mono text-[11px]", cc.metadata)}>
                    Method: {finding.priority.method_version}
                  </p>
                </div>
                <div>
                  <h4 className={cc.cardTitle}>Lifecycle and unknowns</h4>
                  <p className={cn("mt-2 tabular-nums", cc.metadata)}>
                    {finding.lifecycle.state} ·{" "}
                    {finding.lifecycle.current_validity.replaceAll("_", " ")}
                    <br />
                    Detected {dateTime(finding.detected_at)}
                  </p>
                  <ul className={cn("mt-2 space-y-1", cc.metadata)}>
                    {finding.unknowns.map((item) => (
                      <li key={item}>• {item}</li>
                    ))}
                  </ul>
                  {finding.evidence.duplicate_finding_ids.length > 0 && (
                    <p className={cn("mt-2", cc.metadata)}>
                      Deduplicated records retained:{" "}
                      {finding.evidence.duplicate_finding_ids.join(", ")}
                    </p>
                  )}
                </div>
              </div>
            </details>

            {/* 5. Investigation Handoff Bar */}
            <div
              className={cn(
                "mt-5 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between",
                cc.divider,
              )}
            >
              <p className={cc.metadata}>
                {finding.recommendation.validation_method ||
                  "Further evidence is required before a current recommendation."}
              </p>
              <motion.button
                type="button"
                whileHover={prefersReducedMotion ? undefined : { y: -1 }}
                whileTap={prefersReducedMotion ? undefined : { scale: 0.985 }}
                onClick={() => openRoute(finding.investigation.route)}
                className={cn(
                  cc.primary,
                  "group/cta transition-all duration-200 hover:shadow-[0_8px_20px_-6px_rgba(68,56,232,0.45)]",
                )}
              >
                <span>Investigate in Rev Intelligence</span>
                <ArrowRight
                  className="h-3.5 w-3.5 transition-transform duration-200 group-hover/cta:translate-x-0.5 motion-reduce:transition-none"
                  aria-hidden="true"
                />
              </motion.button>
            </div>
          </article>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-xs text-[#525866] sm:px-6">
            <span>
              Top priority (<strong className="font-semibold text-[#17191F]">#1 {finding.title}</strong>) is hidden by the{" "}
              <strong className="font-semibold capitalize text-[#17191F]">{severityFilter}</strong>{" "}
              filter.
            </span>
            <button
              type="button"
              onClick={() => setSeverityFilter("all")}
              className="font-semibold text-[#4438E8] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4438E8]"
            >
              Show all priorities
            </button>
          </div>
        )
      ) : (
        /* Flagship Priority-List Calm Monitoring Empty State */
        <div className="relative overflow-hidden">
          {/* Subtle Architectural Dot-Matrix Backdrop */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-[0.3]"
            style={{
              backgroundImage: "radial-gradient(#C7CCD8 0.85px, transparent 0.85px)",
              backgroundSize: "18px 18px",
              maskImage:
                "radial-gradient(ellipse 68% 95% at 88% 46%, black 0%, rgba(0,0,0,0.25) 55%, transparent 100%)",
              WebkitMaskImage:
                "radial-gradient(ellipse 68% 95% at 88% 46%, black 0%, rgba(0,0,0,0.25) 55%, transparent 100%)",
            }}
          />

          {/* Priority Tier Status Rail (Icon-Backed Urgency Tiers at a Glance — Strictly Factual 0 Counts) */}
          <div
            aria-label="Priority tier summary"
            className={cn(
              "relative grid grid-cols-1 divide-y border-b bg-[#FAFBFD]/80 sm:grid-cols-3 sm:divide-x sm:divide-y-0",
              cc.divider,
            )}
          >
            {[
              {
                key: "urgent",
                label: "Critical & High",
                caption: "Immediate revenue or operational impact",
                Icon: Flame,
                iconClass: "border-[#FECACA] bg-[#FEF2F2] text-[#B42318]",
                dotClass: "bg-[#DC2626]",
              },
              {
                key: "medium",
                label: "Medium",
                caption: "Developing shifts meeting evidence rules",
                Icon: Flag,
                iconClass: "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]",
                dotClass: "bg-[#D97706]",
              },
              {
                key: "watch",
                label: "Low & Watch",
                caption: "Early verified signals under observation",
                Icon: CircleDot,
                iconClass: "border-[#D4D3FA] bg-[#EEF0FF] text-[#4438E8]",
                dotClass: "bg-[#4438E8]",
              },
            ].map((tier) => (
              <div
                key={tier.key}
                className="flex items-center justify-between gap-3 px-5 py-3 sm:px-6"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border",
                      tier.iconClass,
                    )}
                  >
                    <tier.Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-[#17191F]">{tier.label}</p>
                    <p className="truncate text-[11px] text-[#707582]">{tier.caption}</p>
                  </div>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#E7E9EF] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#525866] tabular-nums">
                  <span
                    aria-hidden="true"
                    className={cn("h-1.5 w-1.5 rounded-full opacity-40", tier.dotClass)}
                  />
                  <span>0</span>
                </span>
              </div>
            ))}
          </div>

          {/* Core Monitoring Empty Body */}
          <div className="relative px-5 py-6 sm:px-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 max-w-2xl items-start gap-4">
                {/* Calm Animated Radar Emblem */}
                <div
                  aria-hidden="true"
                  className="relative mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[#DCDAFA] bg-gradient-to-b from-white to-[#F5F5FF] text-[#4438E8]"
                >
                  {!prefersReducedMotion && (
                    <>
                      <motion.span
                        className="pointer-events-none absolute inset-0 rounded-2xl border border-[#4438E8]/30"
                        animate={{ scale: [1, 1.32, 1.32], opacity: [0.45, 0, 0] }}
                        transition={{
                          duration: 3.2,
                          repeat: Infinity,
                          ease: "easeOut",
                        }}
                      />
                      <motion.span
                        className="pointer-events-none absolute inset-1.5 rounded-xl bg-[#4438E8]/8"
                        animate={{ opacity: [0.35, 0.8, 0.35] }}
                        transition={{
                          duration: 3.2,
                          repeat: Infinity,
                          ease: "easeInOut",
                        }}
                      />
                    </>
                  )}
                  <ShieldCheck className="relative h-5 w-5" />
                </div>

                <div className="min-w-0">
                  <p className="text-[15px] font-semibold tracking-[-0.015em] text-[#17191F]">
                    No verified priorities right now
                  </p>
                  <p className="mt-1 text-[13px] leading-5 text-[#525866]">
                    No findings currently meet the evidence threshold. This doesn&apos;t mean there
                    are no business problems. Further investigation may uncover issues.
                  </p>
                  {data.priority_selection.reason &&
                    !data.priority_selection.reason
                      .toLowerCase()
                      .includes("no open verified findings are recorded") && (
                      <p className="mt-1.5 text-xs leading-5 text-[#707582]">
                        {data.priority_selection.reason}
                      </p>
                    )}

                  {/* Authoritative Monitoring Scope Strip */}
                  <div className="mt-3.5 flex flex-wrap items-center gap-2 text-[11px] font-medium text-[#525866]">
                    {availableResourceCount > 0 && (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E7E9EF] bg-[#FAFBFD] px-2.5 py-0.5 tabular-nums">
                        <Database className="h-3 w-3 text-[#4438E8]" aria-hidden="true" />
                        <span>
                          {availableResourceCount}{" "}
                          {availableResourceCount === 1 ? "source" : "sources"} monitored
                        </span>
                      </span>
                    )}
                    {reportingPeriodLabel && (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E7E9EF] bg-[#FAFBFD] px-2.5 py-0.5">
                        <Calendar className="h-3 w-3 text-[#707582]" aria-hidden="true" />
                        <span>{reportingPeriodLabel}</span>
                      </span>
                    )}
                    <button
                      type="button"
                      aria-expanded={showTierGuide}
                      onClick={() => setShowTierGuide((prev) => !prev)}
                      className="inline-flex items-center gap-1 rounded-full border border-[#E7E9EF] bg-white px-2.5 py-0.5 text-[11px] font-medium text-[#4438E8] transition-colors hover:border-[#D4D3FA] hover:bg-[#F7F6FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4438E8]"
                    >
                      <Info className="h-3 w-3" aria-hidden="true" />
                      <span>How priorities are ranked</span>
                      <ChevronDown
                        className={cn(
                          "h-3 w-3 transition-transform duration-150 motion-reduce:transition-none",
                          showTierGuide && "rotate-180",
                        )}
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                </div>
              </div>

              <motion.button
                type="button"
                whileHover={prefersReducedMotion ? undefined : { y: -1.5 }}
                whileTap={prefersReducedMotion ? undefined : { scale: 0.985 }}
                onClick={() => openRoute("/dashboard/rev-intell")}
                className={cn(
                  cc.secondary,
                  "group/explore self-start rounded-xl border-[#D8D7FA] bg-white px-4 py-2.5 transition-all duration-200 hover:border-[#4438E8]/50 hover:bg-[#F7F6FF] hover:shadow-[0_10px_24px_-12px_rgba(68,56,232,0.38)] sm:self-center",
                )}
              >
                <span
                  aria-hidden="true"
                  className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#EEF0FF] text-[#4438E8] transition-colors duration-200 group-hover/explore:bg-[#4438E8] group-hover/explore:text-white"
                >
                  <Compass className="h-3.5 w-3.5" />
                </span>
                <span>Explore with Rev Intell</span>
                <ArrowRight
                  className="h-3.5 w-3.5 text-[#707582] transition-all duration-200 group-hover/explore:translate-x-0.5 group-hover/explore:text-[#4438E8] motion-reduce:transition-none"
                  aria-hidden="true"
                />
              </motion.button>
            </div>

            {/* Progressive Disclosure: Ranking & Evidence-Gating Guide */}
            <AnimatePresence initial={false}>
              {showTierGuide && (
                <motion.div
                  initial={prefersReducedMotion ? false : { opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={prefersReducedMotion ? undefined : { opacity: 0, height: 0 }}
                  transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
                  className="overflow-hidden"
                >
                  <div className="mt-4 grid gap-3 rounded-xl border border-[#E7E9EF] bg-[#FAFBFD] p-4 sm:grid-cols-3">
                    <div className="rounded-lg border border-[#ECEEF4] bg-white p-3">
                      <p className="text-xs font-semibold text-[#17191F]">
                        1. Evidence-threshold gated
                      </p>
                      <p className="mt-1 text-xs leading-5 text-[#525866]">
                        Only findings backed by fresh, synchronized store records are promoted into
                        your priority queue.
                      </p>
                    </div>
                    <div className="rounded-lg border border-[#ECEEF4] bg-white p-3">
                      <p className="text-xs font-semibold text-[#17191F]">
                        2. Single #1 focus first
                      </p>
                      <p className="mt-1 text-xs leading-5 text-[#525866]">
                        The highest-impact verified issue surfaces at the top with full rationale,
                        observations, and limits.
                      </p>
                    </div>
                    <div className="rounded-lg border border-[#ECEEF4] bg-white p-3">
                      <p className="text-xs font-semibold text-[#17191F]">
                        3. Progressive triage queue
                      </p>
                      <p className="mt-1 text-xs leading-5 text-[#525866]">
                        Secondary findings stack in ranked order with severity signals, expandable
                        details, and direct Rev handoff.
                      </p>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Excluded Historical Findings (Compact Recessed List — Never Current Headings) */}
            {data.priority_selection.exclusions.length > 0 && (
              <div className={cn("relative mt-5 border-t pt-4", cc.divider)}>
                <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#707582]">
                  <History className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Excluded historical findings</span>
                </p>
                <ul
                  className={cn("mt-2.5 space-y-2", cc.metadata)}
                  aria-label="Findings excluded from current priority"
                >
                  {data.priority_selection.exclusions.map((item) => (
                    <li
                      key={item.finding_id}
                      className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-[#ECEEF4] bg-[#FAFBFD] px-3.5 py-2.5"
                    >
                      <span>
                        <span className="font-semibold text-[#17191F]">{item.title}</span> — not
                        current: {item.reason.replaceAll("_", " ")}. Historical evidence is not
                        presented as a current condition.
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tier 2: Reorderable, Expandable Ranked Priority Queue ("Other eligible findings") */}
      {secondary.length > 0 && (
        <div className={cn("relative border-t bg-[#FAFBFD] px-5 py-4 sm:px-6", cc.divider)}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[#707582]">
                Other eligible findings
              </h3>
              <span className="rounded-full border border-[#E7E9EF] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#525866] tabular-nums">
                {orderedSecondary.length}
              </span>
            </div>
            {orderedSecondary.length > 1 && (
              <span className="text-[11px] text-[#707582]">
                Drag or use arrows to arrange your review order
              </span>
            )}
          </div>

          {orderedSecondary.length === 0 ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-[#D8DCE6] bg-white px-4 py-3 text-xs text-[#525866]">
              <span>
                No secondary findings match the{" "}
                <strong className="font-semibold capitalize text-[#17191F]">
                  {severityFilter}
                </strong>{" "}
                priority filter.
              </span>
              <button
                type="button"
                onClick={() => setSeverityFilter("all")}
                className="font-semibold text-[#4438E8] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4438E8]"
              >
                Show all
              </button>
            </div>
          ) : (
            <Reorder.Group
              axis="y"
              values={orderedSecondary}
              onReorder={handleReorderSecondary}
              aria-label="Other eligible priority findings"
              className="mt-3 space-y-2"
            >
              {orderedSecondary.map((item, idx) => {
                const itemVerified = isVerifiedFinding(item);
                const visual = getSeverityVisual(item.severity);
                const isExpanded = Boolean(expandedIds[item.id]);
                const isReviewed = Boolean(reviewedIds[item.id]);
                const authoritativeRank = authoritativeRankById.get(item.id) ?? idx + 2;

                return (
                  <Reorder.Item
                    key={item.id}
                    value={item}
                    dragListener={orderedSecondary.length > 1 && !prefersReducedMotion}
                    layout={prefersReducedMotion ? undefined : "position"}
                    transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
                    className="list-none"
                  >
                    <article
                      className={cn(
                        "rounded-xl border border-[#E7E9EF] border-l-[3px] bg-white transition-colors duration-150 hover:border-[#D4D3FA]",
                        visual.borderLeftClass,
                        isReviewed && "bg-[#FCFDFE] opacity-85",
                      )}
                    >
                      {/* Core Scannable Decision Row */}
                      <div
                        className={cn(
                          "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
                          density === "compact" ? "px-3.5 py-2.5" : "px-4 py-3.5",
                        )}
                      >
                        <div className="flex min-w-0 flex-1 items-start gap-2.5 sm:items-center">
                          {/* Drag Handle (shown when reorderable) */}
                          {orderedSecondary.length > 1 && (
                            <span
                              aria-hidden="true"
                              title="Drag to reorder"
                              className="mt-0.5 hidden shrink-0 cursor-grab text-[#B0B6C5] transition-colors hover:text-[#525866] active:cursor-grabbing sm:mt-0 sm:inline-flex"
                            >
                              <GripVertical className="h-4 w-4" />
                            </span>
                          )}

                          {/* Quick-Review Check Toggle */}
                          <button
                            type="button"
                            aria-pressed={isReviewed}
                            aria-label={
                              isReviewed
                                ? `Unmark ${item.title} as reviewed`
                                : `Mark ${item.title} as reviewed`
                            }
                            onClick={() => toggleReviewed(item.id)}
                            className={cn(
                              "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4438E8] focus-visible:ring-offset-1 sm:mt-0",
                              isReviewed
                                ? "border-[#12B76A] bg-[#12B76A] text-white"
                                : "border-[#D0D5DD] bg-white text-transparent hover:border-[#4438E8]",
                            )}
                          >
                            <Check className="h-3 w-3" strokeWidth={2.75} aria-hidden="true" />
                          </button>

                          {/* Rank, Priority Badge, Title & Concise Metadata */}
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="inline-flex items-center rounded-md bg-[#F4F5F8] px-1.5 py-0.5 text-[11px] font-semibold text-[#525866] tabular-nums">
                                #{authoritativeRank}
                              </span>

                              <span
                                className={cn(
                                  "inline-flex items-center gap-1 rounded-full border px-2 py-px text-[11px] font-semibold",
                                  visual.pillClass,
                                )}
                              >
                                <visual.Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
                                <span>{visual.label}</span>
                              </span>

                              <h4
                                className={cn(
                                  "text-sm font-semibold text-[#17191F]",
                                  isReviewed && "line-through decoration-[#98A2B3] text-[#525866]",
                                )}
                              >
                                {item.title}
                              </h4>

                              <span
                                className={cn(
                                  "inline-flex items-center rounded-full border px-2 py-px text-[11px] font-medium",
                                  itemVerified
                                    ? "border-[#ABEFC6] bg-[#ECFDF3] text-[#067647]"
                                    : "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]",
                                )}
                              >
                                {itemVerified ? "Verified" : "Hypothesis"}
                              </span>
                            </div>

                            {density === "comfortable" && (
                              <p className={cn("mt-1 line-clamp-1", cc.metadata)}>
                                {item.severity} ·{" "}
                                {item.confidence.classification.replaceAll("_", " ")} confidence ·{" "}
                                {item.evidence_freshness.state}
                                {item.description ? ` — ${item.description}` : ""}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Row Quick Actions: Keyboard Reorder + Expand Details + Investigate */}
                        <div className="flex shrink-0 flex-wrap items-center gap-1.5 pl-7 sm:pl-0">
                          {orderedSecondary.length > 1 && (
                            <div className="inline-flex items-center rounded-lg border border-[#E7E9EF] bg-[#FAFBFD] p-0.5">
                              <button
                                type="button"
                                disabled={idx === 0}
                                aria-label={`Move ${item.title} up`}
                                onClick={() => moveSecondaryItem(item.id, -1)}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#525866] transition-colors hover:bg-white hover:text-[#17191F] disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4438E8]"
                              >
                                <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                disabled={idx === orderedSecondary.length - 1}
                                aria-label={`Move ${item.title} down`}
                                onClick={() => moveSecondaryItem(item.id, 1)}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#525866] transition-colors hover:bg-white hover:text-[#17191F] disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4438E8]"
                              >
                                <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            </div>
                          )}

                          <button
                            type="button"
                            aria-expanded={isExpanded}
                            aria-label={`${isExpanded ? "Hide" : "Show"} details for ${item.title}`}
                            onClick={() => toggleExpanded(item.id)}
                            className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[#E7E9EF] bg-white px-2.5 py-1.5 text-xs font-medium text-[#525866] transition-colors hover:border-[#D4D3FA] hover:bg-[#F7F6FF] hover:text-[#4438E8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4438E8]"
                          >
                            <span>Details</span>
                            <ChevronDown
                              className={cn(
                                "h-3.5 w-3.5 transition-transform duration-150 motion-reduce:transition-none",
                                isExpanded && "rotate-180",
                              )}
                              aria-hidden="true"
                            />
                          </button>

                          <button
                            type="button"
                            onClick={() => openRoute(item.investigation.route)}
                            className={cn(cc.secondary, "group/sec")}
                          >
                            <span>Investigate</span>
                            <ArrowRight
                              className="h-3.5 w-3.5 transition-transform duration-150 group-hover/sec:translate-x-0.5 motion-reduce:transition-none"
                              aria-hidden="true"
                            />
                          </button>
                        </div>
                      </div>

                      {/* Progressive Disclosure Drawer (Summary, Rationale, Observations, Recommended Step) */}
                      <AnimatePresence initial={false}>
                        {isExpanded && (
                          <motion.div
                            initial={prefersReducedMotion ? false : { opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={prefersReducedMotion ? undefined : { opacity: 0, height: 0 }}
                            transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
                            className="overflow-hidden"
                          >
                            <div
                              className={cn(
                                "grid gap-4 border-t bg-[#FAFBFD]/85 px-4 py-4 sm:grid-cols-2",
                                cc.divider,
                              )}
                            >
                              <div className="space-y-2.5">
                                {item.description && (
                                  <p className="text-xs leading-5 text-[#343844]">
                                    {item.description}
                                  </p>
                                )}
                                {item.priority.rationale.length > 0 && (
                                  <div>
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#707582]">
                                      Priority rationale
                                    </p>
                                    <ul className="mt-1 space-y-1 text-xs leading-5 text-[#525866]">
                                      {item.priority.rationale.map((reason) => (
                                        <li key={reason} className="flex gap-1.5">
                                          <span
                                            aria-hidden="true"
                                            className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[#4438E8]/60"
                                          />
                                          <span>{reason}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>

                              <div className="space-y-2.5">
                                {item.evidence.observations.length > 0 && (
                                  <dl className="grid grid-cols-2 gap-2">
                                    {item.evidence.observations.slice(0, 4).map((obs) => (
                                      <div
                                        key={`${obs.period}-${obs.label}`}
                                        className="rounded-lg border border-[#E7E9EF] bg-white px-2.5 py-2"
                                      >
                                        <dt className="truncate text-[10px] font-medium text-[#707582]">
                                          {obs.label}
                                        </dt>
                                        <dd className="mt-0.5 text-sm font-semibold text-[#17191F] tabular-nums">
                                          {observationText(obs)}
                                        </dd>
                                      </div>
                                    ))}
                                  </dl>
                                )}
                                {item.recommendation.available && item.recommendation.step && (
                                  <div className="rounded-lg border border-[#DCDAFA] bg-[#F7F6FF] px-3 py-2 text-xs leading-5 text-[#343844]">
                                    <span className="font-semibold text-[#4438E8]">
                                      Suggested next step:{" "}
                                    </span>
                                    {item.recommendation.step}
                                  </div>
                                )}
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </article>
                  </Reorder.Item>
                );
              })}
            </Reorder.Group>
          )}
        </div>
      )}
    </motion.section>
  );
}
