import { type MouseEvent, useEffect, useRef, useState } from "react";
import { animate, motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  ChevronDown,
  Eye,
  Gauge,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Siren,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { StateBadge, type CommandCenterAppState } from "./StateBadge";
import { cc } from "./tokens";
import type { Finding, SignalCategoryId } from "./types";

/**
 * PriorityFindingCard: Premium Hybrid Intelligence Card.
 *
 * Direction decision (brief asked for A/B/C exploration):
 * - A Luminous Intelligence Card: beautiful glow craft, but full neon treatment
 *   overwhelms a dense operational surface.
 * - B Premium Dark Intelligence Card: strongest drama, but clashes with the light
 *   Command Center workspace and hurts list scannability.
 * - C Premium Hybrid Card: light layered surface + deep violet accent areas +
 *   severity-coded identity + selective luminous details. Chosen, fused with A's
 *   luminous frame and edge-light hover behavior.
 *
 * Contract notes (do not break):
 * - Root stays a motion.article carrying data-severity / data-priority-primary.
 * - Rank renders as "#N", verification states keep their exact labels.
 * - Primary title is h3, secondary titles are h4.
 * - Observation values, recommendation step/expected result, period label,
 *   confidence text, epistemic trio, and provenance stay in the DOM (tests and
 *   assistive tech query them without opening the disclosure), each exactly once.
 * - Disclosure trigger keeps its exact label and stays a native SUMMARY.
 * - CTA labels: "Ask Rev about this" (primary), backend next_step label when
 *   meaningful, otherwise "Investigate with Rev" (secondary).
 */

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

const SIGNAL_CATEGORY_LABELS: Record<SignalCategoryId, string> = {
  storefront_readiness: "Storefront readiness",
  traffic_acquisition: "Traffic & acquisition",
  sales_revenue: "Sales & revenue",
  conversion_purchasing: "Conversion & purchasing",
  product_inventory: "Product & inventory",
  customer_fulfillment: "Customer & fulfillment",
};

/** Backend CTA labels considered generic; replaced by the designed default. */
const GENERIC_NEXT_STEP_LABELS = new Set(["Investigate with Rev"]);

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

const relativeTime = (value: string | null) => {
  if (!value) return "Recently";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "Recently";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  const days = Math.floor(minutes / 1440);
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
};

type Observation = Finding["evidence"]["observations"][number];

function observationText(item: Observation): string {
  if (item.value === null || item.availability !== "available") return "Unavailable";
  if (item.unit === "money" && typeof item.value === "number" && item.currency) {
    return money(item.value, item.currency);
  }
  if (item.unit === "count" || item.unit === "status") {
    return `${item.value}`;
  }
  if (item.unit === "percent" && typeof item.value === "number") {
    return `${item.value}%`;
  }
  return `${item.value} ${item.unit}`;
}

/** Composite single-element rendering so expanded rows never duplicate strip values. */
function observationComposite(item: Observation): string {
  return `${item.label}: ${observationText(item)} (${item.period})`;
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

function formatSourceLabel(source: string): string {
  return source.replaceAll("_", " ");
}

interface SeverityMeta {
  label: string;
  longLabel: string;
  base: string;
  deep: string;
  softBg: string;
  border: string;
  glowRgba: string;
  frameFrom: string;
  impactBars: number;
  Icon: typeof Siren;
}

function getSeverityMeta(severity: Finding["severity"]): SeverityMeta {
  if (severity === "critical") {
    return {
      label: "Critical",
      longLabel: "Critical priority",
      base: "#E5484D",
      deep: "#A12A22",
      softBg: "#FFF5F4",
      border: "#F3C7C3",
      glowRgba: "rgba(229, 72, 77, 0.16)",
      frameFrom: "rgba(229, 72, 77, 0.55)",
      impactBars: 3,
      Icon: Siren,
    };
  }
  if (severity === "high") {
    return {
      label: "High",
      longLabel: "High priority",
      base: "#F07832",
      deep: "#9A4A12",
      softBg: "#FFF6F0",
      border: "#F5D3B8",
      glowRgba: "rgba(240, 120, 50, 0.16)",
      frameFrom: "rgba(240, 120, 50, 0.55)",
      impactBars: 3,
      Icon: AlertTriangle,
    };
  }
  if (severity === "medium") {
    return {
      label: "Medium",
      longLabel: "Medium priority",
      base: "#E5A126",
      deep: "#925B13",
      softBg: "#FFFDF4",
      border: "#F2DDB8",
      glowRgba: "rgba(229, 161, 38, 0.18)",
      frameFrom: "rgba(229, 161, 38, 0.6)",
      impactBars: 2,
      Icon: Gauge,
    };
  }
  return {
    label: "Low",
    longLabel: "Low priority",
    base: "#6475E8",
    deep: "#39449F",
    softBg: "#F4F6FF",
    border: "#D8D7FA",
    glowRgba: "rgba(100, 117, 232, 0.16)",
    frameFrom: "rgba(100, 117, 232, 0.55)",
    impactBars: 1,
    Icon: Eye,
  };
}

/**
 * Tweens a numeric metric toward its new value only when the value actually
 * changes. Renders the final value on first paint so tests and reduced-motion
 * users never see a counting artifact.
 */
function AnimatedMetricValue({
  value,
  format,
}: {
  value: number;
  format: (n: number) => string;
}) {
  const reducedMotion = Boolean(useReducedMotion());
  const [display, setDisplay] = useState(value);
  const previous = useRef(value);

  useEffect(() => {
    if (reducedMotion || previous.current === value) {
      previous.current = value;
      setDisplay(value);
      return;
    }
    const from = previous.current;
    previous.current = value;
    const controls = animate(from, value, {
      duration: 0.7,
      ease: EASE_OUT_EXPO,
      onUpdate: (latest) => setDisplay(latest),
    });
    return () => controls.stop();
  }, [value, reducedMotion]);

  return <>{format(display)}</>;
}

function formatMetricValue(item: Observation, raw: number): string {
  if (item.unit === "money" && item.currency) return money(raw, item.currency);
  if (item.unit === "percent") return `${Math.round(raw * 10) / 10}%`;
  if (item.unit === "count" || item.unit === "status") return `${Math.round(raw)}`;
  return `${Math.round(raw * 100) / 100} ${item.unit}`;
}

function MetricValue({ item }: { item: Observation }) {
  if (typeof item.value !== "number" || item.availability !== "available") {
    return <>{observationText(item)}</>;
  }
  const format = (n: number) => formatMetricValue(item, n);
  return <AnimatedMetricValue value={item.value} format={format} />;
}

function ImpactMeter({
  level,
  severity,
  hovered,
  index,
  reducedMotion,
}: {
  level: number;
  severity: SeverityMeta;
  hovered: boolean;
  index: number;
  reducedMotion: boolean;
}) {
  return (
    <span
      className="inline-flex items-center gap-2 whitespace-nowrap text-[11.5px] font-medium text-[#667085]"
      aria-label={`Impact level ${level} of 3`}
    >
      <span>Impact</span>
      <span className="inline-flex items-center gap-[3px]" aria-hidden="true">
        {[1, 2, 3].map((bar) => {
          const filled = bar <= level;
          return (
            <motion.i
              key={bar}
              className="block h-[6px] w-[14px] origin-left rounded-[3px]"
              style={
                filled
                  ? {
                      background: `linear-gradient(90deg, ${severity.base}, ${severity.deep})`,
                      boxShadow: hovered ? `0 0 8px ${severity.glowRgba}` : "none",
                    }
                  : { backgroundColor: "#E9EAF0" }
              }
              initial={reducedMotion ? false : { scaleX: 0 }}
              animate={
                reducedMotion
                  ? { scaleX: 1, opacity: 1 }
                  : hovered && filled
                    ? { scaleX: 1, opacity: [1, 0.55, 1] }
                    : { scaleX: 1, opacity: 1 }
              }
              transition={
                reducedMotion
                  ? { duration: 0 }
                  : hovered && filled
                    ? { duration: 0.45, delay: (bar - 1) * 0.06, ease: EASE_OUT_EXPO }
                    : {
                        duration: 0.48,
                        delay: 0.2 + index * 0.06 + (bar - 1) * 0.07,
                        ease: EASE_OUT_EXPO,
                      }
              }
            />
          );
        })}
      </span>
    </span>
  );
}

export interface PriorityFindingCardProps {
  finding: Finding;
  rank: number;
  isPrimary: boolean;
  onInvestigate: (route: string) => void;
}

export function PriorityFindingCard({
  finding,
  rank,
  isPrimary,
  onInvestigate,
}: PriorityFindingCardProps) {
  const reducedMotion = Boolean(useReducedMotion());
  const [hovered, setHovered] = useState(false);
  const [ctaHovered, setCtaHovered] = useState(false);
  const [pending, setPending] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const severity = getSeverityMeta(finding.severity);
  const SeverityIcon = severity.Icon;
  const verified = isVerifiedFinding(finding);
  const evidenceState = findingEvidenceAppState(finding);
  const availableObservations = finding.evidence.observations.filter(
    (obs) => obs.value !== null && obs.availability === "available",
  );
  const stripObservations = availableObservations.slice(0, 3);
  const refCount = finding.evidence.references.length;
  const confidenceText = `${finding.confidence.classification.replaceAll("_", " ")} confidence`;
  const detectedIso = finding.detected_at || finding.last_verified_at;
  const periodLabel = `${finding.reporting_period.kind.replaceAll("_", " ")} · ${finding.reporting_period.timezone}`;
  const categoryLabel = finding.signal_category
    ? SIGNAL_CATEGORY_LABELS[finding.signal_category]
    : formatSourceLabel(finding.evidence.source);

  const stateLabel = isPrimary
    ? verified
      ? "Verified finding"
      : "Evidence-limited"
    : verified
      ? "Ongoing"
      : "Evidence-limited";

  const ctaLabel = isPrimary
    ? "Ask Rev about this"
    : finding.next_step?.label && !GENERIC_NEXT_STEP_LABELS.has(finding.next_step.label)
      ? finding.next_step.label
      : "Investigate with Rev";

  const handleRowClick = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, a, summary, details, input")) return;
    onInvestigate(finding.investigation.route);
  };

  const handleCtaClick = () => {
    setPending(true);
    onInvestigate(finding.investigation.route);
  };

  const delayIndex = Math.min(rank - 1, 5);

  return (
    <motion.article
      data-severity={finding.severity}
      data-priority-primary={isPrimary ? "true" : "false"}
      onClick={handleRowClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      initial={reducedMotion ? false : { opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      layout={reducedMotion ? false : true}
      transition={{
        duration: reducedMotion ? 0 : 0.52,
        delay: reducedMotion ? 0 : delayIndex * 0.07,
        ease: EASE_OUT_EXPO,
      }}
      className="group min-w-0 cursor-pointer"
    >
      {/* Luminous frame: severity-tinted gradient border that ignites on hover */}
      <div
        className="rounded-[18px] p-px transition-[box-shadow,transform] duration-300 ease-out group-hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0"
        style={{
          background: `linear-gradient(135deg, ${severity.frameFrom} 0%, #E3E1FA 28%, #ECECF1 55%, rgba(81, 70, 229, 0.35) 100%)`,
          boxShadow: hovered
            ? `0 1px 2px rgba(12, 10, 29, 0.05), 0 18px 38px -18px ${severity.glowRgba}, 0 8px 24px -16px rgba(43, 19, 207, 0.28)`
            : "0 1px 2px rgba(12, 10, 29, 0.04), 0 10px 24px -18px rgba(12, 10, 29, 0.16)",
        }}
      >
        <div
          className="relative min-w-0 overflow-hidden rounded-[17px] bg-white"
          style={{
            background: isPrimary
              ? `radial-gradient(520px 170px at 88% -40px, ${severity.glowRgba}, transparent 70%), radial-gradient(640px 220px at 8% -60px, rgba(68, 56, 232, 0.07), transparent 65%), linear-gradient(180deg, #FFFFFF 0%, #FCFCFE 100%)`
              : `radial-gradient(480px 150px at 90% -40px, ${severity.glowRgba}, transparent 70%), #FFFFFF`,
          }}
        >
          {/* Top specular highlight */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent"
          />
          {/* Hover edge-light wash */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 motion-reduce:transition-none"
            style={{
              background: `radial-gradient(420px 160px at 50% -60px, ${severity.glowRgba}, transparent 70%)`,
            }}
          />

          <div className="relative px-5 py-5 sm:px-6">
            {/* Identity row: severity emblem + rank + category, verification state */}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <motion.span
                  aria-hidden="true"
                  initial={reducedMotion ? false : { scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{
                    duration: reducedMotion ? 0 : 0.5,
                    delay: reducedMotion ? 0 : 0.08 + delayIndex * 0.07,
                    ease: EASE_OUT_EXPO,
                  }}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border"
                  style={{
                    borderColor: severity.border,
                    background: `linear-gradient(140deg, #FFFFFF 0%, ${severity.softBg} 100%)`,
                    boxShadow: `0 6px 14px -8px ${severity.glowRgba}, inset 0 1px 0 rgba(255, 255, 255, 0.9)`,
                    color: severity.deep,
                  }}
                >
                  <SeverityIcon className="h-[18px] w-[18px]" strokeWidth={2.1} />
                </motion.span>
                <div className="min-w-0">
                  <p
                    className="text-[12.5px] font-bold leading-5 tracking-[-0.01em]"
                    style={{ color: severity.deep }}
                  >
                    {severity.longLabel}
                  </p>
                  <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11.5px] text-[#667085]">
                    <span className="font-mono font-semibold tabular-nums text-[#475467]">
                      #{rank}
                    </span>
                    <span aria-hidden="true" className="text-[#D0D5DD]">
                      ·
                    </span>
                    <span className="truncate">{categoryLabel}</span>
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-1.5">
                {(evidenceState === "stale" || evidenceState === "partial") && (
                  <StateBadge state={evidenceState} />
                )}
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-4",
                    verified
                      ? "border-[#C9C7FA] bg-[#F0EDFF] text-[#3525B8]"
                      : "border-[#F0B8B2] bg-[#FFF8F7] text-[#9C2B25]",
                  )}
                >
                  {verified ? (
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  ) : (
                    <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  )}
                  <span>{stateLabel}</span>
                </span>
              </div>
            </div>

            {/* Problem focal point: title + one explanatory sentence */}
            <div className="mt-4">
              {isPrimary ? (
                <h3 className="text-balance text-[17px] font-semibold leading-[1.32] tracking-[-0.02em] text-[#101828] sm:text-[18px]">
                  {finding.title}
                </h3>
              ) : (
                <h4 className="text-balance text-[15px] font-semibold leading-[1.35] tracking-[-0.015em] text-[#101828]">
                  {finding.title}
                </h4>
              )}
              <p className="mt-1.5 max-w-[72ch] text-[13px] leading-[1.6] text-[#475467]">
                {finding.description}
              </p>
            </div>

            {/* Evidence strip: compact adaptive metric tiles */}
            {stripObservations.length > 0 && (
              <div
                className="mt-4 grid gap-2 sm:grid-cols-3"
                aria-label="Key supporting evidence"
              >
                {stripObservations.map((obs, idx) => (
                  <motion.div
                    key={`${obs.label}-${idx}`}
                    initial={reducedMotion ? false : { opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: reducedMotion ? 0 : 0.44,
                      delay: reducedMotion ? 0 : 0.16 + delayIndex * 0.07 + idx * 0.06,
                      ease: EASE_OUT_EXPO,
                    }}
                    className="min-w-0 rounded-xl border px-3.5 py-2.5"
                    style={{
                      borderColor: "#E8ECF3",
                      background:
                        "linear-gradient(180deg, rgba(240, 237, 255, 0.55) 0%, rgba(255, 255, 255, 0.9) 100%)",
                      boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.9)",
                    }}
                  >
                    <p className="truncate text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[#667085]">
                      {obs.label}
                    </p>
                    <p className="mt-1 break-words text-[15px] font-semibold tabular-nums tracking-[-0.01em] text-[#101828]">
                      <MetricValue item={obs} />
                    </p>
                  </motion.div>
                ))}
              </div>
            )}

            {/* Recommendation band: deep violet accent area */}
            <div
              className="relative mt-3.5 overflow-hidden rounded-xl px-4 py-3.5"
              style={{
                background:
                  "radial-gradient(360px 140px at 12% -40px, rgba(120, 110, 255, 0.5), transparent 65%), linear-gradient(118deg, #17152F 0%, #241A63 55%, #2B13CF 130%)",
                boxShadow:
                  "0 10px 22px -14px rgba(23, 21, 47, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.14)",
              }}
            >
              <div className="relative flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                  style={{
                    background: "rgba(255, 255, 255, 0.1)",
                    boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.18)",
                    color: "#D9D4FF",
                  }}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#C9C2FF]">
                    Recommended next step
                  </p>
                  {finding.recommendation.available && finding.recommendation.step ? (
                    <div className="mt-1 space-y-1">
                      <p className="text-[13px] font-semibold leading-snug text-white">
                        {finding.recommendation.step}
                      </p>
                      {finding.recommendation.expected_result && (
                        <p className="text-[12px] leading-relaxed text-[#D9D4EC]">
                          {finding.recommendation.expected_result}
                        </p>
                      )}
                      <p className="pt-0.5 text-[11px] text-[#A9A3C7]">
                        Read-only merchant action, not executed by Revluma.
                      </p>
                    </div>
                  ) : finding.recommendation.prerequisites.length > 0 ? (
                    <ul className="mt-1 space-y-1 text-[12.5px] leading-relaxed text-[#EDEAFF]">
                      {finding.recommendation.prerequisites.map((prereq, idx) => (
                        <li key={idx}>{prereq}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-[12.5px] leading-relaxed text-[#EDEAFF]">
                      Review this signal in Rev Intelligence with its underlying records.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Footer: impact + detected meta, disclosure trigger, Ask Rev action */}
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
                <ImpactMeter
                  level={severity.impactBars}
                  severity={severity}
                  hovered={hovered}
                  index={delayIndex}
                  reducedMotion={reducedMotion}
                />
                <span
                  aria-hidden="true"
                  className="hidden h-3 w-px bg-[#E4E7EC] sm:block"
                />
                <span className="inline-flex items-center gap-1.5 text-[11.5px] text-[#667085]">
                  <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    Detected {relativeTime(detectedIso)}
                  </span>
                </span>
              </div>

              <div className="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row sm:items-center">
                <motion.button
                  type="button"
                  onClick={handleCtaClick}
                  disabled={pending}
                  onMouseEnter={() => setCtaHovered(true)}
                  onMouseLeave={() => setCtaHovered(false)}
                  whileTap={reducedMotion ? undefined : { scale: 0.97 }}
                  className={cn(
                    "relative inline-flex min-h-10 items-center justify-center gap-1.5 overflow-hidden rounded-xl px-4 py-2 text-[12.5px] font-semibold transition-all duration-200",
                    isPrimary
                      ? "text-white hover:brightness-110 disabled:cursor-wait disabled:opacity-80"
                      : "border border-[#C9C7FA] bg-white text-[#1F06AC] hover:border-[#2B13CF] hover:bg-[#F7F8FF] hover:shadow-[0_8px_18px_-10px_rgba(31,6,172,0.5)] disabled:cursor-wait disabled:opacity-70",
                    cc.focus,
                  )}
                  style={
                    isPrimary
                      ? {
                          background:
                            "linear-gradient(135deg, #5146E5 0%, #3525B8 55%, #1F06AC 100%)",
                          boxShadow:
                            "0 10px 22px -10px rgba(31, 6, 172, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.25)",
                        }
                      : undefined
                  }
                >
                  {isPrimary && !reducedMotion && (
                    <motion.span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-white/25 to-transparent"
                      initial={{ x: "-100%" }}
                      animate={ctaHovered ? { x: "420%" } : { x: "-100%" }}
                      transition={{ duration: 0.65, ease: EASE_OUT_EXPO }}
                    />
                  )}
                  {pending ? (
                    <Loader2
                      className="relative z-10 h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                  ) : null}
                  <span className="relative z-10">{ctaLabel}</span>
                  <ArrowRight
                    className={cn(
                      "relative z-10 h-3.5 w-3.5 shrink-0 transition-transform duration-200",
                      ctaHovered && "translate-x-0.5",
                    )}
                    aria-hidden="true"
                  />
                </motion.button>
              </div>
            </div>

            {/* Progressive disclosure: full evidence, rationale, confidence, limits, provenance */}
            <details
              className="group/details mt-3.5 border-t border-[#F0F2F5] pt-3"
              open={expanded}
            >
              <summary
                onClick={(event) => {
                  event.preventDefault();
                  setExpanded((open) => !open);
                }}
                className={cn(
                  cc.disclosure,
                  "inline-flex cursor-pointer list-none items-center gap-1.5 select-none rounded-md text-[12px] font-medium text-[#4655A4] transition-colors hover:text-[#1F06AC] [&::-webkit-details-marker]:hidden",
                )}
                aria-expanded={expanded}
              >
                Inspect evidence, provenance and uncertainty
                <motion.span
                  aria-hidden="true"
                  className="inline-flex"
                  initial={false}
                  animate={{ rotate: expanded ? 180 : 0 }}
                  transition={
                    reducedMotion ? { duration: 0 } : { duration: 0.28, ease: EASE_OUT_EXPO }
                  }
                >
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                </motion.span>
              </summary>

              <motion.div
                initial={false}
                animate={
                  expanded
                    ? { height: "auto", opacity: 1 }
                    : { height: 0, opacity: 0 }
                }
                transition={
                  reducedMotion
                    ? { duration: 0 }
                    : { duration: 0.38, ease: EASE_OUT_EXPO }
                }
                style={{ overflow: "hidden" }}
              >
                <div
                  className="mt-3 space-y-4 rounded-xl border border-[#E8ECF3] bg-[#FCFCFD] p-4 text-[12.5px] leading-5 text-[#475467]"
                  style={expanded ? undefined : { visibility: "hidden" }}
                >
                  {/* All recorded observations as composite rows */}
                  {availableObservations.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-[#667085]">
                        Recorded observations
                      </p>
                      <ul className="space-y-1">
                        {availableObservations.map((obs, idx) => (
                          <li
                            key={`${obs.label}-${idx}`}
                            className="rounded-lg border border-[#E8ECF3] bg-white px-3 py-1.5 text-[12.5px] tabular-nums text-[#172033]"
                          >
                            <span>{observationComposite(obs)}</span>
                          </li>
                        ))}
                      </ul>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[#667085]">
                        <span>{periodLabel}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {refCount > 0
                            ? `${refCount} ${refCount === 1 ? "verified source" : "verified sources"}`
                            : formatSourceLabel(finding.evidence.source)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{confidenceText}</span>
                      </div>
                    </div>
                  )}

                  {availableObservations.length === 0 && (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-[#667085]">
                      <span>{periodLabel}</span>
                      <span aria-hidden="true">·</span>
                      <span>{confidenceText}</span>
                    </div>
                  )}

                  {finding.priority.tie?.statement && (
                    <p className="rounded-lg border border-[#E3E1FA] bg-[#F7F8FF] px-3 py-2 text-[12px] text-[#1F06AC]">
                      {finding.priority.tie.statement}
                    </p>
                  )}

                  {/* Epistemic separation: Priority vs. Confidence vs. Limits */}
                  {isPrimary && (
                    <div className="grid gap-3 border-t border-[#EAECF0] pt-3 sm:grid-cols-3">
                      <div className="min-w-0">
                        <h4 className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-[#475467]">
                          Why this is the priority
                        </h4>
                        <ul className="mt-1.5 space-y-1 text-[12px] text-[#475467]">
                          {(finding.priority.rationale.length > 0
                            ? finding.priority.rationale
                            : ["Ranked by verified severity, freshness, and coverage."]
                          ).map((item, idx) => (
                            <li key={idx}>{item}</li>
                          ))}
                        </ul>
                      </div>

                      <div className="min-w-0">
                        <h4 className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-[#475467]">
                          Confidence
                        </h4>
                        <ul className="mt-1.5 space-y-1 text-[12px] text-[#475467]">
                          {(finding.confidence.rationale.length > 0
                            ? finding.confidence.rationale
                            : [confidenceText]
                          ).map((item, idx) => (
                            <li key={idx}>{item}</li>
                          ))}
                        </ul>
                      </div>

                      <div className="min-w-0">
                        <h4 className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-[#475467]">
                          Limits of this conclusion
                        </h4>
                        <ul className="mt-1.5 space-y-1 text-[12px] text-[#475467]">
                          {(finding.limitations.length > 0
                            ? finding.limitations
                            : ["No additional evidence limitations recorded."]
                          ).map((item, idx) => (
                            <li key={idx}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}

                  {/* Provenance metadata */}
                  <dl className="grid gap-x-4 gap-y-2 border-t border-[#EAECF0] pt-3 text-[11.5px] sm:grid-cols-2">
                    <div>
                      <dt className="font-medium text-[#667085]">Finding ID</dt>
                      <dd className="mt-0.5 break-all font-mono text-[11px] text-[#172033]">
                        {finding.id}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium text-[#667085]">Ranking method</dt>
                      <dd className="mt-0.5 font-mono text-[11px] text-[#172033]">
                        {finding.priority.method_version}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium text-[#667085]">Coverage run</dt>
                      <dd className="mt-0.5 text-[#172033]">
                        {finding.coverage.run_id || "Not recorded"}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium text-[#667085]">Lifecycle validity</dt>
                      <dd className="mt-0.5 text-[#172033]">
                        {finding.lifecycle.current_validity.replaceAll("_", " ")}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium text-[#667085]">Detected</dt>
                      <dd className="mt-0.5 tabular-nums text-[#172033]">
                        {dateTime(finding.detected_at)}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium text-[#667085]">Last verified</dt>
                      <dd className="mt-0.5 tabular-nums text-[#172033]">
                        {dateTime(finding.last_verified_at)}
                      </dd>
                    </div>
                  </dl>

                  {!isPrimary && finding.limitations.length > 0 && (
                    <div>
                      <p className="font-medium text-[#172033]">Limitations</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4">
                        {finding.limitations.map((item, idx) => (
                          <li key={idx}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {finding.unknowns.length > 0 && (
                    <div>
                      <p className="font-medium text-[#172033]">Unknowns</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4">
                        {finding.unknowns.map((item, idx) => (
                          <li key={idx}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {finding.evidence.references.length > 0 && (
                    <div>
                      <p className="font-medium text-[#172033]">Evidence references</p>
                      <ul className="mt-1 space-y-0.5">
                        {finding.evidence.references.map((ref) => (
                          <li key={ref.id} className="font-mono text-[11px] text-[#475467]">
                            {ref.source_type}: {ref.source_record_id}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {finding.evidence.duplicate_finding_ids.length > 0 && (
                    <p className="text-[11px] text-[#667085]">
                      Deduplicated records retained: {finding.evidence.duplicate_finding_ids.join(", ")}
                    </p>
                  )}
                </div>
              </motion.div>
            </details>
          </div>
        </div>
      </div>
    </motion.article>
  );
}

export default PriorityFindingCard;
