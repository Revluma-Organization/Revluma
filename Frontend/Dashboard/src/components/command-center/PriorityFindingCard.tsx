import { type MouseEvent, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Check, ChevronDown, Clock } from "lucide-react";
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
  if (!value) return "Not recorded";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "Not recorded";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
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

function formatPeriodLabel(kind: string, timezone: string): string {
  return `${kind.replaceAll("_", " ").trim()} · ${timezone}`;
}

function formatSourceLabel(source: string): string {
  return source.replaceAll("_", " ");
}

function getSeverityVisual(severity: Finding["severity"]) {
  if (severity === "critical") {
    return {
      label: "Critical",
      dotColor: "#E5484D",
      pulseColor: "rgba(229, 72, 77, 0.45)",
      textColorClass: "text-[#B42318]",
      spotlightRgba: "rgba(229, 72, 77, 0.045)",
      topRuleColor: "linear-gradient(90deg, #E5484D 0%, #2B13CF 45%, transparent 100%)",
    };
  }
  if (severity === "high") {
    return {
      label: "High",
      dotColor: "#E26328",
      pulseColor: "rgba(226, 99, 40, 0.42)",
      textColorClass: "text-[#B54708]",
      spotlightRgba: "rgba(43, 19, 207, 0.045)",
      topRuleColor: "linear-gradient(90deg, #1F06AC 0%, #7460FF 48%, transparent 100%)",
    };
  }
  if (severity === "medium") {
    return {
      label: "Medium",
      dotColor: "#D99116",
      pulseColor: "rgba(217, 145, 22, 0.35)",
      textColorClass: "text-[#92400E]",
      spotlightRgba: "rgba(217, 145, 22, 0.045)",
      topRuleColor: "linear-gradient(90deg, #D99116 0%, #7460FF 45%, transparent 100%)",
    };
  }
  return {
    label: "Low",
    dotColor: "#2B13CF",
    pulseColor: "rgba(43, 19, 207, 0.35)",
    textColorClass: "text-[#2B13CF]",
    spotlightRgba: "rgba(43, 19, 207, 0.045)",
    topRuleColor: "linear-gradient(90deg, #2B13CF 0%, #7460FF 45%, transparent 100%)",
  };
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
  const [pointer, setPointer] = useState<{ x: number; y: number; active: boolean }>({
    x: 50,
    y: 50,
    active: false,
  });
  const [ctaHovered, setCtaHovered] = useState(false);

  const severity = getSeverityVisual(finding.severity);
  const verified = isVerifiedFinding(finding);
  const evidenceState = findingEvidenceAppState(finding);
  const availableObservations = finding.evidence.observations.filter(
    (obs) => obs.value !== null && obs.availability === "available",
  );
  const refCount = finding.evidence.references.length;
  const confidenceText = `${finding.confidence.classification.replaceAll("_", " ")} confidence`;
  const updatedIso = finding.last_verified_at || finding.detected_at;
  const periodLabel = formatPeriodLabel(
    finding.reporting_period.kind,
    finding.reporting_period.timezone,
  );
  const categoryLabel = finding.signal_category
    ? SIGNAL_CATEGORY_LABELS[finding.signal_category]
    : null;

  const handleCardClick = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, a, summary, details, input")) return;
    onInvestigate(finding.investigation.route);
  };

  const handleMouseMove = (event: MouseEvent<HTMLElement>) => {
    if (reducedMotion) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    setPointer({
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
      active: true,
    });
  };

  const handleMouseLeave = () => {
    setPointer((prev) => ({ ...prev, active: false }));
  };

  const ctaLabel = isPrimary
    ? "Investigate in Rev Intelligence"
    : finding.next_step?.label && finding.next_step.label !== "Investigate with Rev"
      ? finding.next_step.label
      : "View investigation";

  const showPulse =
    isPrimary &&
    !reducedMotion &&
    (finding.severity === "critical" || finding.severity === "high");

  const delayIndex = Math.min(rank - 1, 5);

  return (
    <motion.article
      data-severity={finding.severity}
      data-priority-primary={isPrimary ? "true" : "false"}
      onClick={handleCardClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      initial={reducedMotion ? false : { opacity: 0, y: 14, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{
        duration: reducedMotion ? 0 : 0.56,
        delay: reducedMotion ? 0 : delayIndex * 0.065,
        ease: EASE_OUT_EXPO,
      }}
      className={cn(
        "group relative min-w-0 cursor-pointer overflow-hidden rounded-2xl border bg-white transition-[border-color,box-shadow] duration-200",
        isPrimary
          ? "border-[#DBD8F4] hover:border-[#B9B3EC]"
          : "border-[#E6E5EE] hover:border-[#CFCBF4]",
      )}
      style={{
        boxShadow: isPrimary
          ? "0 1px 2px rgba(12, 10, 29, 0.04), 0 18px 38px -26px rgba(31, 6, 172, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.96)"
          : "0 1px 2px rgba(12, 10, 29, 0.03), 0 12px 26px -22px rgba(12, 10, 29, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.96)",
      }}
    >
      {/* Interactive pointer-tracked radial studio spotlight */}
      {!reducedMotion && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[inherit] transition-opacity duration-300"
          style={{
            opacity: pointer.active ? 1 : 0,
            background: `radial-gradient(380px circle at ${pointer.x}% ${pointer.y}%, ${severity.spotlightRgba}, transparent 72%)`,
          }}
        />
      )}

      {/* Subtle architectural top rule sweep on primary #1 finding (inspired by landing motion.css .m-rule) */}
      {isPrimary && (
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 z-20 h-[2px] origin-left"
          style={{ background: severity.topRuleColor }}
          initial={reducedMotion ? { scaleX: 1 } : { scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: reducedMotion ? 0 : 0.78, delay: 0.12, ease: EASE_OUT_EXPO }}
        />
      )}

      <div
        className={cn(
          "relative z-10 grid min-w-0",
          isPrimary
            ? "lg:grid-cols-[minmax(0,1fr)_316px]"
            : "lg:grid-cols-[minmax(0,1fr)_276px]",
        )}
      >
        {/* Main Editorial Intelligence Column */}
        <div className={cn("min-w-0", isPrimary ? "p-5 sm:p-6" : "p-5")}>
          {/* Clean Top Meta Bar: Rank, Severity Dot, Category, Verification & Timestamp */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex flex-wrap items-center gap-2.5 text-[12px]">
              <span className="font-mono text-[11px] font-semibold tabular-nums text-[#7C7A8C]">
                #{rank}
              </span>

              <span className="h-3 w-px bg-[#E6E5EE]" aria-hidden="true" />

              <span className="inline-flex items-center gap-1.5 font-semibold tracking-[-0.01em]">
                <span className="relative flex h-2 w-2 shrink-0 items-center justify-center">
                  {showPulse && (
                    <motion.span
                      aria-hidden="true"
                      className="absolute inline-flex h-full w-full rounded-full"
                      style={{ backgroundColor: severity.pulseColor }}
                      animate={{ scale: [1, 2.3], opacity: [0.55, 0] }}
                      transition={{
                        duration: 2.3,
                        repeat: Infinity,
                        repeatDelay: 1.1,
                        ease: EASE_OUT_EXPO,
                      }}
                    />
                  )}
                  <span
                    aria-hidden="true"
                    className="relative inline-flex h-2 w-2 rounded-full"
                    style={{ backgroundColor: severity.dotColor }}
                  />
                </span>
                <span className={severity.textColorClass}>{severity.label}</span>
              </span>

              {categoryLabel && (
                <>
                  <span className="h-3 w-px bg-[#E6E5EE]" aria-hidden="true" />
                  <span className="text-[12px] font-medium text-[#4D4B5E]">
                    {categoryLabel}
                  </span>
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2.5 text-[11.5px] text-[#6E6C7A]">
              {isPrimary && (
                <span className="inline-flex items-center gap-1 rounded-full border border-[#E6E4F5] bg-[#F8F7FE] px-2.5 py-0.5 text-[11px] font-medium text-[#2B13CF]">
                  <Check className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>{verified ? "Verified finding" : "Evidence-limited"}</span>
                </span>
              )}

              {(evidenceState === "stale" || evidenceState === "partial") && (
                <StateBadge state={evidenceState} />
              )}

              {updatedIso && (
                <span
                  className="inline-flex items-center gap-1 tabular-nums text-[#7C7A8C]"
                  title={dateTime(updatedIso)}
                >
                  <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>Updated {relativeTime(updatedIso)}</span>
                </span>
              )}
            </div>
          </div>

          {/* Confident Display Headline */}
          <div className="mt-3.5">
            {isPrimary ? (
              <h3 className="text-[1.0625rem] font-semibold leading-[1.32] tracking-[-0.02em] text-[#0C0A1D]">
                {finding.title}
              </h3>
            ) : (
              <h4 className="text-[0.95rem] font-semibold leading-[1.35] tracking-[-0.018em] text-[#0C0A1D]">
                {finding.title}
              </h4>
            )}
          </div>

          {/* Structured Studio Metric Ledger for Observed Figures */}
          {availableObservations.length > 0 && (
            <div className="mt-4 overflow-hidden rounded-xl border border-[#ECEBF3] bg-[#FAF9FC]">
              <div
                className={cn(
                  "grid divide-y divide-[#ECEBF3] sm:divide-x sm:divide-y-0",
                  availableObservations.length === 1 && "sm:grid-cols-1",
                  availableObservations.length === 2 && "sm:grid-cols-2",
                  availableObservations.length === 3 && "sm:grid-cols-3",
                  availableObservations.length >= 4 && "sm:grid-cols-2 xl:grid-cols-4",
                )}
              >
                {availableObservations.map((obs, idx) => (
                  <div key={`${obs.label}-${idx}`} className="min-w-0 px-3.5 py-2.5">
                    <p className="truncate text-[11px] font-medium leading-4 text-[#6E6C7A]">
                      {obs.label}
                    </p>
                    <p className="mt-1 text-[14px] font-semibold leading-5 tracking-[-0.02em] tabular-nums text-[#0C0A1D] break-words">
                      {observationText(obs)}
                    </p>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#ECEBF3] bg-white/60 px-3.5 py-1.5 text-[11px] text-[#7C7A8C]">
                <span className="first-letter:uppercase">{periodLabel}</span>
                <span className="inline-flex items-center gap-1.5 tabular-nums">
                  <span>
                    {refCount > 0
                      ? `${refCount} ${refCount === 1 ? "verified source" : "verified sources"}`
                      : formatSourceLabel(finding.evidence.source)}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{confidenceText}</span>
                </span>
              </div>
            </div>
          )}

          {/* Concise Factual Description */}
          <p className="mt-3.5 max-w-[66ch] text-[13.5px] leading-[1.62] text-[#4A485B]">
            {finding.description}
          </p>

          {/* Deterministic tie statement, when present */}
          {finding.priority.tie?.statement && (
            <p className="mt-3 rounded-xl border border-[#E4E1F9] bg-[#F8F7FE] px-3.5 py-2 text-xs leading-5 text-[#2B13CF]">
              {finding.priority.tie.statement}
            </p>
          )}

          {/* Fallback compact evidence line when no structured observations exist */}
          {availableObservations.length === 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[#6E6C7A]">
              <span className="tabular-nums">
                Evidence:{" "}
                <strong className="font-medium text-[#0C0A1D]">
                  {refCount > 0
                    ? `${refCount} ${refCount === 1 ? "source" : "sources"}`
                    : formatSourceLabel(finding.evidence.source)}
                </strong>
              </span>
              <span aria-hidden="true" className="text-[#D4D2E0]">
                ·
              </span>
              <span className="capitalize">{confidenceText}</span>
            </div>
          )}

          {/* Primary Finding Architectural Epistemic Ledger (Unified Hairline Columns) */}
          {isPrimary && (
            <div className="mt-5 grid gap-4 border-t border-[#ECEBF3] pt-4 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-[#ECEBF3]">
              <div className="min-w-0 sm:pr-4">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[10px] font-semibold tabular-nums text-[#2B13CF]">
                    01
                  </span>
                  <h4 className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[#5C5A6D]">
                    Why this is the priority
                  </h4>
                </div>
                <ul className="mt-2 space-y-1 text-[12px] leading-[1.52] text-[#4A485B]">
                  {(finding.priority.rationale.length > 0
                    ? finding.priority.rationale
                    : ["Ranked by verified severity, freshness, and coverage."]
                  ).map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>

              <div className="min-w-0 sm:px-4">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[10px] font-semibold tabular-nums text-[#2B13CF]">
                    02
                  </span>
                  <h4 className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[#5C5A6D]">
                    Confidence
                  </h4>
                </div>
                <ul className="mt-2 space-y-1 text-[12px] leading-[1.52] text-[#4A485B]">
                  {(finding.confidence.rationale.length > 0
                    ? finding.confidence.rationale
                    : [confidenceText]
                  ).map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>

              <div className="min-w-0 sm:pl-4">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[10px] font-semibold tabular-nums text-[#2B13CF]">
                    03
                  </span>
                  <h4 className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[#5C5A6D]">
                    Limits of this conclusion
                  </h4>
                </div>
                <ul className="mt-2 space-y-1 text-[12px] leading-[1.52] text-[#4A485B]">
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

          {/* Keyboard-native progressive disclosure for provenance, lifecycle & unknowns */}
          <details className="group/details mt-4">
            <summary
              className={cn(
                cc.disclosure,
                "inline-flex cursor-pointer list-none items-center gap-1.5 select-none text-[12px] font-medium text-[#2B13CF] transition-colors hover:text-[#1F06AC] [&::-webkit-details-marker]:hidden",
              )}
            >
              Inspect evidence, provenance and uncertainty
              <ChevronDown
                className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-open/details:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <div className="mt-2.5 space-y-2.5 rounded-xl border border-[#ECEBF3] bg-[#FAF9FC] p-3.5 text-xs leading-5 text-[#4A485B]">
              <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
                <div>
                  <dt className="font-medium text-[#7C7A8C]">Finding ID</dt>
                  <dd className="mt-0.5 font-mono text-[11px] text-[#0C0A1D] break-all">
                    {finding.id}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-[#7C7A8C]">Ranking method</dt>
                  <dd className="mt-0.5 font-mono text-[11px] text-[#0C0A1D]">
                    {finding.priority.method_version}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-[#7C7A8C]">Coverage run</dt>
                  <dd className="mt-0.5 text-[#0C0A1D]">
                    {finding.coverage.run_id || "Not recorded"}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-[#7C7A8C]">Lifecycle validity</dt>
                  <dd className="mt-0.5 text-[#0C0A1D]">
                    {finding.lifecycle.current_validity.replaceAll("_", " ")}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-[#7C7A8C]">Detected</dt>
                  <dd className="mt-0.5 tabular-nums text-[#0C0A1D]">
                    {dateTime(finding.detected_at)}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-[#7C7A8C]">Last verified</dt>
                  <dd className="mt-0.5 tabular-nums text-[#0C0A1D]">
                    {dateTime(finding.last_verified_at)}
                  </dd>
                </div>
              </dl>

              {!isPrimary && finding.limitations.length > 0 && (
                <div>
                  <p className="font-medium text-[#0C0A1D]">Limitations</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {finding.limitations.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {finding.unknowns.length > 0 && (
                <div>
                  <p className="font-medium text-[#0C0A1D]">Unknowns</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {finding.unknowns.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {finding.evidence.references.length > 0 && (
                <div>
                  <p className="font-medium text-[#0C0A1D]">Evidence references</p>
                  <ul className="mt-1 space-y-0.5">
                    {finding.evidence.references.map((ref) => (
                      <li key={ref.id} className="font-mono text-[11px] text-[#4A485B]">
                        {ref.source_type}: {ref.source_record_id}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {finding.evidence.duplicate_finding_ids.length > 0 && (
                <p className="text-[11px] text-[#7C7A8C]">
                  Deduplicated records retained: {finding.evidence.duplicate_finding_ids.join(", ")}
                </p>
              )}
            </div>
          </details>
        </div>

        {/* Sculpted Architectural Action Rail ("Next step" + Rev Intelligence CTA) */}
        <div
          className={cn(
            "flex flex-col justify-between gap-5 border-t border-[#ECEBF3] bg-[#FAF9FC] lg:border-l lg:border-t-0",
            isPrimary ? "p-5 sm:p-6" : "p-5",
          )}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="h-1.5 w-1.5 rounded-full bg-[#2B13CF]"
                aria-hidden="true"
              />
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[#2B13CF]">
                Next step
              </span>
            </div>

            {finding.recommendation.available && finding.recommendation.step ? (
              <div className="mt-3 space-y-2">
                <p className="text-[13.5px] font-semibold leading-[1.48] tracking-[-0.01em] text-[#0C0A1D]">
                  {finding.recommendation.step}
                </p>
                {finding.recommendation.expected_result && (
                  <p className="text-[12.5px] leading-[1.55] text-[#5C5A6D]">
                    {finding.recommendation.expected_result}
                  </p>
                )}
              </div>
            ) : finding.recommendation.prerequisites.length > 0 ? (
              <ul className="mt-3 space-y-1.5 text-[12.5px] leading-[1.55] text-[#5C5A6D]">
                {finding.recommendation.prerequisites.map((prereq, idx) => (
                  <li key={idx}>{prereq}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-[12.5px] leading-[1.55] text-[#5C5A6D]">
                Review this signal in Rev Intelligence with its underlying records.
              </p>
            )}
          </div>

          <div className="space-y-3 pt-1">
            {finding.recommendation.available && finding.recommendation.step && (
              <p className="border-t border-[#ECEBF3] pt-3 text-[11px] leading-4 text-[#7C7A8C]">
                Read-only merchant action, not executed by Revluma.
              </p>
            )}

            <motion.button
              type="button"
              onClick={() => onInvestigate(finding.investigation.route)}
              onMouseEnter={() => setCtaHovered(true)}
              onMouseLeave={() => setCtaHovered(false)}
              whileTap={reducedMotion ? undefined : { scale: 0.985 }}
              className={cn(
                "relative inline-flex min-h-10 w-full items-center justify-center gap-2 overflow-hidden rounded-xl px-4 py-2.5 text-[12.5px] font-semibold transition-all duration-200",
                isPrimary
                  ? "bg-[#1F06AC] text-white hover:bg-[#2B13CF]"
                  : "border border-[#DBD8F4] bg-white text-[#1F06AC] hover:border-[#2B13CF] hover:bg-[#F7F6FF]",
                cc.focus,
              )}
              style={
                isPrimary
                  ? {
                      boxShadow:
                        "0 10px 24px -12px rgba(31, 6, 172, 0.62), inset 0 1px 0 rgba(255, 255, 255, 0.22)",
                    }
                  : {
                      boxShadow:
                        "0 1px 2px rgba(12, 10, 29, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.95)",
                    }
              }
            >
              {/* Landing-page diagonal sheen sweep on hover (inspired by motion.css .m-shine) */}
              {isPrimary && !reducedMotion && (
                <motion.span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-white/25 to-transparent"
                  initial={{ x: "-100%" }}
                  animate={ctaHovered ? { x: "420%" } : { x: "-100%" }}
                  transition={{ duration: 0.68, ease: EASE_OUT_EXPO }}
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
        </div>
      </div>
    </motion.article>
  );
}

export default PriorityFindingCard;
