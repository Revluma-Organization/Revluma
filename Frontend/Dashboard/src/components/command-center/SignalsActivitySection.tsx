import { useMemo } from "react";
import { OperationalActivity } from "./CommandCenterSections";
import { SignalsTable } from "./SignalsTable";
import { selectQueueFindings } from "./findingDisplay";
import { cc } from "./tokens";
import type { CommandCenterData } from "./types";

export interface SignalsActivitySectionProps {
  data: CommandCenterData;
}

/**
 * Stage 4 "Signals & Activity" section: the explorable detected-signals
 * table followed by the existing recorded-activity feed (reused untouched,
 * so its cursor pagination, anchors, and honesty states are preserved).
 */
export function SignalsActivitySection({ data }: SignalsActivitySectionProps) {
  const queue = useMemo(() => selectQueueFindings(data), [data]);
  const activityTotal = data.operational_activity?.total ?? data.activity.length;

  return (
    <section
      id="signals-activity"
      aria-labelledby="signals-activity-heading"
      className="min-w-0 space-y-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="signals-activity-heading" className={cc.sectionTitle}>
            Signals &amp; Activity
          </h2>
          <p className="mt-0.5 text-[13px] leading-5 text-ink-muted">
            Every detected signal with severity, verification, and evidence freshness — followed
            by the recorded operational activity feed.
          </p>
        </div>
        <span className="inline-flex items-center rounded-full border border-brand-line bg-brand-soft px-3 py-1 text-xs font-semibold tabular-nums text-brand-deep">
          {queue.length} {queue.length === 1 ? "finding" : "findings"} · {activityTotal} recorded
        </span>
      </div>

      <SignalsTable data={data} />
      <OperationalActivity data={data} />
    </section>
  );
}

export default SignalsActivitySection;
