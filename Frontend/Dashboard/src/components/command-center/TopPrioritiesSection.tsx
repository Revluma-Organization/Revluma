import { ArrowRight, ChevronDown, Compass, ShieldAlert } from "lucide-react";
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
  const finding = data.priority_finding;
  const secondary = (data.findings || []).filter((item) => item.id !== finding?.id);
  const eligibleCount = data.priority_selection.eligible_count;
  const isCritical = Boolean(finding && ["critical", "high"].includes(finding.severity));
  const verified = finding ? isVerifiedFinding(finding) : false;

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

  return (
    <section
      id="priority-finding"
      aria-labelledby="priority-findings-heading"
      className={cn(
        finding ? cc.intelligence : cc.surface,
        "scroll-mt-24",
      )}
    >
      {/* Section Header */}
      <div
        className={cn(
          "flex flex-col gap-2.5 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6",
          cc.divider,
        )}
      >
        <div className="min-w-0">
          <h2 id="priority-findings-heading" className={cc.sectionTitle}>
            Top priorities
          </h2>
          <p className="mt-0.5 text-[13px] leading-5 text-[#707582]">
            The most important issues identified across your store.
          </p>
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
            "border-l-[3px] px-5 py-5 sm:px-6 sm:py-6",
            isCritical ? "border-l-[#B42318]" : "border-l-[#4438E8]",
          )}
        >
          {/* Rank, Severity, Verification & Freshness Metadata */}
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium">
            <span className="inline-flex items-center rounded-md bg-[#17191F] px-2 py-0.5 font-semibold text-white tabular-nums">
              #1
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-semibold capitalize",
                severityPillClass(finding.severity),
              )}
            >
              <ShieldAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
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
            <span className="text-[#707582]">
              {finding.confidence.classification.replaceAll("_", " ")} confidence
            </span>
            <span aria-hidden="true" className="text-[#D0D5DD]">
              ·
            </span>
            <span className="text-[#707582]">
              {finding.evidence_freshness.state} evidence · {finding.coverage.state} coverage
            </span>
          </div>

          {/* 1. Title & Description */}
          <h3
            id="current-priority-title"
            className="mt-3 text-lg font-semibold leading-snug tracking-[-0.02em] text-[#17191F] sm:text-xl"
          >
            {finding.title}
          </h3>
          <p className={cn("mt-1.5 max-w-4xl", cc.body)}>{finding.description}</p>

          {/* 3, 4, 5. Business Impact, Supporting Evidence & Why It Matters */}
          <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
            <div className="space-y-4">
              <div>
                <h4 className={cc.cardTitle}>Why this is the priority</h4>
                <ul className={cn("mt-1.5 space-y-1", cc.metadata)}>
                  {finding.priority.rationale.map((reason) => (
                    <li key={reason} className="flex gap-2">
                      <span aria-hidden="true" className="text-[#98A2B3]">
                        •
                      </span>
                      <span>{reason}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h4 className={cc.cardTitle}>Confidence</h4>
                <ul className={cn("mt-1.5 space-y-1", cc.metadata)}>
                  {finding.confidence.rationale.map((reason) => (
                    <li key={reason} className="flex gap-2">
                      <span aria-hidden="true" className="text-[#98A2B3]">
                        •
                      </span>
                      <span>{reason}</span>
                    </li>
                  ))}
                </ul>
                {finding.priority.tie && (
                  <p className={cn("mt-2", cc.metadata)}>{finding.priority.tie.statement}</p>
                )}
              </div>

              {finding.limitations.length > 0 && (
                <div className={cn("border-t pt-3", cc.divider)}>
                  <h4 className={cc.cardTitle}>Limits of this conclusion</h4>
                  <ul className={cn("mt-1.5 space-y-1", cc.metadata)}>
                    {finding.limitations.map((limit) => (
                      <li key={limit} className="flex gap-2">
                        <span aria-hidden="true" className="text-[#98A2B3]">
                          •
                        </span>
                        <span>{limit}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className={cn(cc.surfaceSubtle, "p-4")}>
              <h4 className={cc.cardTitle}>Supporting observations</h4>
              <dl className="mt-3 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
                {finding.evidence.observations.map((item) => (
                  <div
                    key={`${item.period}-${item.label}`}
                    className="min-w-0 rounded-lg border border-[#E7E9EF] bg-white px-3.5 py-2.5"
                  >
                    <dt className="text-[11px] font-medium text-[#707582]">{item.label}</dt>
                    <dd className="mt-1 break-words text-base font-semibold tracking-[-0.015em] text-[#17191F] tabular-nums">
                      {observationText(item)}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className={cn("mt-3 tabular-nums", cc.metadata)}>
                {finding.reporting_period.kind.replaceAll("_", " ")} ·{" "}
                {finding.reporting_period.timezone}
                <br />
                Last verified {dateTime(finding.last_verified_at)}
              </p>
            </div>
          </div>

          {/* 6. Recommended Next Investigation / Action */}
          <div className="mt-5 rounded-xl border border-[#E0DFFA] bg-[#F6F6FE] p-4">
            <h4 className={cc.cardTitle}>
              Recommended next step{" "}
              <span className="font-normal text-[#707582]">
                · merchant action, not executed by Revluma
              </span>
            </h4>
            {finding.recommendation.available ? (
              <>
                <p className={cn("mt-1.5", cc.body)}>{finding.recommendation.step}</p>
                {finding.recommendation.rationale && (
                  <p className={cn("mt-1.5", cc.metadata)}>
                    <span className="font-semibold text-[#17191F]">Why it matters: </span>
                    {finding.recommendation.rationale}
                  </p>
                )}
                {finding.recommendation.expected_result && (
                  <p className={cn("mt-1", cc.metadata)}>
                    <span className="font-semibold text-[#17191F]">Look for: </span>
                    {finding.recommendation.expected_result}
                  </p>
                )}
              </>
            ) : (
              <p className={cn("mt-1.5", cc.metadata)}>
                {finding.recommendation.prerequisites.join(" ")}
              </p>
            )}
          </div>

          {/* Expandable Provenance & Uncertainty */}
          <details className="group mt-4">
            <summary
              className={cn(
                "inline-flex list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden",
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
                    <li key={ref.id}>
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
            <button
              type="button"
              onClick={() => openRoute(finding.investigation.route)}
              className={cc.primary}
            >
              <span>Investigate in Rev Intelligence</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </article>
      ) : (
        /* Compact, Intentional Empty State — Never a Giant Empty Card */
        <div className="px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 max-w-2xl">
              <p className="text-sm font-semibold text-[#17191F]">
                No verified priorities right now
              </p>
              <p className="mt-1 text-[13px] leading-5 text-[#707582]">
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
            </div>

            <button
              type="button"
              onClick={() => openRoute("/dashboard/rev-intell")}
              className={cn(cc.secondary, "self-start sm:self-center")}
            >
              <Compass className="h-3.5 w-3.5 text-[#4438E8]" aria-hidden="true" />
              <span>Explore with Rev Intell</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          {data.priority_selection.exclusions.length > 0 && (
            <div className={cn("mt-4 border-t pt-3.5", cc.divider)}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#707582]">
                Excluded historical findings
              </p>
              <ul
                className={cn("mt-2 space-y-1.5", cc.metadata)}
                aria-label="Findings excluded from current priority"
              >
                {data.priority_selection.exclusions.map((item) => (
                  <li key={item.finding_id}>
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
        <div className={cn("border-t bg-[#FAFBFD] px-5 py-4 sm:px-6", cc.divider)}>
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[#707582]">
            Other eligible findings
          </h3>
          <div className={cn("mt-3 divide-y", cc.divider)}>
            {secondary.map((item, idx) => {
              const itemVerified = isVerifiedFinding(item);
              return (
                <article
                  key={item.id}
                  className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-semibold text-[#707582] tabular-nums">
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
                    className={cc.secondary}
                  >
                    <span>Investigate</span>
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
