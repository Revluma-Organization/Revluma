import { useEffect, useRef, useState } from "react";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { animate, useReducedMotion } from "framer-motion";
import { ArrowRight, ShieldAlert, ShieldCheck, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { SheetOverlay, SheetPortal, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { StateBadge } from "./StateBadge";
import { cc } from "./tokens";
import {
  categoryLabelFor,
  confidenceTextFor,
  dateTime,
  findingEvidenceAppState,
  formatSourceLabel,
  getSeverityMeta,
  isVerifiedFinding,
  money,
  observationText,
  periodLabelFor,
  relativeTime,
  verificationLabelFor,
  type Observation,
} from "./findingDisplay";
import type { Finding } from "./types";

/**
 * FindingDetailsDrawer: full-detail side drawer for a priority finding.
 *
 * The dashboard card stays minimal (identity, title, short description, impact
 * and actions). Everything else, key evidence, recommendation, rationale,
 * confidence, limits, provenance, lives here behind "View full details".
 *
 * Built on the Radix dialog Sheet primitives already in the codebase, so focus
 * trapping, Escape to close, overlay dismissal, scroll locking, and focus
 * return to the trigger come from the platform instead of custom code.
 *
 * Glassmorphic surfaces match the Top priorities bento cards: frosted shells,
 * mesh gradient washes, and inset highlights. Only surfaces changed here; all
 * copy, heading levels, labels, and behavior are preserved exactly.
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
      ease: [0.16, 1, 0.3, 1],
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

export interface FindingDetailsDrawerProps {
  finding: Finding;
  rank: number;
  isPrimary: boolean;
  onInvestigate: (route: string) => void;
}

export function FindingDetailsDrawer({
  finding,
  rank,
  isPrimary,
  onInvestigate,
}: FindingDetailsDrawerProps) {
  const severity = getSeverityMeta(finding.severity);
  const SeverityIcon = severity.Icon;
  const verified = isVerifiedFinding(finding);
  const evidenceState = findingEvidenceAppState(finding);
  const availableObservations = finding.evidence.observations.filter(
    (obs) => obs.value !== null && obs.availability === "available",
  );
  const refCount = finding.evidence.references.length;
  const confidenceText = confidenceTextFor(finding);
  const periodLabel = periodLabelFor(finding);
  const categoryLabel = categoryLabelFor(finding);
  const stateLabel = verificationLabelFor(finding, isPrimary);
  const detectedIso = finding.detected_at || finding.last_verified_at;

  return (
    <SheetPortal>
      <SheetOverlay className="bg-[#17152F]/45 backdrop-blur-[2px] motion-reduce:animate-none" />
      <SheetPrimitive.Content
        aria-label={`Full details for priority ${rank}: ${finding.title}`}
        style={{
          background:
            `radial-gradient(420px 200px at 90% -60px, ${severity.glowRgba}, transparent 70%), ` +
            "radial-gradient(480px 200px at 12% -40px, rgba(68, 56, 232, 0.10), transparent 65%), " +
            "radial-gradient(360px 180px at 100% 30%, rgba(20, 184, 166, 0.08), transparent 60%), " +
            "linear-gradient(180deg, rgba(255,255,255,0.94) 0%, rgba(247,248,255,0.9) 100%)",
          boxShadow:
            "0 0 60px -12px rgba(31, 6, 172, 0.25), inset 1px 0 0 rgba(255, 255, 255, 0.9)",
        }}
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex h-full w-[min(560px,94vw)] flex-col border-l border-white/60 bg-white/85 backdrop-blur-2xl outline-none",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
          "data-[state=open]:duration-500 data-[state=closed]:duration-300",
          "motion-reduce:animate-none motion-reduce:transition-none",
        )}
      >
        {/* Header: severity identity + verification state */}
        <div
          className="relative shrink-0 border-b border-white/60 bg-white/50 px-5 pb-4 pt-5 backdrop-blur-md sm:px-6"
          style={{
            background: `radial-gradient(420px 150px at 90% -50px, ${severity.glowRgba}, transparent 70%), linear-gradient(180deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.2) 100%)`,
          }}
        >
          <div className="flex items-center justify-between gap-3 pr-10">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#667085]">
              Priority details
            </p>
            <span className="font-mono text-[11px] font-semibold tabular-nums text-[#475467]">
              #{rank}
            </span>
          </div>

          <div className="mt-3 flex items-start gap-3">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border"
              style={{
                borderColor: severity.border,
                background: `linear-gradient(140deg, #FFFFFF 0%, ${severity.softBg} 100%)`,
                boxShadow: `0 6px 14px -8px ${severity.glowRgba}, inset 0 1px 0 rgba(255, 255, 255, 0.9)`,
                color: severity.deep,
              }}
            >
              <SeverityIcon className="h-[18px] w-[18px]" strokeWidth={2.1} />
            </span>
            <div className="min-w-0 flex-1">
              <p
                className="text-[12.5px] font-bold leading-5 tracking-[-0.01em]"
                style={{ color: severity.deep }}
              >
                {severity.longLabel}
              </p>
              <p className="mt-0.5 truncate text-[11.5px] text-[#667085]">{categoryLabel}</p>
            </div>
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
          {(evidenceState === "stale" || evidenceState === "partial") && (
            <div className="mt-2.5">
              <StateBadge state={evidenceState} />
            </div>
          )}

          <SheetPrimitive.Close
            className={cn(
              "absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/60 bg-white/80 text-[#475467] backdrop-blur-md transition-colors hover:bg-white hover:text-[#17191F]",
              cc.focus,
            )}
          >
            <X className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        </div>

        {/* Scrollable body */}
        <div className="min-w-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          <SheetTitle asChild>
            <h2 className="text-balance text-[19px] font-semibold leading-[1.3] tracking-[-0.02em] text-[#101828]">
              {finding.title}
            </h2>
          </SheetTitle>
          <SheetDescription asChild>
            <p className="mt-1.5 text-[12px] tabular-nums text-[#667085]">
              {categoryLabel} · Detected {relativeTime(detectedIso)}
            </p>
          </SheetDescription>
          <p className="mt-3 text-[13.5px] leading-[1.65] text-[#344054]">
            {finding.description}
          </p>

          {/* Key evidence tiles for every recorded observation */}
          <div className="mt-5">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#667085]">
              Key evidence
            </h3>
            {availableObservations.length > 0 ? (
              <div
                className="mt-2.5 grid gap-2 sm:grid-cols-2"
                aria-label="Key supporting evidence"
              >
                {availableObservations.map((obs, idx) => (
                  <div
                    key={`${obs.label}-${idx}`}
                    className="min-w-0 rounded-xl border border-white/60 bg-white/70 px-3.5 py-3 backdrop-blur-md"
                    style={{
                      background:
                        "linear-gradient(180deg, rgba(240, 237, 255, 0.6) 0%, rgba(255, 255, 255, 0.75) 100%)",
                      boxShadow:
                        "inset 0 1px 1px rgba(255, 255, 255, 0.9), 0 2px 10px -3px rgba(15, 23, 42, 0.06)",
                    }}
                  >
                    <p className="truncate text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[#667085]">
                      {obs.label}
                    </p>
                    <p className="mt-1 break-words text-[16px] font-semibold tabular-nums tracking-[-0.01em] text-[#101828]">
                      <MetricValue item={obs} />
                    </p>
                    <p className="mt-0.5 text-[11px] capitalize text-[#98A2B3]">
                      {obs.period.replaceAll("_", " ")}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p
                className="mt-2.5 rounded-xl border border-white/60 bg-white/70 px-3.5 py-3 text-[12.5px] text-[#667085] backdrop-blur-md"
                style={{
                  boxShadow:
                    "inset 0 1px 1px rgba(255, 255, 255, 0.9), 0 2px 10px -3px rgba(15, 23, 42, 0.06)",
                }}
              >
                No verified observations recorded for this finding.
              </p>
            )}
            <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-[#667085]">
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

          {/* Recommendation band */}
          <div
            className="relative mt-5 overflow-hidden rounded-xl px-4 py-3.5 ring-1 ring-white/10"
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

          {finding.priority.tie?.statement && (
            <p className="mt-4 rounded-lg border border-white/60 bg-white/70 px-3 py-2 text-[12px] text-[#1F06AC] backdrop-blur-md">
              {finding.priority.tie.statement}
            </p>
          )}

          {/* Epistemic separation: Priority vs. Confidence vs. Limits */}
          {isPrimary && (
            <div
              className="mt-5 rounded-xl border border-white/60 bg-white/70 px-4 py-4 backdrop-blur-md"
              style={{
                boxShadow:
                  "inset 0 1px 1px rgba(255, 255, 255, 0.9), 0 2px 10px -3px rgba(15, 23, 42, 0.06)",
              }}
            >
              <div className="divide-y divide-slate-200/70">
                <div className="pb-3.5">
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#667085]">
                    Why this is the priority
                  </h3>
                  <ul className="mt-2 space-y-1 text-[12.5px] leading-relaxed text-[#475467]">
                    {(finding.priority.rationale.length > 0
                      ? finding.priority.rationale
                      : ["Ranked by verified severity, freshness, and coverage."]
                    ).map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>

                <div className="py-3.5">
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#667085]">
                    Confidence
                  </h3>
                  <ul className="mt-2 space-y-1 text-[12.5px] leading-relaxed text-[#475467]">
                    {(finding.confidence.rationale.length > 0
                      ? finding.confidence.rationale
                      : [confidenceText]
                    ).map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>

                <div className="pt-3.5">
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#667085]">
                    Limits of this conclusion
                  </h3>
                  <ul className="mt-2 space-y-1 text-[12.5px] leading-relaxed text-[#475467]">
                    {(finding.limitations.length > 0
                      ? finding.limitations
                      : ["No additional evidence limitations recorded."]
                    ).map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Provenance metadata */}
          <div
            className="mt-5 rounded-xl border border-white/60 bg-white/70 px-4 py-4 backdrop-blur-md"
            style={{
              boxShadow:
                "inset 0 1px 1px rgba(255, 255, 255, 0.9), 0 2px 10px -3px rgba(15, 23, 42, 0.06)",
            }}
          >
            <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#667085]">
              Evidence and provenance
            </h3>
            <dl className="mt-2.5 grid gap-x-4 gap-y-2.5 text-[12px] sm:grid-cols-2">
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
              <div className="mt-3.5">
                <p className="text-[12px] font-semibold text-[#172033]">Limitations</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12.5px] text-[#475467]">
                  {finding.limitations.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {finding.unknowns.length > 0 && (
              <div className="mt-3.5">
                <p className="text-[12px] font-semibold text-[#172033]">Unknowns</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12.5px] text-[#475467]">
                  {finding.unknowns.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {finding.evidence.references.length > 0 && (
              <div className="mt-3.5">
                <p className="text-[12px] font-semibold text-[#172033]">Evidence references</p>
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
              <p className="mt-3 text-[11px] text-[#667085]">
                Deduplicated records retained: {finding.evidence.duplicate_finding_ids.join(", ")}
              </p>
            )}
          </div>
        </div>

        {/* Sticky footer action */}
        <div className="shrink-0 border-t border-white/60 bg-white/70 px-5 py-4 backdrop-blur-xl sm:px-6">
          <button
            type="button"
            onClick={() => onInvestigate(finding.investigation.route)}
            className={cn(
              "inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-[13px] font-semibold text-white transition-all duration-200 hover:brightness-110",
              cc.focus,
            )}
            style={{
              background: "linear-gradient(135deg, #5146E5 0%, #3525B8 55%, #1F06AC 100%)",
              boxShadow:
                "0 10px 22px -10px rgba(31, 6, 172, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.25)",
            }}
          >
            <span>Ask Rev about this finding</span>
            <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
          </button>
        </div>
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}

export default FindingDetailsDrawer;
