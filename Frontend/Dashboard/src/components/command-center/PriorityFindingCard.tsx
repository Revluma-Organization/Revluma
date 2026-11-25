import { type MouseEvent, useEffect, useRef, useState } from "react";
import { animate, motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  CalendarClock,
  ChevronRight,
  Loader2,
  PanelRightOpen,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetTrigger } from "@/components/ui/sheet";
import { FindingDetailsDrawer } from "./FindingDetailsDrawer";
import { StateBadge } from "./StateBadge";
import { cc } from "./tokens";
import {
  categoryLabelFor,
  confidenceTextFor,
  findingEvidenceAppState,
  getSeverityMeta,
  isVerifiedFinding,
  money,
  observationText,
  relativeTime,
  verificationLabelFor,
  type Observation,
  type SeverityMeta,
} from "./findingDisplay";
import type { Finding } from "./types";

/**
 * PriorityFindingCard: minimal dashboard row for a ranked finding.
 *
 * The dashboard card deliberately shows only the glanceable minimum: severity
 * identity, rank, category, verification state, the verbatim title and
 * description, the primary recorded impact, impact meter, detection time, and
 * the two actions (investigate + view full details). All deeper content,
 * supporting observations, recommendation, rationale, confidence, limits, and
 * provenance, lives in the FindingDetailsDrawer side drawer.
 *
 * Contract notes (do not break):
 * - Root stays a motion.article carrying data-severity / data-priority-primary.
 * - Rank renders as "#N", verification states keep their exact labels.
 * - Primary title is h3, secondary titles are h4.
 * - Title and description stay verbatim in the DOM (CSS clamping only).
 * - CTA labels: "Ask Rev about this" (primary), backend next_step label when
 *   meaningful, otherwise "Investigate with Rev" (secondary).
 * - Card body click navigates; button interactions never trigger navigation.
 */

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** Backend CTA labels considered generic; replaced by the designed default. */
const GENERIC_NEXT_STEP_LABELS = new Set(["Investigate with Rev"]);

const MAX_TITLE_CHARS = 120;
const MAX_DESCRIPTION_CHARS = 160;

