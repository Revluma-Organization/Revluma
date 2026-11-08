import { ArrowRight, CheckCircle2, RefreshCw, Store } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { INTEGRATION_STATE_LABELS } from "@/lib/integrationState";
import type { BusinessMetric, CommandCenterData, EvidenceResource } from "./types";

const section = "min-w-0 rounded-xl border border-[#e2e8f0] bg-white dark:border-[#2c2c2c] dark:bg-[#111111]";
const muted = "text-[#64748b] dark:text-[#a6b8d4]";
const money = (value: number, currency: string) => {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value); }
  catch { return `${value} ${currency}`; }
};
const dateTime = (value: string | null) => value ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Not recorded";
const relative = (value: string | null) => {
  if (!value) return "Not recorded";
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
};
const availabilityLabel: Record<string, string> = {
  available: "Available", stale: "Stale", partial: "Partial", unknown: "Unknown",
  not_synchronized: "Not yet synchronized", unauthorized: "Limited access",
  unsupported: "Unsupported", retrieval_failed: "Retrieval failed",
};

export function CommandCenterHeader({ data, refreshing, onRefresh }: { data: CommandCenterData | null; refreshing: boolean; onRefresh: () => void }) {
  return <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
    <div className="min-w-0">
      <h1 className="text-[1.75rem] font-bold tracking-[-0.035em] text-[#0f172a] dark:text-[#f3f7ff]">Command Center</h1>
      <p className={`mt-1 text-sm ${muted}`}>Your store’s operational briefing, evidence, and next useful investigation.</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[#475569] dark:text-[#bdc9da]">
        <span className="inline-flex min-w-0 items-center gap-1.5 font-semibold"><Store className="h-3.5 w-3.5 shrink-0 text-[#64748b]" /><span className="break-all">{data?.context.store?.name || "No Shopify store selected"}</span></span>
        <span>Today & yesterday · UTC</span>
        {data?.business_state.generated_at && <span title={dateTime(data.business_state.generated_at)}>Snapshot {relative(data.business_state.generated_at)}</span>}
      </div>
    </div>
    <button type="button" onClick={onRefresh} disabled={refreshing} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-[#cbd5e1] bg-white px-3.5 text-xs font-semibold text-[#334155] hover:bg-[#f8fafc] disabled:opacity-60 dark:border-[#3b3b3b] dark:bg-[#171717] dark:text-[#d8e2ef] dark:hover:bg-[#222]">
      <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />{refreshing ? "Refreshing…" : "Refresh briefing"}
    </button>
  </header>;
}

export function OperationalBriefing({ data }: { data: CommandCenterData }) {
  const navigate = useNavigate();
  const briefing = data.briefing;
  return <section aria-labelledby="operational-briefing-heading" className={`${section} border-l-4 ${briefing.tone === "attention" ? "border-l-[#b45309]" : "border-l-[#0868ed]"} p-5 sm:p-7`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-[11px] font-bold uppercase tracking-[0.13em] text-[#0868ed] dark:text-[#86b5ff]">Operational briefing</p>
      <span className="text-xs text-[#64748b] dark:text-[#a6b8d4]">Evidence {data.business_state.presentation_status.replace("_", " ")}</span>
    </div>
    <h2 id="operational-briefing-heading" className="mt-3 max-w-4xl text-[clamp(1.25rem,2.2vw,1.75rem)] font-bold leading-tight tracking-[-0.025em] text-[#0f172a] dark:text-white">{briefing.headline}</h2>
    <p className="mt-3 max-w-4xl text-sm leading-6 text-[#475569] dark:text-[#bdc9da]">{briefing.summary}</p>
    {briefing.observation && <p className="mt-3 max-w-4xl text-sm leading-6 text-[#475569] dark:text-[#bdc9da]">{briefing.observation} {briefing.implication}</p>}
    {briefing.no_findings_note && <p className={`mt-3 max-w-4xl text-xs leading-5 ${muted}`}>{briefing.no_findings_note}</p>}
    {briefing.limitations.length > 0 && <div className="mt-5 border-t border-[#e8edf3] pt-4 dark:border-[#2c2c2c]">
      <h3 className="text-xs font-semibold text-[#334155] dark:text-[#d8e2ef]">Evidence limits</h3>
      <ul className={`mt-2 space-y-1.5 text-xs leading-5 ${muted}`}>{briefing.limitations.map(item => <li key={item}>• {item}</li>)}</ul>
    </div>}
    <div className="mt-5 flex flex-col gap-3 border-t border-[#e8edf3] pt-4 dark:border-[#2c2c2c] sm:flex-row sm:items-center sm:justify-between">
      <p className={`max-w-2xl text-xs leading-5 ${muted}`}><span className="font-semibold text-[#334155] dark:text-[#d8e2ef]">Next: </span>{briefing.next_investigation.reason}</p>
      <button type="button" onClick={() => navigate(briefing.next_investigation.route)} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-[#0868ed] px-4 text-xs font-bold text-white hover:bg-[#0059cf]">{briefing.next_investigation.label}<ArrowRight className="h-3.5 w-3.5" /></button>
    </div>
  </section>;
}

function MetricValue({ metric }: { metric: BusinessMetric }) {
  const canShow = metric.value !== null && ["available", "stale", "partial"].includes(metric.availability) && !(metric.value === 0 && metric.zero_semantics === "unverified_zero_withheld");
  if (!canShow) return <>—</>;
  if (metric.unit === "money") return money(metric.value!, metric.currency!);
  if (metric.unit === "percent") return `${metric.value! > 0 ? "+" : ""}${metric.value!.toFixed(1)}%`;
  return metric.value!.toLocaleString();
}

export function BusinessOverview({ data }: { data: CommandCenterData }) {
  return <section aria-labelledby="business-situation-heading" className={section}>
    <div className="border-b border-[#e8edf3] px-5 py-4 dark:border-[#2c2c2c]">
      <h2 id="business-situation-heading" className="text-sm font-bold">Business situation</h2>
      <p className={`mt-1 text-xs ${muted}`}>Current and previous UTC day · {data.context.currency || "Currency not verified"} · Snapshot {relative(data.business_state.generated_at)}</p>
    </div>
    {data.metrics.length ? <dl className="grid sm:grid-cols-2 xl:grid-cols-4">{data.metrics.map(metric => <div key={metric.id} className="min-w-0 border-b border-[#edf1f5] p-5 last:border-b-0 sm:border-r xl:border-b-0 xl:last:border-r-0 dark:border-[#2c2c2c]">
      <dt className="text-xs font-medium text-[#475569] dark:text-[#bdc9da]">{metric.label}</dt>
      <dd className="mt-2 break-words text-2xl font-bold tracking-[-0.025em] text-[#0f172a] dark:text-white"><MetricValue metric={metric} /></dd>
      <dd className="mt-2 text-[11px] font-medium text-[#64748b] dark:text-[#a6b8d4]">{availabilityLabel[metric.availability] || "Unknown"}</dd>
      <dd className={`mt-2 text-[11px] leading-5 ${muted}`}>{metric.availability_reason || metric.definition}</dd>
      <dd className="sr-only">{metric.definition}. Reporting timezone {metric.reporting_period.timezone}.</dd>
    </div>)}</dl> : <p className={`p-5 text-sm ${muted}`}>Business indicators are unavailable. No zero or historical estimate is substituted.</p>}
  </section>;
}

export function PriorityFindings({ data }: { data: CommandCenterData }) {
  const navigate = useNavigate();
  return <section aria-labelledby="priority-findings-heading" className={section}>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e8edf3] px-5 py-4 dark:border-[#2c2c2c]">
      <div><h2 id="priority-findings-heading" className="text-sm font-bold">Priority findings</h2><p className={`mt-1 text-xs ${muted}`}>Verified intelligence only, ordered by severity and recency.</p></div>
      <span className="text-xs font-medium text-[#64748b] dark:text-[#a6b8d4]">{data.findings.length} open</span>
    </div>
    {data.findings.length ? <div className="divide-y divide-[#edf1f5] dark:divide-[#2c2c2c]">{data.findings.map(finding => <article key={finding.id} className="p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`text-[11px] font-bold uppercase tracking-wide ${["critical", "high"].includes(finding.severity) ? "text-[#b42318]" : "text-[#64748b]"}`}>{finding.severity} priority</span><span className="text-[11px] text-[#64748b]">Verified evidence · {relative(finding.detected_at)}</span></div><h3 className="mt-2 text-sm font-bold">{finding.title}</h3><p className={`mt-1.5 text-xs leading-5 ${muted}`}>{finding.description}</p></div>
        <button type="button" onClick={() => navigate(finding.next_step.route)} className="inline-flex min-h-9 shrink-0 items-center gap-1.5 self-start rounded-lg border border-[#bfd7ff] px-3 text-xs font-semibold text-[#0868ed] hover:bg-[#eff6ff] dark:hover:bg-[#1d2a3b]">Investigate <ArrowRight className="h-3.5 w-3.5" /></button>
      </div>
    </article>)}</div> : <div className="p-5"><p className="text-sm font-semibold">No open verified priority findings</p><p className={`mt-1.5 text-xs leading-5 ${muted}`}>This does not establish that no issue exists outside the configured checks and available evidence.</p></div>}
  </section>;
}

export function OperationalActivity({ data }: { data: CommandCenterData }) {
  return <section aria-labelledby="operational-activity-heading" className={section}>
    <div className="border-b border-[#e8edf3] px-5 py-4 dark:border-[#2c2c2c]"><h2 id="operational-activity-heading" className="text-sm font-bold">Operational activity</h2><p className={`mt-1 text-xs ${muted}`}>Business findings and system events are labelled separately.</p></div>
    {data.activity.length ? <ul className="divide-y divide-[#edf1f5] dark:divide-[#2c2c2c]">{data.activity.map(item => <li key={item.id} className="flex gap-3 p-5"><span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${item.kind === "business" ? "bg-[#0868ed]" : "bg-[#64748b]"}`} /><div className="min-w-0"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><p className="text-xs font-semibold">{item.label}</p><span className="text-[10px] font-semibold uppercase tracking-wide text-[#64748b]">{item.kind}</span></div><p className={`mt-1 text-[11px] ${muted}`}>{dateTime(item.occurred_at)} · {item.note}</p></div></li>)}</ul> : <p className={`p-5 text-xs ${muted}`}>No verified operational activity is recorded for this view.</p>}
  </section>;
}

function EvidenceRow({ resource }: { resource: EvidenceResource }) {
  return <div className="grid gap-2 border-b border-[#edf1f5] py-3 last:border-0 dark:border-[#2c2c2c] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-4">
    <div className="min-w-0"><p className="text-xs font-semibold capitalize">{resource.label}</p><p className={`mt-1 text-[11px] leading-5 ${muted}`}>{resource.reason || `${resource.freshness} evidence · coverage ${resource.coverage.replaceAll("_", " ")}`}</p></div>
    <div className="text-left sm:text-right"><p className="text-[11px] font-semibold text-[#475569] dark:text-[#bdc9da]">{availabilityLabel[resource.availability] || "Unknown"}</p><p className={`mt-1 text-[11px] ${muted}`} title={dateTime(resource.last_success_at)}>Last success {relative(resource.last_success_at)}</p></div>
  </div>;
}

export function EvidenceFreshness({ data }: { data: CommandCenterData }) {
  const staleCount = data.evidence.resources.filter(item => item.availability === "stale").length;
  const limitedCount = data.evidence.resources.filter(item => item.availability !== "available").length;
  return <section aria-labelledby="evidence-heading" className={section}>
    <div className="border-b border-[#e8edf3] px-5 py-4 dark:border-[#2c2c2c]"><h2 id="evidence-heading" className="text-sm font-bold">Evidence & data readiness</h2><p className={`mt-1 text-xs ${muted}`}>Freshness is evaluated independently for each source.</p></div>
    <div className="p-5">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div><p className={`text-[11px] ${muted}`}>Integration</p><p className="mt-1 text-xs font-semibold">{data.integration ? INTEGRATION_STATE_LABELS[data.integration.overall_status] : "Not connected"}</p></div>
        <div><p className={`text-[11px] ${muted}`}>Last successful sync</p><p className="mt-1 text-xs font-semibold">{relative(data.evidence.last_successful_sync_at)}</p></div>
        <div className="col-span-2 sm:col-span-1"><p className={`text-[11px] ${muted}`}>Resource limitations</p><p className="mt-1 text-xs font-semibold">{limitedCount} limited · {staleCount} stale</p></div>
      </div>
      <details className="mt-5 rounded-lg border border-[#e2e8f0] p-4 dark:border-[#2c2c2c]"><summary className="cursor-pointer text-xs font-semibold text-[#0868ed] focus-visible:outline-2 focus-visible:outline-offset-4">Review resource freshness and coverage</summary><div className="mt-4">{data.evidence.resources.map(resource => <EvidenceRow key={`${resource.store_id}-${resource.resource}`} resource={resource} />)}</div><p className={`mt-4 text-[11px] leading-5 ${muted}`}>{data.evidence.unknown_semantics}</p></details>
      {data.business_state.stale && <p role="status" className="mt-4 text-xs leading-5 text-[#92400e]">Stale snapshot generated {dateTime(data.business_state.generated_at)}. Historical evidence remains available; it is not current performance.</p>}
      {data.integration?.authorization.verified && <p className={`mt-4 inline-flex items-center gap-1.5 text-[11px] ${muted}`}><CheckCircle2 className="h-3.5 w-3.5 text-green-700" />Authorization verified by successful synchronization.</p>}
    </div>
  </section>;
}
