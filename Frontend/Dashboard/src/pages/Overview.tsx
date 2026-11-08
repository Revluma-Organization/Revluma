import { useCommandCenter } from "@/hooks/useCommandCenter";
import {
  CommandCenterHeader,
  EvidenceFreshness,
  HealthIndicators,
  OperationalActivity,
  OperationalBriefing,
  PriorityFindings,
} from "@/components/command-center/CommandCenterSections";
import { cc } from "@/components/command-center/tokens";
import { cn } from "@/lib/utils";

export default function Overview() {
  const { data, loading, refreshing, error, refetch } = useCommandCenter();
  return <main className={cc.page}>
    <CommandCenterHeader data={data} refreshing={refreshing} onRefresh={() => void refetch(true)} />
    {error && <div role="alert" className={cn(cc.surface, "flex flex-col gap-3 border-[#f0c7c2] bg-[#fff8f7] p-4 text-xs text-[#912018] sm:flex-row sm:items-center sm:justify-between")}>
      <p>{data ? "The briefing could not be refreshed. The displayed snapshot is labeled with its original generation time and may be older than the last successful refresh." : "The operational briefing is unavailable. No store status or business figures are inferred."}</p>
      <button type="button" onClick={() => void refetch()} className={cc.secondary}>Try again</button>
    </div>}
    {loading && !data ? <div aria-label="Loading operational briefing" role="status" className="space-y-6">
      <div className={cn(cc.surface, "h-56 animate-pulse bg-[#edf0f4] motion-reduce:animate-none")} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{Array.from({ length: 5 }, (_, index) => <div key={index} className={cn(cc.surface, "h-40 animate-pulse bg-[#f0f2f5] motion-reduce:animate-none")} />)}</div>
      <span className="sr-only">Loading the authoritative business snapshot and integration evidence. No values are shown until evidence arrives.</span>
    </div> : data ? <>
      <OperationalBriefing data={data} />
      <PriorityFindings data={data} />
      <HealthIndicators data={data} />
      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-2"><OperationalActivity data={data} /><EvidenceFreshness data={data} /></div>
    </> : !error ? <section className={cn(cc.surface, "p-6")}><h2 className={cc.sectionTitle}>No operational briefing is available</h2><p className={cn("mt-2", cc.metadata)}>No business information is asserted. Connect or synchronize an authorized store before relying on this workspace.</p></section> : null}
  </main>;
}
