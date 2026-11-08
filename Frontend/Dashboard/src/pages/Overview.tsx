import { useCommandCenter } from "@/hooks/useCommandCenter";
import {
  BusinessOverview,
  CommandCenterHeader,
  EvidenceFreshness,
  OperationalActivity,
  OperationalBriefing,
  PriorityFindings,
} from "@/components/command-center/CommandCenterSections";

export default function Overview() {
  const { data, loading, refreshing, error, refetch } = useCommandCenter();
  return <main className="mx-auto w-full min-w-0 max-w-[1440px] space-y-5 overflow-x-clip pb-10 text-[#101828] dark:text-[#e7eefc]">
    <CommandCenterHeader data={data} refreshing={refreshing} onRefresh={() => void refetch(true)} />
    {error && <div role="alert" className="flex flex-col gap-3 rounded-xl border border-[#fecaca] bg-[#fff7f7] p-4 text-xs text-[#991b1b] dark:border-[#7f1d1d] dark:bg-[#241414] dark:text-[#fecaca] sm:flex-row sm:items-center sm:justify-between">
      <p>{data ? "The briefing could not be refreshed. The displayed snapshot may be older than the last successful refresh." : "The operational briefing is unavailable. No store status or business figures are inferred."}</p>
      <button type="button" onClick={() => void refetch()} className="min-h-9 shrink-0 rounded-lg border border-current px-3 font-semibold">Try again</button>
    </div>}
    {loading && !data ? <div aria-label="Loading operational briefing" role="status" className="space-y-5">
      <div className="h-64 animate-pulse motion-reduce:animate-none rounded-xl border border-[#e2e8f0] bg-[#f1f5f9] dark:border-[#2c2c2c] dark:bg-[#191919]" />
      <div className="h-40 animate-pulse motion-reduce:animate-none rounded-xl border border-[#e2e8f0] bg-[#f8fafc] dark:border-[#2c2c2c] dark:bg-[#151515]" />
      <span className="sr-only">Loading the authoritative business snapshot and integration evidence.</span>
    </div> : data ? <>
      <OperationalBriefing data={data} />
      <BusinessOverview data={data} />
      <PriorityFindings data={data} />
      <div className="grid min-w-0 gap-5 xl:grid-cols-2"><OperationalActivity data={data} /><EvidenceFreshness data={data} /></div>
    </> : !error ? <section className="rounded-xl border border-[#e2e8f0] bg-white p-6 dark:border-[#2c2c2c] dark:bg-[#111111]"><h2 className="text-sm font-bold">No operational briefing is available</h2><p className="mt-2 text-xs text-[#64748b]">No business information is asserted.</p></section> : null}
  </main>;
}
