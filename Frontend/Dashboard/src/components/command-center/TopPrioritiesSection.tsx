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
  if (item.unit === "count" || item.unit === "status") {
    return `${item.value}`;
  }
  return `${item.value} ${item.unit}`;
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
  rankPillClass: string;
  primaryRankClass: string;
  borderLeftClass: string;
  rowTintClass: string;
  spotlightBgClass: string;
  dotClass: string;
  Icon: typeof Flame;
}

function getSeverityVisual(severity: Finding["severity"]): SeverityVisual {
  if (severity === "critical") {
    return {
      label: "Critical",
      pillClass: "border-[#FDA4AF] bg-[#FFE4E6] text-[#9F1239]",
      rankPillClass: "border-[#FDA4AF] bg-[#FFE4E6] text-[#9F1239]",
      primaryRankClass:
        "bg-gradient-to-br from-[#E11D48] to-[#B42318] text-white shadow-[0_4px_12px_-3px_rgba(225,29,72,0.5)]",
      borderLeftClass: "border-l-[#B42318]",
      rowTintClass: "hover:border-[#FDA4AF] hover:bg-[#FFF5F6]",
      spotlightBgClass: "bg-gradient-to-br from-[#FFF5F6] via-white to-[#F5F3FF]/55",
      dotClass: "bg-[#E11D48]",
      Icon: Flame,
    };
  }
  if (severity === "high") {
    return {
      label: "High",
      pillClass: "border-[#FCA5A5] bg-[#FEF2F2] text-[#B42318]",
      rankPillClass: "border-[#FECACA] bg-[#FEF2F2] text-[#B42318]",
      primaryRankClass:
        "bg-gradient-to-br from-[#DC2626] to-[#B42318] text-white shadow-[0_4px_12px_-3px_rgba(180,35,24,0.45)]",
      borderLeftClass: "border-l-[#B42318]",
      rowTintClass: "hover:border-[#FCA5A5] hover:bg-[#FFF7F7]",
      spotlightBgClass: "bg-gradient-to-br from-[#FFF6F5] via-white to-[#EEF2FF]/50",
      dotClass: "bg-[#DC2626]",
      Icon: AlertTriangle,
    };
  }
  if (severity === "medium") {
    return {
      label: "Medium",
      pillClass: "border-[#FCD34D] bg-[#FEF3C7] text-[#92400E]",
      rankPillClass: "border-[#FDE68A] bg-[#FEF3C7] text-[#92400E]",
      primaryRankClass:
        "bg-gradient-to-br from-[#F59E0B] to-[#D97706] text-white shadow-[0_4px_12px_-3px_rgba(217,119,6,0.45)]",
      borderLeftClass: "border-l-[#D97706]",
      rowTintClass: "hover:border-[#FCD34D] hover:bg-[#FFFBEB]",
      spotlightBgClass: "bg-gradient-to-br from-[#FFFBEB]/85 via-white to-[#EEF2FF]/45",
      dotClass: "bg-[#D97706]",
      Icon: Flag,
    };
  }
  return {
    label: "Low",
    pillClass: "border-[#A5B4FC] bg-[#E0E7FF] text-[#3730A3]",
    rankPillClass: "border-[#C7D2FE] bg-[#EEF2FF] text-[#4438E8]",
    primaryRankClass:
      "bg-gradient-to-br from-[#4438E8] to-[#6D28D9] text-white shadow-[0_4px_12px_-3px_rgba(68,56,232,0.45)]",
    borderLeftClass: "border-l-[#4438E8]",
    rowTintClass: "hover:border-[#A5B4FC] hover:bg-[#EEF2FF]/65",
    spotlightBgClass: "bg-gradient-to-br from-[#EEF2FF]/80 via-white to-[#F5F3FF]/50",
    dotClass: "bg-[#4438E8]",
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
    ? "from-[#E11D48] via-[#F97316] to-[#6366F1]"
    : finding
      ? "from-[#4438E8] via-[#7C3AED] to-[#06B6D4]"
      : "from-[#4438E8] via-[#7C3AED] to-[#38BDF8]";

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
            dotClass: "bg-[#E11D48]",
          },
        ]
      : []),
    ...(severityCounts.high > 0
      ? [
          {
            id: "high" as const,
            label: "High",
            count: severityCounts.high,
            dotClass: "bg-[#DC2626]",
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
        isCritical
          ? "border-[#FECDD3] shadow-[0_12px_32px_-16px_rgba(225,29,72,0.18)]"
          : "border-[#C7D2FE] shadow-[0_12px_32px_-16px_rgba(68,56,232,0.16)]",
      )}
    >
      {/* Vibrant 3px Top Semantic Gradient Rail */}
      <div
        aria-hidden="true"
        className={cn("h-[3px] w-full bg-gradient-to-r", topRailGradient)}
      />

      {/* Pointer-Tracking Luminous Aura */}
      {!prefersReducedMotion && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover/priority:opacity-100"
          style={{
            background: isCritical
              ? "radial-gradient(560px circle at var(--priority-mx, 50%) var(--priority-my, 0%), rgba(225,29,72,0.075), transparent 65%)"
              : "radial-gradient(560px circle at var(--priority-mx, 50%) var(--priority-my, 0%), rgba(68,56,232,0.085), transparent 65%)",
          }}
        />
      )}

      {/* Richly Tinted Editorial Header */}
      <div
        className={cn(
          "relative flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6",
          isCritical
            ? "border-[#FFE4E6] bg-gradient-to-r from-[#FFF1F2] via-[#FFF7ED]/70 to-[#EEF2FF]/80"
            : "border-[#E0E7FF] bg-gradient-to-r from-[#EEF2FF] via-[#F5F3FF] to-[#ECFEFF]/75",
        )}
      >
        <div className="flex min-w-0 items-center gap-3.5">
          <div
            aria-hidden="true"
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white",
              isCritical
                ? "bg-gradient-to-br from-[#E11D48] to-[#B42318] shadow-[0_8px_18px_-4px_rgba(225,29,72,0.48)]"
                : "bg-gradient-to-br from-[#4438E8] to-[#7C3AED] shadow-[0_8px_18px_-4px_rgba(68,56,232,0.48)]",
            )}
          >
            {isCritical ? (
              <ShieldAlert className="h-5 w-5" />
            ) : finding ? (
              <Target className="h-5 w-5" />
            ) : (
              <Radar className="h-5 w-5" />
            )}
          </div>
          <div className="min-w-0">
            <h2
              id="priority-findings-heading"
              className="text-base font-semibold tracking-[-0.02em] text-[#1E1B4B]"
            >
              Top priorities
            </h2>
            <p className="mt-0.5 text-[13px] leading-5 text-[#4B5565]">
              The most important issues identified across your store.
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <StateBadge state={sectionState} label={statusText} />
        </div>
      </div>

      {/* Vibrant Triage Toolbar (Filter by Priority, Sort, Compact/Cards View) */}
      {hasMultipleFindings && (
        <div
          role="toolbar"
          aria-label="Priority list filters and sorting"
          className="relative flex flex-col gap-2.5 border-b border-[#E0E7FF] bg-gradient-to-r from-[#F4F6FF] via-[#F7F5FF] to-[#F4F6FF] px-5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-6"
        >
          {/* Priority Level Filter Pills */}
          <div
            className="flex flex-wrap items-center gap-1.5"
            role="group"
            aria-label="Filter by priority level"
          >
            {filterOptions.map((option) => {
              const active = severityFilter === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSeverityFilter(option.id)}
                  className={cn(
                    "relative inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4438E8] focus-visible:ring-offset-1",
                    active
                      ? "text-white"
                      : "border border-[#DDE2F4] bg-white/90 text-[#374151] hover:border-[#A5B4FC] hover:bg-[#EEF2FF] hover:text-[#3730A3]",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId={prefersReducedMotion ? undefined : "priority-filter-active-pill"}
                      transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
                      aria-hidden="true"
                      className="absolute inset-0 rounded-full bg-gradient-to-r from-[#4438E8] to-[#6366F1] shadow-[0_4px_12px_-3px_rgba(68,56,232,0.5)]"
                    />
                  )}
                  <span className="relative inline-flex items-center gap-1.5">
                    {option.dotClass && (
                      <span
                        aria-hidden="true"
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          active ? "bg-white" : option.dotClass,
                        )}
                      />
                    )}
                    <span>{option.label}</span>
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums",
                        active
                          ? "bg-white/20 text-white"
                          : "bg-[#EEF2FF] text-[#4438E8]",
                      )}
                    >
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
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#C7D2FE] bg-white px-2.5 py-1 text-xs font-semibold text-[#3730A3] transition-colors hover:border-[#818CF8] hover:bg-[#EEF2FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4438E8]"
            >
              <ArrowDownUp className="h-3.5 w-3.5 text-[#4438E8]" aria-hidden="true" />
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
                className="inline-flex items-center gap-1 rounded-lg border border-[#A5B4FC] bg-[#EEF2FF] px-2.5 py-1 text-xs font-semibold text-[#4438E8] transition-colors hover:bg-[#4438E8] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4438E8]"
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                <span>Reset order</span>
              </button>
            )}

            <div
              className="inline-flex items-center rounded-lg border border-[#C7D2FE] bg-white p-0.5"
              role="group"
              aria-label="Queue row density"
            >
              <button
                type="button"
                aria-pressed={density === "comfortable"}
                aria-label="Comfortable card rows"
                onClick={() => setDensity("comfortable")}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4438E8]",
                  density === "comfortable"
                    ? "bg-[#4438E8] text-white"
                    : "text-[#525866] hover:text-[#3730A3]",
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
                  "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4438E8]",
                  density === "compact"
                    ? "bg-[#4438E8] text-white"
                    : "text-[#525866] hover:text-[#3730A3]",
                )}
              >
                <Rows3 className="h-3 w-3" aria-hidden="true" />
                <span className="hidden sm:inline">Compact</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tier 1: Richly Colored #1 Priority Spotlight */}
      {finding ? (
        showPrimaryUnderFilter ? (
          <article
            aria-labelledby="current-priority-title"
            className={cn(
              "relative border-l-[4px] px-5 py-5 transition-opacity duration-200 sm:px-6 sm:py-6",
              isCritical ? "border-l-[#B42318]" : "border-l-[#4438E8]",
              primarySeverityVisual?.spotlightBgClass,
              primaryReviewed && "opacity-90",
            )}
          >
            {/* Priority Signal Strip */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
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
                    "inline-flex h-5 w-5 items-center justify-center rounded-full border-2 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4438E8] focus-visible:ring-offset-1",
                    primaryReviewed
                      ? "border-[#059669] bg-[#059669] text-white"
                      : "border-[#A5B4FC] bg-white text-transparent hover:border-[#4438E8]",
                  )}
                >
                  <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
                </button>

                <span
                  className={cn(
                    "inline-flex items-center rounded-md px-2 py-0.5 font-bold tracking-tight tabular-nums",
                    primarySeverityVisual?.primaryRankClass,
                  )}
                >
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
                          className="absolute inline-flex h-full w-full rounded-full bg-[#E11D48] opacity-60"
                          animate={{ scale: [1, 1.9, 1], opacity: [0.65, 0, 0.65] }}
                          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
                        />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-[#E11D48]" />
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
                      ? "border-[#6EE7B7] bg-[#D1FAE5] text-[#065F46]"
                      : "border-[#FCD34D] bg-[#FEF3C7] text-[#92400E]",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      verified ? "bg-[#059669]" : "bg-[#D97706]",
                    )}
                  />
                  <span>{verified ? "Verified finding" : "Hypothesis"}</span>
                </span>

                <span className="inline-flex items-center rounded-full border border-[#C7D2FE] bg-[#EEF2FF] px-2.5 py-0.5 text-[#3730A3]">
                  {finding.confidence.classification.replaceAll("_", " ")} confidence
                </span>

                <span className="inline-flex items-center rounded-full border border-[#CBD5E1] bg-white/90 px-2.5 py-0.5 text-[#334155]">
                  {finding.evidence_freshness.state} evidence · {finding.coverage.state} coverage
                </span>
              </div>

              {primaryReviewed && (
                <span className="inline-flex items-center gap-1 rounded-full border border-[#6EE7B7] bg-[#D1FAE5] px-2.5 py-0.5 text-[11px] font-semibold text-[#065F46]">
                  <Check className="h-3 w-3" aria-hidden="true" />
                  <span>Reviewed</span>
                </span>
              )}
            </div>

            {/* 1. Primary Title & Summary */}
            <h3
              id="current-priority-title"
              className={cn(
                "mt-3.5 text-lg font-semibold leading-snug tracking-[-0.025em] text-[#1E1B4B] sm:text-[1.35rem]",
                primaryReviewed && "text-[#525866]",
              )}
            >
              {finding.title}
            </h3>
            <p className="mt-1.5 max-w-3xl text-sm leading-6 text-[#374151]">
              {finding.description}
            </p>

            {/* 2. Color-Differentiated Bento Rationale & Observations Grid */}
            <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.06fr)_minmax(0,0.94fr)]">
              <div className="space-y-3">
                {/* Indigo Rationale Card */}
                <div className="rounded-xl border border-[#C7D2FE] bg-gradient-to-br from-[#EEF2FF]/90 to-[#F5F3FF]/60 p-4">
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#4438E8] text-white"
                    >
                      <Target className="h-3.5 w-3.5" />
                    </span>
                    <h4 className="text-[13px] font-semibold text-[#1E1B4B]">
                      Why this is the priority
                    </h4>
                  </div>
                  <ul className="mt-2.5 space-y-1.5 text-xs leading-5">
                    {finding.priority.rationale.map((reason) => (
                      <li key={reason} className="flex gap-2">
                        <span
                          aria-hidden="true"
                          className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#4438E8]"
                        />
                        <span className="text-[#312E81]">{reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Emerald Confidence Card */}
                <div className="rounded-xl border border-[#A7F3D0] bg-gradient-to-br from-[#ECFDF5]/95 to-[#F0FDF4]/60 p-4">
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#059669] text-white"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" />
                    </span>
                    <h4 className="text-[13px] font-semibold text-[#064E3B]">Confidence</h4>
                  </div>
                  <ul className="mt-2.5 space-y-1.5 text-xs leading-5">
                    {finding.confidence.rationale.map((reason) => (
                      <li key={reason} className="flex gap-2">
                        <span
                          aria-hidden="true"
                          className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#059669]"
                        />
                        <span className="text-[#065F46]">{reason}</span>
                      </li>
                    ))}
                  </ul>
                  {finding.priority.tie && (
                    <p className="mt-2.5 rounded-lg border border-[#A7F3D0] bg-white/85 px-3 py-2 text-xs leading-5 text-[#065F46]">
                      {finding.priority.tie.statement}
                    </p>
                  )}
                </div>

                {/* Warm Amber Limitations Card */}
                {finding.limitations.length > 0 && (
                  <div className="rounded-xl border border-[#FCD34D]/80 bg-gradient-to-br from-[#FFFBEB] to-[#FEF3C7]/55 p-4">
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#D97706] text-white"
                      >
                        <AlertCircle className="h-3.5 w-3.5" />
                      </span>
                      <h4 className="text-[13px] font-semibold text-[#78350F]">
                        Limits of this conclusion
                      </h4>
                    </div>
                    <ul className="mt-2.5 space-y-1.5 text-xs leading-5">
                      {finding.limitations.map((limit) => (
                        <li key={limit} className="flex gap-2">
                          <span
                            aria-hidden="true"
                            className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#D97706]"
                          />
                          <span className="text-[#92400E]">{limit}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Luminous Cobalt-Indigo Supporting Observations Deck */}
              <div className="flex flex-col justify-between rounded-xl border border-[#C7D2FE] bg-gradient-to-b from-[#EEF2FF]/90 via-[#F5F7FF] to-[#E0E7FF]/45 p-4">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-[13px] font-semibold text-[#1E1B4B]">
                      Supporting observations
                    </h4>
                    <span className="rounded-full border border-[#C7D2FE] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#4438E8]">
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
                        className="relative min-w-0 overflow-hidden rounded-xl border border-[#D8DDF8] bg-white px-3.5 py-3 shadow-[0_2px_10px_-4px_rgba(68,56,232,0.12)] transition-colors duration-150 hover:border-[#818CF8]"
                      >
                        <div
                          aria-hidden="true"
                          className={cn(
                            "absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r",
                            isCritical
                              ? "from-[#E11D48]/80 to-[#F97316]/60"
                              : "from-[#4438E8]/80 to-[#7C3AED]/60",
                          )}
                        />
                        <dt className="text-[11px] font-semibold text-[#4F46E5]">
                          {item.label}
                        </dt>
                        <dd className="mt-1.5 break-words text-[1.0625rem] font-bold tracking-[-0.02em] text-[#1E1B4B] tabular-nums">
                          {observationText(item)}
                        </dd>
                      </motion.div>
                    ))}
                  </dl>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-[#C7D2FE]/70 pt-3 text-[11px] font-medium text-[#4338CA] tabular-nums">
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="h-3 w-3 shrink-0 text-[#6366F1]" aria-hidden="true" />
                    <span>
                      {finding.reporting_period.kind.replaceAll("_", " ")} ·{" "}
                      {finding.reporting_period.timezone}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="h-3 w-3 shrink-0 text-[#6366F1]" aria-hidden="true" />
                    <span>Last verified {dateTime(finding.last_verified_at)}</span>
                  </span>
                </div>
              </div>
            </div>

            {/* 3. Vibrant Indigo-Violet Recommended Next Step Callout */}
            <div className="mt-5 rounded-xl border border-[#A5B4FC] border-l-[4px] border-l-[#4438E8] bg-gradient-to-r from-[#EEF2FF] via-[#F3E8FF]/70 to-[#E0E7FF]/80 p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#4438E8] to-[#7C3AED] text-white shadow-[0_4px_12px_-3px_rgba(68,56,232,0.5)]"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                </span>
                <h4 className="text-[13px] font-semibold text-[#1E1B4B]">
                  Recommended next step{" "}
                  <span className="font-normal text-[#4338CA]">
                    · merchant action, not executed by Revluma
                  </span>
                </h4>
              </div>
              {finding.recommendation.available ? (
                <div className="mt-2.5 space-y-2.5">
                  <p className="text-sm font-medium leading-6 text-[#1E1B4B]">
                    {finding.recommendation.step}
                  </p>
                  {(finding.recommendation.rationale ||
                    finding.recommendation.expected_result) && (
                    <div className="grid gap-2.5 pt-0.5 sm:grid-cols-2">
                      {finding.recommendation.rationale && (
                        <p className="rounded-lg border border-[#C7D2FE] bg-white/85 px-3 py-2 text-xs leading-5 text-[#374151]">
                          <span className="font-semibold text-[#3730A3]">Why it matters: </span>
                          {finding.recommendation.rationale}
                        </p>
                      )}
                      {finding.recommendation.expected_result && (
                        <p className="rounded-lg border border-[#C7D2FE] bg-white/85 px-3 py-2 text-xs leading-5 text-[#374151]">
                          <span className="font-semibold text-[#3730A3]">Look for: </span>
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
                  "inline-flex list-none items-center gap-1.5 rounded-lg border border-[#C7D2FE] bg-[#EEF2FF]/70 px-3 py-1.5 transition-colors hover:border-[#818CF8] hover:bg-[#E0E7FF] [&::-webkit-details-marker]:hidden",
                  cc.disclosure,
                )}
              >
                <ChevronDown
                  className="h-3.5 w-3.5 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
                  aria-hidden="true"
                />
                Inspect evidence, provenance and uncertainty
              </summary>
              <div className="mt-3 grid gap-5 rounded-xl border border-[#C7D2FE] bg-[#F5F7FF] p-4 sm:grid-cols-2">
                <div>
                  <h4 className="text-[13px] font-semibold text-[#1E1B4B]">
                    Authoritative references
                  </h4>
                  <ul className={cn("mt-2 space-y-2 break-all", cc.metadata)}>
                    {finding.evidence.references.map((ref) => (
                      <li
                        key={ref.id}
                        className="rounded-lg border border-[#D8DDF8] bg-white px-3 py-2"
                      >
                        <span className="font-semibold text-[#1E1B4B]">{ref.source_type}</span>
                        <br />
                        <span className="font-mono text-[11px] text-[#4338CA]">
                          {ref.source_record_id}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className={cn("mt-3 font-mono text-[11px]", cc.metadata)}>
                    Method: {finding.priority.method_version}
                  </p>
                </div>
                <div>
                  <h4 className="text-[13px] font-semibold text-[#1E1B4B]">
                    Lifecycle and unknowns
                  </h4>
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
            <div className="mt-5 flex flex-col gap-3 border-t border-[#E0E7FF] pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-5 text-[#4B5565]">
                {finding.recommendation.validation_method ||
                  "Further evidence is required before a current recommendation."}
              </p>
              <motion.button
                type="button"
                whileHover={prefersReducedMotion ? undefined : { y: -1.5 }}
                whileTap={prefersReducedMotion ? undefined : { scale: 0.985 }}
                onClick={() => openRoute(finding.investigation.route)}
                className={cn(
                  cc.primary,
                  "group/cta bg-gradient-to-r from-[#4438E8] via-[#4F46E5] to-[#6D28D9] shadow-[0_10px_24px_-8px_rgba(68,56,232,0.55)] transition-all duration-200 hover:shadow-[0_14px_28px_-8px_rgba(68,56,232,0.65)]",
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
          <div className="flex flex-wrap items-center justify-between gap-3 bg-[#EEF2FF]/50 px-5 py-4 text-xs text-[#374151] sm:px-6">
            <span>
              Top priority (
              <strong className="font-semibold text-[#1E1B4B]">#1 {finding.title}</strong>) is
              hidden by the{" "}
              <strong className="font-semibold capitalize text-[#4438E8]">
                {severityFilter}
              </strong>{" "}
              filter.
            </span>
            <button
              type="button"
              onClick={() => setSeverityFilter("all")}
              className="rounded-lg bg-[#4438E8] px-3 py-1 text-xs font-semibold text-white hover:bg-[#372DD1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4438E8]"
            >
              Show all priorities
            </button>
          </div>
        )
      ) : (
        /* Color-Rich Calm Monitoring Empty State */
        <div className="relative overflow-hidden bg-gradient-to-b from-white via-[#FAF9FF] to-[#EEF2FF]/45">
          {/* Tinted Architectural Dot-Matrix Backdrop */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-[0.4]"
            style={{
              backgroundImage: "radial-gradient(#A5B4FC 0.9px, transparent 0.9px)",
              backgroundSize: "18px 18px",
              maskImage:
                "radial-gradient(ellipse 68% 95% at 88% 46%, black 0%, rgba(0,0,0,0.28) 55%, transparent 100%)",
              WebkitMaskImage:
                "radial-gradient(ellipse 68% 95% at 88% 46%, black 0%, rgba(0,0,0,0.28) 55%, transparent 100%)",
            }}
          />

          {/* Color-Coded Priority Tier Summary Rail (Factual 0 Counts) */}
          <div
            aria-label="Priority tier summary"
            className="relative grid grid-cols-1 divide-y divide-[#E0E7FF] border-b border-[#E0E7FF] sm:grid-cols-3 sm:divide-x sm:divide-y-0"
          >
            {[
              {
                key: "urgent",
                label: "Critical & High",
                caption: "Immediate revenue or operational impact",
                Icon: Flame,
                cellBg: "bg-gradient-to-r from-[#FFF1F2]/90 to-[#FFE4E6]/40",
                iconClass:
                  "bg-gradient-to-br from-[#E11D48] to-[#B42318] text-white shadow-[0_4px_10px_-3px_rgba(225,29,72,0.45)]",
                countClass: "border-[#FDA4AF] bg-white text-[#9F1239]",
                dotClass: "bg-[#E11D48]",
              },
              {
                key: "medium",
                label: "Medium",
                caption: "Developing shifts meeting evidence rules",
                Icon: Flag,
                cellBg: "bg-gradient-to-r from-[#FFFBEB]/90 to-[#FEF3C7]/40",
                iconClass:
                  "bg-gradient-to-br from-[#F59E0B] to-[#D97706] text-white shadow-[0_4px_10px_-3px_rgba(217,119,6,0.45)]",
                countClass: "border-[#FCD34D] bg-white text-[#92400E]",
                dotClass: "bg-[#D97706]",
              },
              {
                key: "watch",
                label: "Low & Watch",
                caption: "Early verified signals under observation",
                Icon: CircleDot,
                cellBg: "bg-gradient-to-r from-[#EEF2FF]/90 to-[#E0E7FF]/45",
                iconClass:
                  "bg-gradient-to-br from-[#4438E8] to-[#7C3AED] text-white shadow-[0_4px_10px_-3px_rgba(68,56,232,0.45)]",
                countClass: "border-[#A5B4FC] bg-white text-[#3730A3]",
                dotClass: "bg-[#4438E8]",
              },
            ].map((tier) => (
              <div
                key={tier.key}
                className={cn(
                  "flex items-center justify-between gap-3 px-5 py-3.5 sm:px-6",
                  tier.cellBg,
                )}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
                      tier.iconClass,
                    )}
                  >
                    <tier.Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-[#1E1B4B]">{tier.label}</p>
                    <p className="truncate text-[11px] text-[#4B5565]">{tier.caption}</p>
                  </div>
                </div>
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold tabular-nums",
                    tier.countClass,
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn("h-1.5 w-1.5 rounded-full opacity-60", tier.dotClass)}
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
                <div
                  aria-hidden="true"
                  className="relative mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#4438E8] to-[#7C3AED] text-white shadow-[0_10px_24px_-6px_rgba(68,56,232,0.5)]"
                >
                  {!prefersReducedMotion && (
                    <motion.span
                      className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-[#6366F1]/50"
                      animate={{ scale: [1, 1.32, 1.32], opacity: [0.55, 0, 0] }}
                      transition={{
                        duration: 3.2,
                        repeat: Infinity,
                        ease: "easeOut",
                      }}
                    />
                  )}
                  <ShieldCheck className="relative h-5 w-5" />
                </div>

                <div className="min-w-0">
                  <p className="text-[15px] font-semibold tracking-[-0.015em] text-[#1E1B4B]">
                    No verified priorities right now
                  </p>
                  <p className="mt-1 text-[13px] leading-5 text-[#4B5565]">
                    No findings currently meet the evidence threshold. This doesn&apos;t mean there
                    are no business problems. Further investigation may uncover issues.
                  </p>
                  {data.priority_selection.reason &&
                    !data.priority_selection.reason
                      .toLowerCase()
                      .includes("no open verified findings are recorded") && (
                      <p className="mt-1.5 text-xs leading-5 text-[#6366F1]">
                        {data.priority_selection.reason}
                      </p>
                    )}

                  {/* Colored Authoritative Monitoring Scope Chips */}
                  <div className="mt-3.5 flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                    {availableResourceCount > 0 && (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#C7D2FE] bg-[#EEF2FF] px-2.5 py-0.5 text-[#3730A3] tabular-nums">
                        <Database className="h-3 w-3 text-[#4438E8]" aria-hidden="true" />
                        <span>
                          {availableResourceCount}{" "}
                          {availableResourceCount === 1 ? "source" : "sources"} monitored
                        </span>
                      </span>
                    )}
                    {reportingPeriodLabel && (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#A7F3D0] bg-[#ECFDF5] px-2.5 py-0.5 text-[#065F46]">
                        <Calendar className="h-3 w-3 text-[#059669]" aria-hidden="true" />
                        <span>{reportingPeriodLabel}</span>
                      </span>
                    )}
                    <button
                      type="button"
                      aria-expanded={showTierGuide}
                      onClick={() => setShowTierGuide((prev) => !prev)}
                      className="inline-flex items-center gap-1 rounded-full border border-[#DDD6FE] bg-[#F5F3FF] px-2.5 py-0.5 text-[11px] font-semibold text-[#6D28D9] transition-colors hover:border-[#A78BFA] hover:bg-[#EDE9FE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4438E8]"
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
                  cc.primary,
                  "group/explore self-start rounded-xl bg-gradient-to-r from-[#4438E8] via-[#4F46E5] to-[#7C3AED] px-4 py-2.5 shadow-[0_10px_24px_-8px_rgba(68,56,232,0.52)] transition-all duration-200 hover:shadow-[0_14px_28px_-8px_rgba(68,56,232,0.65)] sm:self-center",
                )}
              >
                <Compass className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Explore with Rev Intell</span>
                <ArrowRight
                  className="h-3.5 w-3.5 transition-transform duration-200 group-hover/explore:translate-x-0.5 motion-reduce:transition-none"
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
                  <div className="mt-4 grid gap-3 rounded-xl border border-[#C7D2FE] bg-[#EEF2FF]/65 p-4 sm:grid-cols-3">
                    <div className="rounded-lg border border-[#C7D2FE] bg-white p-3">
                      <p className="text-xs font-semibold text-[#3730A3]">
                        1. Evidence-threshold gated
                      </p>
                      <p className="mt-1 text-xs leading-5 text-[#4B5565]">
                        Only findings backed by fresh, synchronized store records are promoted into
                        your priority queue.
                      </p>
                    </div>
                    <div className="rounded-lg border border-[#A7F3D0] bg-white p-3">
                      <p className="text-xs font-semibold text-[#065F46]">
                        2. Single #1 focus first
                      </p>
                      <p className="mt-1 text-xs leading-5 text-[#4B5565]">
                        The highest-impact verified issue surfaces at the top with full rationale,
                        observations, and limits.
                      </p>
                    </div>
                    <div className="rounded-lg border border-[#DDD6FE] bg-white p-3">
                      <p className="text-xs font-semibold text-[#6D28D9]">
                        3. Progressive triage queue
                      </p>
                      <p className="mt-1 text-xs leading-5 text-[#4B5565]">
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
              <div className="relative mt-5 border-t border-[#E0E7FF] pt-4">
                <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#4338CA]">
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
                      className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-[#E0E7FF] bg-white/85 px-3.5 py-2.5"
                    >
                      <span>
                        <span className="font-semibold text-[#1E1B4B]">{item.title}</span> — not
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

      {/* Tier 2: Color-Coded, Reorderable, Expandable Ranked Priority Queue */}
      {secondary.length > 0 && (
        <div className="relative border-t border-[#D8DDF8] bg-gradient-to-b from-[#EEF2FC] to-[#F4F6FD] px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-[#3730A3]">
                Other eligible findings
              </h3>
              <span className="rounded-full bg-[#4438E8] px-2 py-0.5 text-[11px] font-bold text-white tabular-nums">
                {orderedSecondary.length}
              </span>
            </div>
            {orderedSecondary.length > 1 && (
              <span className="text-[11px] font-medium text-[#4F46E5]">
                Drag or use arrows to arrange your review order
              </span>
            )}
          </div>

          {orderedSecondary.length === 0 ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-[#A5B4FC] bg-white px-4 py-3 text-xs text-[#4B5565]">
              <span>
                No secondary findings match the{" "}
                <strong className="font-semibold capitalize text-[#1E1B4B]">
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
              className="mt-3 space-y-2.5"
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
                        "rounded-xl border border-[#D8DDF8] border-l-[4px] bg-white shadow-[0_2px_10px_-4px_rgba(68,56,232,0.12)] transition-all duration-150",
                        visual.borderLeftClass,
                        visual.rowTintClass,
                        isReviewed && "opacity-80",
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
                          {orderedSecondary.length > 1 && (
                            <span
                              aria-hidden="true"
                              title="Drag to reorder"
                              className="mt-0.5 hidden shrink-0 cursor-grab text-[#94A3B8] transition-colors hover:text-[#4438E8] active:cursor-grabbing sm:mt-0 sm:inline-flex"
                            >
                              <GripVertical className="h-4 w-4" />
                            </span>
                          )}

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
                              "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4438E8] focus-visible:ring-offset-1 sm:mt-0",
                              isReviewed
                                ? "border-[#059669] bg-[#059669] text-white"
                                : "border-[#A5B4FC] bg-white text-transparent hover:border-[#4438E8]",
                            )}
                          >
                            <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
                          </button>

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={cn(
                                  "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-bold tabular-nums",
                                  visual.rankPillClass,
                                )}
                              >
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
                                  "text-sm font-semibold text-[#1E1B4B]",
                                  isReviewed && "line-through decoration-[#94A3B8] text-[#64748B]",
                                )}
                              >
                                {item.title}
                              </h4>

                              <span
                                className={cn(
                                  "inline-flex items-center rounded-full border px-2 py-px text-[11px] font-semibold",
                                  itemVerified
                                    ? "border-[#6EE7B7] bg-[#D1FAE5] text-[#065F46]"
                                    : "border-[#FCD34D] bg-[#FEF3C7] text-[#92400E]",
                                )}
                              >
                                {itemVerified ? "Verified" : "Hypothesis"}
                              </span>
                            </div>

                            {density === "comfortable" && (
                              <p className="mt-1 line-clamp-1 text-xs leading-5 text-[#4B5565]">
                                {item.severity} ·{" "}
                                {item.confidence.classification.replaceAll("_", " ")} confidence ·{" "}
                                {item.evidence_freshness.state}
                                {item.description ? ` — ${item.description}` : ""}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Row Quick Actions */}
                        <div className="flex shrink-0 flex-wrap items-center gap-1.5 pl-7 sm:pl-0">
                          {orderedSecondary.length > 1 && (
                            <div className="inline-flex items-center rounded-lg border border-[#D8DDF8] bg-[#F5F7FF] p-0.5">
                              <button
                                type="button"
                                disabled={idx === 0}
                                aria-label={`Move ${item.title} up`}
                                onClick={() => moveSecondaryItem(item.id, -1)}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#4338CA] transition-colors hover:bg-white hover:text-[#1E1B4B] disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4438E8]"
                              >
                                <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                disabled={idx === orderedSecondary.length - 1}
                                aria-label={`Move ${item.title} down`}
                                onClick={() => moveSecondaryItem(item.id, 1)}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#4338CA] transition-colors hover:bg-white hover:text-[#1E1B4B] disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4438E8]"
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
                            className={cn(
                              "inline-flex min-h-9 items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4438E8]",
                              isExpanded
                                ? "border-[#818CF8] bg-[#E0E7FF] text-[#3730A3]"
                                : "border-[#D8DDF8] bg-white text-[#4338CA] hover:border-[#818CF8] hover:bg-[#EEF2FF]",
                            )}
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
                            className={cn(
                              cc.secondary,
                              "group/sec border-[#A5B4FC] bg-[#EEF2FF] font-semibold text-[#4438E8] hover:border-[#4438E8] hover:bg-[#4438E8] hover:text-white",
                            )}
                          >
                            <span>Investigate</span>
                            <ArrowRight
                              className="h-3.5 w-3.5 transition-transform duration-150 group-hover/sec:translate-x-0.5 motion-reduce:transition-none"
                              aria-hidden="true"
                            />
                          </button>
                        </div>
                      </div>

                      {/* Progressive Disclosure Drawer */}
                      <AnimatePresence initial={false}>
                        {isExpanded && (
                          <motion.div
                            initial={prefersReducedMotion ? false : { opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={prefersReducedMotion ? undefined : { opacity: 0, height: 0 }}
                            transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
                            className="overflow-hidden"
                          >
                            <div className="grid gap-4 border-t border-[#E0E7FF] bg-gradient-to-br from-[#F5F7FF] to-[#EEF2FF]/50 px-4 py-4 sm:grid-cols-2">
                              <div className="space-y-2.5">
                                {item.description && (
                                  <p className="text-xs leading-5 text-[#1E1B4B]">
                                    {item.description}
                                  </p>
                                )}
                                {item.priority.rationale.length > 0 && (
                                  <div>
                                    <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#4338CA]">
                                      Priority rationale
                                    </p>
                                    <ul className="mt-1 space-y-1 text-xs leading-5 text-[#374151]">
                                      {item.priority.rationale.map((reason) => (
                                        <li key={reason} className="flex gap-1.5">
                                          <span
                                            aria-hidden="true"
                                            className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#4438E8]"
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
                                        className="rounded-lg border border-[#C7D2FE] bg-white px-2.5 py-2"
                                      >
                                        <dt className="truncate text-[10px] font-semibold text-[#4F46E5]">
                                          {obs.label}
                                        </dt>
                                        <dd className="mt-0.5 break-words text-sm font-bold text-[#1E1B4B] tabular-nums">
                                          {observationText(obs)}
                                        </dd>
                                      </div>
                                    ))}
                                  </dl>
                                )}
                                {item.recommendation.available && item.recommendation.step && (
                                  <div className="rounded-lg border border-[#A5B4FC] bg-gradient-to-r from-[#EEF2FF] to-[#F3E8FF]/65 px-3 py-2 text-xs leading-5 text-[#1E1B4B]">
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
