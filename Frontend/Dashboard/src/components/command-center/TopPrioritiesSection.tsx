import { type MouseEvent, useCallback, useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  AlertCircle,
  ArrowRight,
  Calendar,
  ChevronDown,
  Clock,
  Compass,
  Database,
  Radar,
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

const EASE_OUT_EXPO = [0.22, 1, 0.36, 1] as const;

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

function severityPillClass(severity: Finding["severity"]): string {
  if (severity === "critical" || severity === "high") {
    return "border-[#FECACA] bg-[#FEF2F2] text-[#B42318]";
  }
  if (severity === "medium") {
    return "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]";
  }
  return "border-[#D4D3FA] bg-[#EEF0FF] text-[#4438E8]";
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
  const secondary = (data.findings || []).filter((item) => item.id !== finding?.id);
  const eligibleCount = data.priority_selection.eligible_count;
  const isCritical = Boolean(finding && ["critical", "high"].includes(finding.severity));
  const verified = finding ? isVerifiedFinding(finding) : false;

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
    ? "from-[#DC2626] via-[#F97316]/75 to-transparent"
    : finding
      ? "from-[#4438E8] via-[#7B72F8]/75 to-transparent"
      : "from-[#4438E8]/55 via-[#8E86FA]/30 to-transparent";

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
      {/* Precision Top Editorial Accent Rail */}
      <div
        aria-hidden="true"
        className={cn("h-[2px] w-full bg-gradient-to-r", topRailGradient)}
      />

      {/* Subtle Pointer-Tracking Ambient Aura (Linear / HorizonX polish) */}
      {!prefersReducedMotion && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover/priority:opacity-100"
          style={{
            background: isCritical
              ? "radial-gradient(520px circle at var(--priority-mx, 50%) var(--priority-my, 0%), rgba(220,38,38,0.045), transparent 65%)"
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

      {/* Populated Ranked Priority Card */}
      {finding ? (
        <article
          aria-labelledby="current-priority-title"
          className={cn(
            "relative border-l-[3px] px-5 py-5 sm:px-6 sm:py-6",
            isCritical ? "border-l-[#B42318]" : "border-l-[#4438E8]",
          )}
        >
          {/* Rank, Severity, Verification & Freshness Metadata Strip */}
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium">
            <span className="inline-flex items-center rounded-md bg-[#17191F] px-2 py-0.5 font-semibold tracking-tight text-white tabular-nums">
              #1
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-semibold capitalize",
                severityPillClass(finding.severity),
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
                <ShieldAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
              )}
              <span>{finding.priority.classification} priority</span>
            </span>
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

          {/* 1. Title & Description */}
          <h3
            id="current-priority-title"
            className="mt-3.5 text-lg font-semibold leading-snug tracking-[-0.025em] text-[#17191F] sm:text-[1.3125rem]"
          >
            {finding.title}
          </h3>
          <p className={cn("mt-1.5 max-w-3xl", cc.body)}>{finding.description}</p>

          {/* 3, 4, 5. Asymmetric Bento Evidence & Rationale Grid */}
          <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.06fr)_minmax(0,0.94fr)]">
            <div className="space-y-3">
              <div className="rounded-xl border border-[#ECEEF4] bg-[#FAFBFD] p-4">
                <div className="flex items-center gap-2">
                  <Target className="h-3.5 w-3.5 shrink-0 text-[#4438E8]" aria-hidden="true" />
                  <h4 className={cc.cardTitle}>Why this is the priority</h4>
                </div>
                <ul className={cn("mt-2 space-y-1.5", cc.metadata)}>
                  {finding.priority.rationale.map((reason) => (
                    <li key={reason} className="flex gap-2">
                      <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[#4438E8]/60" />
                      <span className="text-[#343844]">{reason}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-xl border border-[#ECEEF4] bg-[#FAFBFD] p-4">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[#067647]" aria-hidden="true" />
                  <h4 className={cc.cardTitle}>Confidence</h4>
                </div>
                <ul className={cn("mt-2 space-y-1.5", cc.metadata)}>
                  {finding.confidence.rationale.map((reason) => (
                    <li key={reason} className="flex gap-2">
                      <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[#98A2B3]" />
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
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 text-[#92400E]" aria-hidden="true" />
                    <h4 className={cc.cardTitle}>Limits of this conclusion</h4>
                  </div>
                  <ul className={cn("mt-2 space-y-1.5", cc.metadata)}>
                    {finding.limitations.map((limit) => (
                      <li key={limit} className="flex gap-2">
                        <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[#D97706]/70" />
                        <span className="text-[#525866]">{limit}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Tactile KPI / Observation Deck */}
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

          {/* 6. Recommended Next Investigation / Action — Signature Indigo Callout */}
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
                {(finding.recommendation.rationale || finding.recommendation.expected_result) && (
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

          {/* Expandable Provenance & Uncertainty (Native <details>/<summary>) */}
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

          {/* 7. Investigation Handoff Bar */}
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
        /* Flagship Calm Monitoring Empty State — Architectural Depth & Live Radar Presence */
        <div className="relative overflow-hidden px-5 py-6 sm:px-6">
          {/* Ultra-subtle dot-matrix architectural texture fading cleanly into white */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-[0.32]"
            style={{
              backgroundImage: "radial-gradient(#C7CCD8 0.85px, transparent 0.85px)",
              backgroundSize: "18px 18px",
              maskImage:
                "radial-gradient(ellipse 68% 95% at 88% 50%, black 0%, rgba(0,0,0,0.28) 55%, transparent 100%)",
              WebkitMaskImage:
                "radial-gradient(ellipse 68% 95% at 88% 50%, black 0%, rgba(0,0,0,0.28) 55%, transparent 100%)",
            }}
          />

          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
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

                {/* Authoritative Monitoring Scope Strip (strictly factual, never fabricated) */}
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
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E7E9EF] bg-[#FAFBFD] px-2.5 py-0.5">
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 rounded-full bg-[#4438E8]/70"
                    />
                    <span>Evidence-threshold gated</span>
                  </span>
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

          {data.priority_selection.exclusions.length > 0 && (
            <div className={cn("relative mt-5 border-t pt-4", cc.divider)}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#707582]">
                Excluded historical findings
              </p>
              <ul
                className={cn("mt-2.5 space-y-2", cc.metadata)}
                aria-label="Findings excluded from current priority"
              >
                {data.priority_selection.exclusions.map((item) => (
                  <li
                    key={item.finding_id}
                    className="rounded-lg border border-[#ECEEF4] bg-[#FAFBFD] px-3 py-2"
                  >
                    <span className="font-semibold text-[#17191F]">{item.title}</span> — not
                    current: {item.reason.replaceAll("_", " ")}. Historical evidence is not
                    presented as a current condition.
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Additional Ranked Eligible Priorities */}
      {secondary.length > 0 && (
        <div className={cn("relative border-t bg-[#FAFBFD] px-5 py-4 sm:px-6", cc.divider)}>
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[#707582]">
            Other eligible findings
          </h3>
          <div className="mt-3 space-y-2">
            {secondary.map((item, idx) => {
              const itemVerified = isVerifiedFinding(item);
              return (
                <motion.article
                  key={item.id}
                  initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.26,
                    delay: prefersReducedMotion ? 0 : idx * 0.04,
                    ease: EASE_OUT_EXPO,
                  }}
                  className="flex flex-col gap-3 rounded-xl border border-[#E7E9EF] bg-white px-4 py-3 transition-colors duration-150 hover:border-[#D4D3FA] sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center rounded-md bg-[#F4F5F8] px-1.5 py-0.5 text-[11px] font-semibold text-[#525866] tabular-nums">
                        #{idx + 2}
                      </span>
                      <h4 className="text-sm font-semibold text-[#17191F]">{item.title}</h4>
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
                    <p className={cn("mt-1", cc.metadata)}>
                      {item.severity} · {item.confidence.classification.replaceAll("_", " ")}{" "}
                      confidence · {item.evidence_freshness.state}
                    </p>
                  </div>
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
                </motion.article>
              );
            })}
          </div>
        </div>
      )}
    </motion.section>
  );
}