export interface PriorityFindingCardProps {
  finding: Finding;
  rank: number;
  isPrimary: boolean;
  onInvestigate: (route: string) => void;
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

/**
 * Primary recorded impact: the first available observation value. Money values
 * tween on change; every other unit renders the exact recorded text.
 */
function PrimaryImpactValue({ item }: { item: Observation }) {
  const reducedMotion = Boolean(useReducedMotion());
  const isMoney =
    typeof item.value === "number" && item.unit === "money" && Boolean(item.currency);
  const target = isMoney ? (item.value as number) : null;

  const [display, setDisplay] = useState<number>(target ?? 0);
  const previous = useRef<number>(target ?? 0);

  useEffect(() => {
    if (target === null) return;
    if (reducedMotion || previous.current === target) {
      previous.current = target;
      setDisplay(target);
      return;
    }
    const from = previous.current;
    previous.current = target;
    const controls = animate(from, target, {
      duration: 0.7,
      ease: EASE_OUT_EXPO,
      onUpdate: (latest) => setDisplay(latest),
    });
    return () => controls.stop();
  }, [target, reducedMotion]);

  if (target === null || !item.currency) return <>{observationText(item)}</>;
  return <>{money(display, item.currency)}</>;
}

export function PriorityFindingCard({
  finding,
  rank,
  isPrimary,
  onInvestigate,
}: PriorityFindingCardProps) {
  const reducedMotion = Boolean(useReducedMotion());
  const [hovered, setHovered] = useState(false);
  const [pending, setPending] = useState(false);

  const severity = getSeverityMeta(finding.severity);
  const SeverityIcon = severity.Icon;
  const verified = isVerifiedFinding(finding);
  const evidenceState = findingEvidenceAppState(finding);
  const confidenceText = confidenceTextFor(finding);
  const detectedIso = finding.detected_at || finding.last_verified_at;
  const categoryLabel = categoryLabelFor(finding);
  const stateLabel = verificationLabelFor(finding, isPrimary);

  const primaryObservation = finding.evidence.observations[0];
  const showPrimaryImpact = Boolean(
    primaryObservation &&
      primaryObservation.value !== null &&
      primaryObservation.availability === "available",
  );
  const supportsTieBreak = isPrimary && finding.priority.tie?.statement;

  const ctaLabel = isPrimary
    ? "Ask Rev about this"
    : finding.next_step?.label && !GENERIC_NEXT_STEP_LABELS.has(finding.next_step.label)
      ? finding.next_step.label
      : "Investigate with Rev";

  const clippedTitle =
    finding.title.length > MAX_TITLE_CHARS
      ? finding.title.slice(0, MAX_TITLE_CHARS).trimEnd()
      : null;
  const clippedDescription =
    finding.description.length > MAX_DESCRIPTION_CHARS
      ? finding.description.slice(0, MAX_DESCRIPTION_CHARS).trimEnd()
      : null;

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
    <Sheet>
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

              {/* Problem focal point: verbatim title + one explanatory sentence */}
              <div className="mt-4">
                {isPrimary ? (
                  <h3
                    title={clippedTitle ? finding.title : undefined}
                    className="truncate text-balance text-[17px] font-semibold leading-[1.32] tracking-[-0.02em] text-[#101828] sm:text-[18px]"
                  >
                    {finding.title}
                  </h3>
                ) : (
                  <h4
                    title={clippedTitle ? finding.title : undefined}
                    className="truncate text-[15px] font-semibold leading-[1.35] tracking-[-0.015em] text-[#101828]"
                  >
                    {finding.title}
                  </h4>
                )}
                <p
                  title={clippedDescription ? finding.description : undefined}
                  className="mt-1.5 line-clamp-2 max-w-[72ch] text-[13px] leading-[1.6] text-[#475467]"
                >
                  {finding.description}
                </p>
              </div>

              {/* Minimal trust strip: primary impact, meter, detection time, confidence */}
              <div className="mt-3.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-[11.5px] text-[#667085]">
                {showPrimaryImpact && primaryObservation && (
                  <span className="inline-flex min-w-0 items-baseline gap-1.5">
                    <span className="truncate text-[14px] font-semibold tabular-nums tracking-[-0.01em] text-[#101828]">
                      <PrimaryImpactValue item={primaryObservation} />
                    </span>
                    <span className="truncate">{primaryObservation.label}</span>
                  </span>
                )}
                <ImpactMeter
                  level={severity.impactBars}
                  severity={severity}
                  hovered={hovered}
                  index={delayIndex}
                  reducedMotion={reducedMotion}
                />
                <span className="inline-flex items-center gap-1.5">
                  <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>Detected {relativeTime(detectedIso)}</span>
                </span>
                <span aria-hidden="true" className="hidden h-3 w-px bg-[#E4E7EC] sm:block" />
                <span className="capitalize">{confidenceText}</span>
                {supportsTieBreak && (
                  <span className="inline-flex items-center gap-1 text-[#1F06AC]">
                    <span aria-hidden="true" className="h-1 w-1 rounded-full bg-current" />
                    Tiebreak applied
                  </span>
                )}
              </div>

              {/* Actions: investigate + view full details, never blocked by motion */}
              <div className="mt-4 flex flex-wrap items-center gap-2.5 border-t border-[#F0F2F5] pt-3.5">
                <button
                  type="button"
                  onClick={handleCtaClick}
                  disabled={pending}
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
                  {pending ? (
                    <Loader2
                      className="relative z-10 h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                  ) : null}
                  <span className="relative z-10">{ctaLabel}</span>
                  <ArrowRight
                    className="relative z-10 h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transform-none"
                    aria-hidden="true"
                  />
                </button>

                <SheetTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-[#D8D7FA] bg-white px-4 py-2 text-[12.5px] font-semibold text-[#3525B8] transition-colors duration-200 hover:bg-[#F4F2FF] motion-reduce:transition-none",
                      cc.focus,
                    )}
                  >
                    <PanelRightOpen className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>View full details</span>
                    <ChevronRight
                      className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transform-none"
                      aria-hidden="true"
                    />
                  </button>
                </SheetTrigger>
              </div>
            </div>
          </div>
        </div>
      </motion.article>

      <FindingDetailsDrawer
        finding={finding}
        rank={rank}
        isPrimary={isPrimary}
        onInvestigate={onInvestigate}
      />
    </Sheet>
  );
}

export default PriorityFindingCard;
