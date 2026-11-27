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
import { cc, palette, roleColor } from "./tokens";
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
 * PriorityFindingCard: dense priority-queue row for a ranked finding.
 *
 * Single compact surface (Master dense-surface rule: rounded-xl): rank
 * gutter, severity chip, category, verification state, the verbatim title and
 * two-line description, a meta line (key recorded metric, impact, confidence,
 * detection time), and trailing actions (investigate + view full details).
 * Everything deeper lives in the FindingDetailsDrawer side drawer.
 *
 * Contract notes (do not break):
 * - Root stays a motion.article carrying data-severity / data-priority-primary.
 * - Rank renders zero-padded ("01"); verification states keep exact labels.
 * - Primary title is h3, secondary titles are h4.
 * - Title and description stay verbatim in the DOM.
 * - Impact meter keeps its "Impact level N of 3" accessible label; detection
 *   time keeps its "Detected …" text; the key metric keeps the exact recorded
 *   value text (money tweens, everything else renders verbatim).
 * - Exactly one primary CTA (top-ranked item only); every other row uses the
 *   quiet secondary style. CTA labels: "Ask Rev about this" (primary),
 *   backend next_step label when meaningful, otherwise "Investigate with Rev".
 * - Card body click navigates; button interactions never trigger navigation.
 * - No trend sparkline: the backend provides recorded values, not time
 *   series, so the row shows the value, its label, and the real window only.
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
 * Key recorded metric: the first available observation value. Money values
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
                : { backgroundColor: roleColor("line") }
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
        {/* Dense queue row: single compact surface, trailing actions on md+ */}
        <div className="rounded-xl border border-line-soft bg-white p-4 transition-colors hover:border-line-strong motion-reduce:transition-none sm:px-5">
          <div className="flex flex-col gap-3.5 md:flex-row md:gap-4">
            <div className="flex min-w-0 flex-1 gap-3.5">
              {/* Rank gutter */}
              <span className="shrink-0 pt-0.5 font-mono text-[11px] font-semibold tabular-nums text-ink-muted">
                {String(rank).padStart(2, "0")}
              </span>

              <div className="min-w-0 flex-1">
                {/* Identity row: severity chip, category, verification */}
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[12px]">
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase leading-4 tracking-[0.06em]"
                    style={{
                      borderColor: roleColor("severityBorder", finding.severity),
                      background: roleColor("severitySoft", finding.severity),
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
                </div>

                {/* Verbatim headline + two-line explanation */}
                <div className="mt-2 min-w-0">
                  {isPrimary ? (
                    <h3 className="text-balance text-[16px] font-semibold leading-[1.35] tracking-[-0.015em] text-slate-900">
                      {finding.title}
                    </h3>
                  ) : (
                    <h4 className="text-balance text-[15px] font-semibold leading-[1.35] tracking-[-0.015em] text-slate-900">
                      {finding.title}
                    </h4>
                  )}
                  <p className="mt-1 line-clamp-2 max-w-prose text-[13.5px] leading-[1.6] text-slate-500">
                    {finding.description}
                  </p>
                </div>

                {/* Meta line: key metric, impact, confidence, detection */}
                <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-slate-500">
                  {hasPrimaryImpact && primaryObservation ? (
                    <span className="inline-flex min-w-0 items-baseline gap-1.5">
                      <span
                        title={
                          typeof primaryObservation.value === "string"
                            ? primaryObservation.value
                            : undefined
                        }
                        className="truncate text-[13px] font-semibold tabular-nums text-slate-900"
                      >
                        <PrimaryImpactValue item={primaryObservation} />
                      </span>
                      <span className="truncate">{primaryObservation.label}</span>
                      {windowLabel && (
                        <span className="shrink-0 font-mono text-[11px] tabular-nums">
                          {windowLabel}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden="true" className="font-semibold text-slate-300">
                        —
                      </span>
                      <span>No verified observations recorded</span>
                    </span>
                  )}
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
              </div>
            </div>

            {/* Trailing actions: exactly one primary CTA per queue (top item) */}
            <div className="flex shrink-0 gap-2 md:w-44 md:flex-col">
              <button
                type="button"
                onClick={handleCtaClick}
                disabled={pending}
                className={cn(
                  "inline-flex min-h-10 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[10px] px-3.5 py-2 text-[12.5px] font-semibold transition-colors motion-reduce:transition-none md:w-full md:flex-none",
                  isPrimary
                    ? "text-white hover:brightness-110 disabled:cursor-wait disabled:opacity-80"
                    : "border border-line bg-white text-ink hover:border-line-strong hover:bg-workspace disabled:cursor-wait disabled:opacity-80",
                  cc.focus,
                )}
                style={
                  isPrimary
                    ? {
                        background: palette.gradient.cta,
                        boxShadow:
                          "0 6px 18px -4px rgba(31, 6, 172, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.25)",
                      }
                    : undefined
                }
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
                  className="h-3.5 w-3.5 shrink-0 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none"
                  aria-hidden="true"
                />
              </button>

              <SheetTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "inline-flex min-h-10 cursor-pointer items-center justify-center gap-1.5 rounded-[10px] border border-slate-200 bg-white/80 px-3.5 py-2 text-[12.5px] font-semibold text-slate-800 transition-colors hover:bg-slate-100 motion-reduce:transition-none md:w-full",
                    cc.focus,
                  )}
                >
                  <PanelRightOpen className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>View full details</span>
                  <ChevronRight
                    className="h-3.5 w-3.5 shrink-0 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none"
                    aria-hidden="true"
                  />
                </button>
              </SheetTrigger>
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
