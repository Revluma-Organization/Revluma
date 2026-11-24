import { type MouseEvent, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { StateBadge, type CommandCenterAppState } from "./StateBadge";
import { cc } from "./tokens";
import type { Finding, SignalCategoryId } from "./types";

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

const SIGNAL_CATEGORY_LABELS: Record<SignalCategoryId, string> = {
  storefront_readiness: "Storefront readiness",
  traffic_acquisition: "Traffic & acquisition",
  sales_revenue: "Sales & revenue",
  conversion_purchasing: "Conversion & purchasing",
  product_inventory: "Product & inventory",
  customer_fulfillment: "Customer & fulfillment",
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

function observationText(item: Finding["evidence"]["observations"][number]): string {
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

function getSeverityMeta(severity: Finding["severity"]) {
  if (severity === "critical") {
    return {
      pillLabel: "Critical priority",
      pillClass: "border-[#F3C7C3] bg-[#FFF5F4] text-[#A12A22]",
      impactBars: 3,
    };
  }
  if (severity === "high") {
    return {
      pillLabel: "High priority",
      pillClass: "border-[#F3C7C3] bg-[#FFF5F4] text-[#A12A22]",
      impactBars: 3,
    };
  }
  if (severity === "medium") {
    return {
      pillLabel: "Medium priority",
      pillClass: "border-[#F2DDB8] bg-[#FFFAF0] text-[#925B13]",
      impactBars: 2,
    };
  }
  return {
    pillLabel: "Low priority",
    pillClass: "border-[#E3E7EF] bg-[#F8F9FB] text-[#475467]",
    impactBars: 1,
  };
}

function ImpactMeter({
  level,
  hovered,
  index,
  reducedMotion,
}: {
  level: number;
  hovered: boolean;
  index: number;
  reducedMotion: boolean;
}) {
  return (
    <span
      className="inline-flex items-center gap-2 whitespace-nowrap text-[11.5px] text-[#667085]"
      aria-label={`Impact level ${level} of 3`}
    >
      <span>Impact</span>
      <span className="inline-flex items-center gap-[3px]" aria-hidden="true">
        {[1, 2, 3].map((bar) => {
          const filled = bar <= level;
          return (
            <motion.i
              key={bar}
              className="block h-[5.5px] w-[13px] origin-left rounded-[2px]"
              style={{ backgroundColor: filled ? "#1F06AC" : "#E4E7EC" }}
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
                        delay: 0.14 + index * 0.06 + (bar - 1) * 0.07,
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

  const severity = getSeverityMeta(finding.severity);
  const verified = isVerifiedFinding(finding);
  const evidenceState = findingEvidenceAppState(finding);
  const availableObservations = finding.evidence.observations.filter(
    (obs) => obs.value !== null && obs.availability === "available",
  );
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
    ? "Investigate in Rev Intelligence"
    : finding.next_step?.label && finding.next_step.label !== "Investigate with Rev"
      ? finding.next_step.label
      : "View investigation";

  const handleRowClick = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, a, summary, details, input")) return;
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
      initial={reducedMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: reducedMotion ? 0 : 0.48,
        delay: reducedMotion ? 0 : delayIndex * 0.06,
        ease: EASE_OUT_EXPO,
      }}
      className={cn(
        "group relative min-w-0 cursor-pointer px-5 py-4 transition-colors duration-200",
        isPrimary ? "hover:bg-[#F4F5FF]" : "bg-white hover:bg-[#F7F8FF]",
      )}
      style={
        isPrimary
          ? { background: "linear-gradient(105deg, #F7F8FF 0%, #FFFFFF 70%)" }
          : undefined
      }
    >
      {/* Line 1: Landing-page SeverityPill + calm right-aligned state */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2.5 py-[3px] text-[10px] font-bold uppercase leading-none tracking-[0.08em]",
              severity.pillClass,
            )}
          >
            {severity.pillLabel}
          </span>
          <span className="font-mono text-[11px] font-medium tabular-nums text-[#98A2B3]">
            #{rank}
          </span>
          {(evidenceState === "stale" || evidenceState === "partial") && (
            <StateBadge state={evidenceState} />
          )}
        </div>

        <span className="text-[12px] font-semibold text-[#4655A4]">{stateLabel}</span>
      </div>

      {/* Line 2: Clean scannable issue headline */}
      <div className="mt-2.5">
        {isPrimary ? (
          <h3 className="text-[15.5px] font-semibold leading-[1.35] tracking-[-0.015em] text-[#172033]">
            {finding.title}
          </h3>
        ) : (
          <h4 className="text-[14.5px] font-semibold leading-[1.35] tracking-[-0.012em] text-[#172033]">
            {finding.title}
          </h4>
        )}
      </div>

      {/* Line 3: Quiet category & detected timestamp + Revluma 3-bar Impact meter */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[12px] text-[#667085]">
        <span className="truncate">
          {categoryLabel} · Detected {relativeTime(detectedIso)}
        </span>

        <ImpactMeter
          level={severity.impactBars}
          hovered={hovered}
          index={delayIndex}
          reducedMotion={reducedMotion}
        />
      </div>

      {/* Line 4: Compact disclosure trigger + clean Rev Intelligence action */}
      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3">
        <details className="group/details min-w-0 flex-1">
          <summary
            className={cn(
              cc.disclosure,
              "inline-flex cursor-pointer list-none items-center gap-1.5 select-none text-[12px] font-medium text-[#4655A4] transition-colors hover:text-[#1F06AC] [&::-webkit-details-marker]:hidden",
            )}
          >
            Inspect evidence, provenance and uncertainty
            <ChevronDown
              className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-open/details:rotate-180"
              aria-hidden="true"
            />
          </summary>

          {/* Progressive disclosure: full evidence, next step, rationale, confidence, limitations & provenance */}
          <div className="mt-3 space-y-4 rounded-xl border border-[#E8ECF3] bg-[#FCFCFD] p-4 text-[12.5px] leading-5 text-[#475467]">
            {/* Observed verified figures */}
            {availableObservations.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex flex-wrap gap-2">
                  {availableObservations.map((obs, idx) => (
                    <div
                      key={`${obs.label}-${idx}`}
                      className="rounded-lg border border-[#E8ECF3] bg-white px-3 py-1.5"
                    >
                      <span className="block text-[11px] text-[#667085]">{obs.label}</span>
                      <span className="text-[13px] font-semibold tabular-nums text-[#172033]">
                        {observationText(obs)}
                      </span>
                    </div>
                  ))}
                </div>
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

            {/* Factual explanation */}
            <p className="text-[12.5px] leading-5 text-[#344054]">{finding.description}</p>

            {finding.priority.tie?.statement && (
              <p className="rounded-lg border border-[#E3E1FA] bg-[#F7F8FF] px-3 py-2 text-[12px] text-[#1F06AC]">
                {finding.priority.tie.statement}
              </p>
            )}

            {/* Recommended merchant next step */}
            <div className="rounded-lg border border-[#E8ECF3] bg-white p-3">
              <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#1F06AC]">
                Next step
              </p>
              {finding.recommendation.available && finding.recommendation.step ? (
                <div className="mt-1.5 space-y-1">
                  <p className="text-[12.5px] font-semibold text-[#172033]">
                    {finding.recommendation.step}
                  </p>
                  {finding.recommendation.expected_result && (
                    <p className="text-[12px] text-[#475467]">
                      {finding.recommendation.expected_result}
                    </p>
                  )}
                  <p className="pt-0.5 text-[11px] text-[#667085]">
                    Read-only merchant action, not executed by Revluma.
                  </p>
                </div>
              ) : finding.recommendation.prerequisites.length > 0 ? (
                <ul className="mt-1.5 space-y-1 text-[12px] text-[#475467]">
                  {finding.recommendation.prerequisites.map((prereq, idx) => (
                    <li key={idx}>{prereq}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1.5 text-[12px] text-[#667085]">
                  Review this signal in Rev Intelligence with its underlying records.
                </p>
              )}
            </div>

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
        </details>

        <motion.button
          type="button"
          onClick={() => onInvestigate(finding.investigation.route)}
          onMouseEnter={() => setCtaHovered(true)}
          onMouseLeave={() => setCtaHovered(false)}
          whileTap={reducedMotion ? undefined : { scale: 0.98 }}
          className={cn(
            "relative inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-lg px-3.5 py-1.5 text-[12px] font-semibold transition-colors",
            isPrimary
              ? "bg-[#1F06AC] text-white hover:bg-[#2B13CF]"
              : "border border-[#E3E1FA] bg-white text-[#1F06AC] hover:border-[#2B13CF] hover:bg-[#F7F8FF]",
            cc.focus,
          )}
          style={
            isPrimary
              ? {
                  boxShadow:
                    "0 8px 18px -10px rgba(31, 6, 172, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.2)",
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
    </motion.article>
  );
}

export default PriorityFindingCard;
