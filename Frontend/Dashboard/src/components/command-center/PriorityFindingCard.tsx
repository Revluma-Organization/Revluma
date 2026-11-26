import { type MouseEvent, useEffect, useRef, useState } from "react";
import { animate, motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  ChevronRight,
  Loader2,
  PanelRightOpen,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetTrigger } from "@/components/ui/sheet";
import { FindingDetailsDrawer } from "./FindingDetailsDrawer";
import { StateBadge } from "./StateBadge";
import { cc, palette } from "./tokens";
import {
  categoryLabelFor,
  confidenceLabelFor,
  evidenceWindowLabelFor,
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
 * PriorityFindingCard: glassmorphic 2-zone bento card for a ranked finding.
 *
 * Left zone: severity pill, category, verification state, the verbatim title
 * and description, impact/confidence/detection meta, and the two actions
 * (investigate + view full details). Right zone: a frosted evidence tile with
 * the primary recorded value. Everything deeper lives in the
 * FindingDetailsDrawer side drawer.
 *
 * Contract notes (do not break):
 * - Root stays a motion.article carrying data-severity / data-priority-primary.
 * - Rank renders as "#N", verification states keep their exact labels.
 * - Primary title is h3, secondary titles are h4.
 * - Title and description stay verbatim in the DOM.
 * - Impact meter keeps its "Impact level N of 3" accessible label; detection
 *   time keeps its "Detected …" text.
 * - CTA labels: "Ask Rev about this" (primary), backend next_step label when
 *   meaningful, otherwise "Investigate with Rev" (secondary).
 * - Card body click navigates; button interactions never trigger navigation.
 * - No trend sparkline: the backend provides recorded values, not time
 *   series, so the tile shows the value, its label, and the real window only.
 */

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** Backend CTA labels considered generic; replaced by the designed default. */
const GENERIC_NEXT_STEP_LABELS = new Set(["Investigate with Rev"]);

export interface PriorityFindingCardProps {
  finding: Finding;
  rank: number;
  isPrimary: boolean;
  onInvestigate: (route: string) => void;
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

/**
 * Accessible impact meter: three bars filled to the severity's impact level.
 * The aria-label is a tested contract ("Impact level N of 3").
 */
function ImpactMeter({ level, severity }: { level: number; severity: SeverityMeta }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap"
      aria-label={`Impact level ${level} of 3`}
    >
      <span>Impact</span>
      <span className="inline-flex items-center gap-[3px]" aria-hidden="true">
        {[1, 2, 3].map((bar) => (
          <i
            key={bar}
            className="block h-[5px] w-[12px] rounded-full"
            style={
              bar <= level
                ? { background: `linear-gradient(90deg, ${severity.base}, ${severity.deep})` }
                : { backgroundColor: palette.line.DEFAULT }
            }
          />
        ))}
      </span>
    </span>
  );
}

export function PriorityFindingCard({
  finding,
  rank,
  isPrimary,
  onInvestigate,
}: PriorityFindingCardProps) {
  const reducedMotion = Boolean(useReducedMotion());
  const [pending, setPending] = useState(false);

  const severity = getSeverityMeta(finding.severity);
  const verified = isVerifiedFinding(finding);
  const evidenceState = findingEvidenceAppState(finding);
  const confidenceLabel = confidenceLabelFor(finding);
  const detectedIso = finding.detected_at || finding.last_verified_at;
  const categoryLabel = categoryLabelFor(finding);
  const stateLabel = verificationLabelFor(finding, isPrimary);
  const windowLabel = evidenceWindowLabelFor(finding);

  const primaryObservation = finding.evidence.observations[0];
  const hasPrimaryImpact = Boolean(
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

  const handleRowClick = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, a, summary, details, input, select, textarea")) return;
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
        initial={reducedMotion ? false : { opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: reducedMotion ? 0 : 0.5,
          delay: reducedMotion ? 0 : delayIndex * 0.07,
          ease: EASE_OUT_EXPO,
        }}
        className="group min-w-0 cursor-pointer"
      >
        {/* Frosted glass surface with inset highlight; deepens on hover */}
        <div
          className="rounded-2xl border border-slate-200/70 bg-white/85 p-5 backdrop-blur-xl transition-shadow duration-200 hover:shadow-[0_18px_40px_-12px_rgba(31,6,172,0.16),0_4px_12px_-2px_rgba(15,23,42,0.06),inset_0_1px_1px_rgba(255,255,255,1)] motion-reduce:transition-none sm:p-6"
          style={{
            boxShadow:
              "0 4px 24px -6px rgba(15, 23, 42, 0.08), 0 1px 3px rgba(15, 23, 42, 0.04), inset 0 1px 1px rgba(255, 255, 255, 0.95)",
          }}
        >
          <div className="grid gap-5 lg:grid-cols-12">
            <div className="flex min-w-0 flex-col gap-3.5 lg:col-span-8">
              {/* Identity row: severity pill, category, verification, rank */}
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[12px]">
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase leading-4 tracking-[0.06em]"
                  style={{
                    borderColor: severity.border,
                    background: severity.softBg,
                    color: severity.deep,
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: severity.base }}
                  />
                  <span>{severity.longLabel}</span>
                </span>
                <span className="font-medium text-slate-500">{categoryLabel}</span>
                <span aria-hidden="true" className="text-slate-300">
                  ·
                </span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 font-semibold",
                    verified ? "text-teal-800" : "text-danger-limited",
                  )}
                >
                  {verified ? (
                    <BadgeCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  ) : (
                    <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  )}
                  <span>{stateLabel}</span>
                </span>
                {(evidenceState === "stale" || evidenceState === "partial") && (
                  <StateBadge state={evidenceState} />
                )}
                <span className="ml-auto shrink-0 font-mono text-[11px] font-semibold tabular-nums text-slate-500">
                  #{rank}
                </span>
              </div>

              {/* Problem focal point: verbatim title + description */}
              <div className="min-w-0">
                {isPrimary ? (
                  <h3 className="text-balance text-[17px] font-semibold leading-[1.35] tracking-[-0.015em] text-slate-900">
                    {finding.title}
                  </h3>
                ) : (
                  <h4 className="text-balance text-[16px] font-semibold leading-[1.35] tracking-[-0.015em] text-slate-900">
                    {finding.title}
                  </h4>
                )}
                <p className="mt-1.5 line-clamp-2 max-w-prose text-[13.5px] leading-[1.6] text-slate-500">
                  {finding.description}
                </p>
              </div>

              {/* Meta + actions */}
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 pt-1">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-slate-500">
                  <ImpactMeter level={severity.impactBars} severity={severity} />
                  <span>
                    Confidence:{" "}
                    <strong className="font-semibold text-slate-900">
                      {confidenceLabel}
                    </strong>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="font-mono text-[11px] tabular-nums">
                      Detected {relativeTime(detectedIso)}
                    </span>
                  </span>
                  {supportsTieBreak && (
                    <span className="inline-flex items-center gap-1 font-medium text-brand-deeper">
                      <span aria-hidden="true" className="h-1 w-1 rounded-full bg-current" />
                      Tiebreak applied
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <SheetTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "inline-flex cursor-pointer min-h-10 items-center justify-center gap-1.5 rounded-[10px] border border-slate-200 bg-white/80 px-3.5 py-2 text-[12.5px] font-semibold text-slate-800 transition-colors duration-200 hover:bg-slate-100 motion-reduce:transition-none",
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

                  <button
                    type="button"
                    onClick={handleCtaClick}
                    disabled={pending}
                    className={cn(
                      "inline-flex cursor-pointer min-h-10 items-center justify-center gap-1.5 rounded-[10px] px-4 py-2 text-[12.5px] font-semibold text-white transition-all duration-200 hover:brightness-110 disabled:cursor-wait disabled:opacity-80 motion-reduce:transition-none",
                      cc.focus,
                    )}
                    style={{
                      background:
                        palette.gradient.cta,
                      boxShadow:
                        "0 6px 18px -4px rgba(31, 6, 172, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.25)",
                    }}
                  >
                    {pending ? (
                      <Loader2
                        className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none"
                        aria-hidden="true"
                      />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    )}
                    <span>{ctaLabel}</span>
                    <ArrowRight
                      className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transform-none"
                      aria-hidden="true"
                    />
                  </button>
                </div>
              </div>
            </div>

            {/* Frosted evidence tile: primary recorded value + real window */}
            <div
              className="relative flex min-w-0 flex-col justify-between gap-2 overflow-hidden rounded-xl border border-slate-200/70 bg-slate-50/70 p-4 backdrop-blur-md lg:col-span-4"
              style={{
                boxShadow:
                  "inset 0 1px 1px rgba(255, 255, 255, 0.85), 0 2px 10px -3px rgba(15, 23, 42, 0.06)",
              }}
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    "radial-gradient(220px 120px at 85% 0%, rgba(68, 56, 232, 0.08), transparent 70%)",
                }}
              />
              <div className="relative flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase leading-4 tracking-[0.06em] text-slate-500">
                  {verified ? "Verified evidence" : "Recorded evidence"}
                </span>
                {windowLabel && (
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-slate-500">
                    {windowLabel}
                  </span>
                )}
              </div>

              <div className="relative flex min-w-0 items-baseline gap-2">
                {hasPrimaryImpact && primaryObservation ? (
                  <>
                    <span
                      title={
                        typeof primaryObservation.value === "string"
                          ? primaryObservation.value
                          : undefined
                      }
                      className="truncate text-[28px] font-semibold leading-[34px] tracking-[-0.02em] tabular-nums text-slate-900"
                    >
                      <PrimaryImpactValue item={primaryObservation} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-slate-500">
                      {primaryObservation.label}
                    </span>
                  </>
                ) : (
                  <>
                    <span
                      aria-hidden="true"
                      className="text-[28px] font-semibold leading-[34px] text-slate-300"
                    >
                      —
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-slate-500">
                      No verified observations recorded
                    </span>
                  </>
                )}
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
