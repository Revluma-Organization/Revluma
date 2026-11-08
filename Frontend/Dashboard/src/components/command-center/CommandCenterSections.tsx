import {
  AlertCircle, ArrowDown, ArrowRight, CheckCircle2, CircleDollarSign, Clock3,
  PackageCheck, PlugZap, RefreshCw, ShoppingBag, ShoppingCart, Store,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { INTEGRATION_STATE_LABELS } from "@/lib/integrationState";
import { api } from "@/lib/api";
import { type ActivityItem, type BusinessIndicator, BUSINESS_STATUS_LABEL, DATA_QUALITY_LABEL, isValidOperationalActivity } from "@/lib/businessHealth";
import { cn } from "@/lib/utils";
import { cc } from "./tokens";
import type { BusinessMetric, CommandCenterData, EvidenceResource } from "./types";

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
  unsupported: "Unsupported", retrieval_failed: "Retrieval failed", ...BUSINESS_STATUS_LABEL,
};

function SectionHeader({ id, title, description, aside }: { id: string; title: string; description: string; aside?: React.ReactNode }) {
  return <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4", cc.divider)}>
    <div><h2 id={id} className={cc.sectionTitle}>{title}</h2><p className={cn("mt-1", cc.metadata)}>{description}</p></div>{aside}
  </div>;
}

function Availability({ value }: { value: string }) {
  const positive = value === "available" || value === "fresh" || value === "connected" || value === "healthy";
  const negative = value === "retrieval_failed" || value === "failed" || value === "critical";
  const Icon = positive ? CheckCircle2 : AlertCircle;
  return <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-medium", positive ? cc.positive : negative ? cc.negative : ["stale", "partial", "attention", "deteriorating"].includes(value) ? cc.warning : cc.muted)}><Icon className="h-3.5 w-3.5" aria-hidden="true" />{availabilityLabel[value] || value.replaceAll("_", " ")}</span>;
}

export function CommandCenterHeader({ data, refreshing, onRefresh }: { data: CommandCenterData | null; refreshing: boolean; onRefresh: () => void }) {
  return <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
    <div className="min-w-0">
      <h1 className={cc.title}>Command Center</h1>
      <p className={cn("mt-1 text-sm", cc.muted)}>Current operating context, verified intelligence, and the next useful investigation.</p>
      <div className={cn("mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs", cc.muted)}>
        <span className="inline-flex min-w-0 items-center gap-1.5 font-medium"><Store className="h-3.5 w-3.5 shrink-0" /><span className="break-all">{data?.context.store?.name || "No Shopify store selected"}</span></span>
        <span>Today & yesterday · UTC</span>
        {data?.business_state.generated_at && <span title={dateTime(data.business_state.generated_at)}>Snapshot {relative(data.business_state.generated_at)}</span>}
      </div>
    </div>
    <button type="button" onClick={onRefresh} disabled={refreshing} className={cc.secondary}>
      <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />{refreshing ? "Refreshing…" : "Refresh briefing"}
    </button>
  </header>;
}

export function OperationalBriefing({ data }: { data: CommandCenterData }) {
  const navigate = useNavigate();
  const { briefing } = data;
  const hasPriority = Boolean(data.priority_finding);
  return <section aria-labelledby="operational-briefing-heading" className={cn(cc.surface, "relative overflow-hidden p-5 before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-[#1F06AC] sm:p-7")}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-[#1F06AC]">Operational briefing</p>
      <span className={cc.metadata}>Evidence {data.business_state.presentation_status.replaceAll("_", " ")}</span>
    </div>
    <h2 id="operational-briefing-heading" className="mt-3 max-w-4xl text-[clamp(1.3rem,2.2vw,1.8rem)] font-semibold leading-tight tracking-[-0.025em] text-[#111827]">
      {hasPriority ? "Your current evidence points to a priority for review." : briefing.headline}
    </h2>
    <p className={cn("mt-3 max-w-4xl", cc.body)}>{hasPriority ? "Revluma has selected the highest-priority defensible finding from current, verified evidence. Review the observation, its limits, and the recommended investigation below." : briefing.summary}</p>
    {!hasPriority && briefing.no_findings_note && <p className={cn("mt-3 max-w-4xl", cc.metadata)}>{briefing.no_findings_note}</p>}
    {briefing.limitations.length > 0 && <div className={cn("mt-5 border-t pt-4", cc.divider)}>
      <h3 className={cc.cardTitle}>What affects this briefing</h3>
      <ul className={cn("mt-2 space-y-1.5", cc.metadata)}>{briefing.limitations.slice(0, 3).map(item => <li key={item}>• {item}</li>)}</ul>
      {briefing.limitations.length > 3 && <p className={cn("mt-2", cc.metadata)}>Additional source limitations are listed under data readiness.</p>}
    </div>}
    <div className={cn("mt-5 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between", cc.divider)}>
      <p className={cn("max-w-2xl", cc.metadata)}>{hasPriority ? `${data.priority_selection.eligible_count} eligible finding${data.priority_selection.eligible_count === 1 ? "" : "s"} · ${data.priority_finding?.confidence.classification.replaceAll("_", " ")} confidence in the leading observation` : briefing.next_investigation.reason}</p>
      {hasPriority
        ? <a href="#priority-finding" className={cc.primary}>Review priority <ArrowDown className="h-3.5 w-3.5" /></a>
        : <button type="button" onClick={() => navigate(briefing.next_investigation.route)} className={cc.primary}>{briefing.next_investigation.label}<ArrowRight className="h-3.5 w-3.5" /></button>}
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

function observationText(item: CommandCenterData["findings"][number]["evidence"]["observations"][number]) {
  if (item.value === null || item.availability !== "available") return "Unavailable";
  if (item.unit === "money" && typeof item.value === "number" && item.currency) return money(item.value, item.currency);
  return `${item.value}${item.unit === "count" ? "" : ` ${item.unit}`}`;
}

export function PriorityFindings({ data }: { data: CommandCenterData }) {
  const navigate = useNavigate();
  const finding = data.priority_finding;
  const lower = data.findings.filter(item => item.id !== finding?.id);
  const critical = finding && ["critical", "high"].includes(finding.severity);
  return <section id="priority-finding" aria-labelledby="priority-findings-heading" className={cn(cc.intelligence, "scroll-mt-24")}>
    <SectionHeader id="priority-findings-heading" title="Top priority" description="The highest-priority defensible finding, selected from current verified evidence" aside={<span className={cc.metadata}>{data.priority_selection.eligible_count} eligible · {data.priority_selection.method_version}</span>} />
    {finding ? <article className={cn("border-l-4 p-5 sm:p-6", critical ? "border-l-[#b42318]" : "border-l-[#1F06AC]")} aria-labelledby="current-priority-title">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] font-semibold">
        <span className={critical ? cc.negative : "text-[#1F06AC]"}>{finding.priority.classification} priority</span>
        <span className={cc.muted}>{finding.confidence.classification.replaceAll("_", " ")} confidence</span>
        <span className={cc.muted}>{finding.evidence_freshness.state} evidence · {finding.coverage.state} coverage</span>
      </div>
      <h3 id="current-priority-title" className="mt-3 text-xl font-semibold tracking-[-0.02em] text-[#111827]">{finding.title}</h3>
      <p className={cn("mt-2 max-w-4xl", cc.body)}>{finding.description}</p>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div>
          <h4 className={cc.cardTitle}>Why this is the priority</h4>
          <ul className={cn("mt-2 space-y-1.5", cc.metadata)}>{finding.priority.rationale.map(reason => <li key={reason}>• {reason}</li>)}</ul>
          <h4 className={cn("mt-4", cc.cardTitle)}>Confidence</h4>
          <ul className={cn("mt-2 space-y-1.5", cc.metadata)}>{finding.confidence.rationale.map(reason => <li key={reason}>• {reason}</li>)}</ul>
          {finding.priority.tie && <p className={cn("mt-3", cc.metadata)}>{finding.priority.tie.statement}</p>}
        </div>
        <div>
          <h4 className={cc.cardTitle}>Supporting observations</h4>
          <dl className="mt-2 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">{finding.evidence.observations.map(item => <div key={`${item.period}-${item.label}`} className="min-w-0 border-l-2 border-[#cbd5f3] pl-3">
            <dt className={cc.metadata}>{item.label}</dt><dd className="mt-1 break-words text-base font-semibold text-[#172033]">{observationText(item)}</dd>
          </div>)}</dl>
          <p className={cn("mt-3", cc.metadata)}>{finding.reporting_period.kind.replaceAll("_", " ")} · {finding.reporting_period.timezone}<br />Last verified {dateTime(finding.last_verified_at)}</p>
        </div>
      </div>
      {finding.limitations.length > 0 && <div className={cn("mt-5 border-t pt-4", cc.divider)}><h4 className={cc.cardTitle}>Limits of this conclusion</h4><ul className={cn("mt-2 space-y-1.5", cc.metadata)}>{finding.limitations.map(limit => <li key={limit}>• {limit}</li>)}</ul></div>}
      <div className="mt-5 rounded-lg bg-[#f5f6fc] p-4">
        <h4 className={cc.cardTitle}>Recommended next step <span className={cn("font-normal", cc.muted)}>· merchant action, not executed by Revluma</span></h4>
        {finding.recommendation.available ? <>
          <p className={cn("mt-2", cc.body)}>{finding.recommendation.step}</p>
          <p className={cn("mt-2", cc.metadata)}><span className="font-semibold text-[#344054]">Why: </span>{finding.recommendation.rationale}</p>
          <p className={cn("mt-1", cc.metadata)}><span className="font-semibold text-[#344054]">Look for: </span>{finding.recommendation.expected_result}</p>
        </> : <p className={cn("mt-2", cc.metadata)}>{finding.recommendation.prerequisites.join(" ")}</p>}
      </div>
      <details className="mt-4">
        <summary className={cc.disclosure}>Inspect evidence, provenance and uncertainty</summary>
        <div className={cn("mt-4 grid gap-5 rounded-lg border p-4 sm:grid-cols-2", cc.surfaceSubtle)}>
          <div><h4 className={cc.cardTitle}>Authoritative references</h4><ul className={cn("mt-2 space-y-2 break-all", cc.metadata)}>{finding.evidence.references.map(ref => <li key={ref.id}><span className="font-semibold text-[#344054]">{ref.source_type}</span><br />{ref.source_record_id}</li>)}</ul></div>
          <div><h4 className={cc.cardTitle}>Lifecycle and unknowns</h4><p className={cn("mt-2", cc.metadata)}>{finding.lifecycle.state} · {finding.lifecycle.current_validity.replaceAll("_", " ")}<br />Detected {dateTime(finding.detected_at)}</p><ul className={cn("mt-2 space-y-1", cc.metadata)}>{finding.unknowns.map(item => <li key={item}>• {item}</li>)}</ul>{finding.evidence.duplicate_finding_ids.length > 0 && <p className={cn("mt-2", cc.metadata)}>Deduplicated records retained: {finding.evidence.duplicate_finding_ids.join(", ")}</p>}</div>
        </div>
      </details>
      <div className={cn("mt-5 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between", cc.divider)}>
        <p className={cc.metadata}>{finding.recommendation.validation_method || "Further evidence is required before a current recommendation."}</p>
        <button type="button" onClick={() => navigate(finding.investigation.route)} className={cc.primary}>Investigate in Rev Intelligence <ArrowRight className="h-3.5 w-3.5" /></button>
      </div>
    </article> : <div className="p-5 sm:p-6"><p className="text-sm font-semibold">No sufficiently supported priority is currently available</p><p className={cn("mt-1.5 max-w-3xl", cc.metadata)}>{data.priority_selection.reason || "No current finding meets the validity and evidence requirements."} This is not proof that the store has no problems.</p>{data.priority_selection.exclusions.length > 0 && <ul className={cn("mt-3 space-y-1", cc.metadata)} aria-label="Findings excluded from current priority">{data.priority_selection.exclusions.map(item => <li key={item.finding_id}><span className="font-semibold text-[#344054]">{item.title}</span> — not current: {item.reason.replaceAll("_", " ")}. Historical evidence is not presented as a current condition.</li>)}</ul>}</div>}
    {lower.length > 0 && <div className={cn("border-t p-5", cc.divider)}><h3 className={cc.cardTitle}>Other eligible findings</h3><div className={cn("mt-3 divide-y", cc.divider)}>{lower.map(item => <article key={item.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"><div><h4 className="text-xs font-semibold">{item.title}</h4><p className={cn("mt-1", cc.metadata)}>{item.severity} · {item.confidence.classification.replaceAll("_", " ")} confidence · {item.evidence_freshness.state}</p></div><button type="button" onClick={() => navigate(item.investigation.route)} className={cc.secondary}>Investigate <ArrowRight className="h-3.5 w-3.5" /></button></article>)}</div></div>}
  </section>;
}

type HealthItem = { id: string; label: string; value: React.ReactNode; availability: string; detail: string; freshness: string; icon: React.ElementType };
function resourceFor(data: CommandCenterData, id: string) { return data.evidence.resources.find(item => item.resource === id) || null; }

const canonicalIcons = { revenue: CircleDollarSign, orders: ShoppingBag, checkouts: ShoppingCart, product_availability: PackageCheck, integration: PlugZap };
function canonicalValue(indicator: BusinessIndicator) {
  if (indicator.value === null) return "—";
  if (indicator.category === "revenue") return indicator.currency && typeof indicator.value === "number" ? money(indicator.value, indicator.currency) : "—";
  if (indicator.category === "orders") return `${indicator.value.toLocaleString()} orders`;
  if (indicator.category === "checkouts") return `${indicator.value.toLocaleString()} abandoned`;
  if (indicator.category === "product_availability") return `${indicator.value.toLocaleString()} available`;
  return INTEGRATION_STATE_LABELS[indicator.value as keyof typeof INTEGRATION_STATE_LABELS] || String(indicator.value).replaceAll("_", " ");
}
function CanonicalHealthIndicators({ data }: { data: CommandCenterData }) {
  const health = data.business_health!;
  return <section aria-labelledby="business-health-heading" className={cc.surface}>
    <SectionHeader id="business-health-heading" title="Business health" description={`Five operational domains · ${health.reporting_period.current.label.replaceAll("_", " ")} · ${health.reporting_period.timezone}`} />
    <p className={cn("border-b px-5 py-3", cc.divider, cc.metadata)}>{health.business_status_explanation} Business severity and data quality are independent.</p>
    <dl className={cn("grid divide-y sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-5", cc.divider)}>{health.indicators.map(indicator => {
      const Icon = canonicalIcons[indicator.category];
      return <div key={indicator.id} data-health-domain={indicator.category === "product_availability" ? "product-availability" : indicator.category} className={cn("min-w-0 border-b p-5 last:border-b-0 sm:border-r xl:border-b-0 xl:last:border-r-0", cc.divider)}>
        <dt className="flex items-center gap-2 text-xs font-medium text-[#475467]"><Icon className="h-4 w-4 shrink-0 text-[#667085]" aria-hidden="true" />{indicator.title}</dt>
        <dd className="mt-3 break-words text-lg font-semibold leading-6 tracking-[-0.02em] text-[#172033]">{canonicalValue(indicator)}</dd>
        <dd className="mt-2 flex flex-wrap items-center gap-2"><Availability value={indicator.status} /><span className={cc.metadata}>{DATA_QUALITY_LABEL[indicator.data_quality]}</span></dd>
        {indicator.change_pct !== null && <dd className={cn("mt-2", cc.metadata)}>{indicator.change_pct > 0 ? "+" : ""}{indicator.change_pct}% vs previous period</dd>}
        <dd className={cn("mt-2", cc.metadata)}>{indicator.explanation}</dd>
        <dd className="mt-3"><details><summary className={cc.disclosure}>Metric & coverage</summary><div className={cn("mt-2 space-y-2", cc.metadata)}><p>{indicator.metric_definition || "Metric definition unavailable."}</p><p>{indicator.coverage.reason}</p>{indicator.limitations.map(item => <p key={item}>• {item}</p>)}{indicator.next_step && <p><span className="font-semibold">Next step: </span>{indicator.next_step}</p>}<p>Last verified {dateTime(indicator.last_verified_at)}</p></div></details></dd>
      </div>;
    })}</dl>
  </section>;
}

export function HealthIndicators({ data }: { data: CommandCenterData }) {
  if (data.business_health) return <CanonicalHealthIndicators data={data} />;
  const revenue = data.metrics.find(item => item.id === "net_sales_today") || null;
  const change = data.metrics.find(item => item.id === "revenue_change") || null;
  const checkout = data.metrics.find(item => item.id === "abandoned_checkouts") || null;
  const orders = resourceFor(data, "orders");
  const inventory = resourceFor(data, "inventory.levels");
  const items: HealthItem[] = [
    { id: "revenue", label: "Revenue", icon: CircleDollarSign, value: revenue ? <MetricValue metric={revenue} /> : "—", availability: revenue?.availability || "unknown", detail: change && change.value !== null ? <>Day-over-day <MetricValue metric={change} /></> : revenue?.availability_reason || "Current UTC-day net sales", freshness: revenue?.reporting_period.timezone ? `${revenue.reporting_period.timezone} snapshot` : "Period unavailable" },
    { id: "orders", label: "Orders", icon: ShoppingBag, value: availabilityLabel[orders?.availability || "unknown"], availability: orders?.availability || "unknown", detail: orders ? `Coverage ${orders.coverage.replaceAll("_", " ")}` : "Order evidence is unavailable", freshness: orders ? `${orders.freshness} evidence` : "Freshness unknown" },
    { id: "checkouts", label: "Checkouts", icon: ShoppingCart, value: checkout ? <MetricValue metric={checkout} /> : "—", availability: checkout?.availability || "unknown", detail: checkout ? "Open abandoned checkouts · last 48 hours" : "Checkout evidence is unavailable", freshness: checkout ? `${checkout.reporting_period.timezone} snapshot` : "Freshness unknown" },
    { id: "product-availability", label: "Product availability", icon: PackageCheck, value: availabilityLabel[inventory?.availability || "unknown"], availability: inventory?.availability || "unknown", detail: inventory?.reason || (inventory ? "Inventory levels evidence" : "Inventory evidence is unavailable"), freshness: inventory ? `${inventory.freshness} evidence` : "Freshness unknown" },
    { id: "integration", label: "Integration", icon: PlugZap, value: data.integration ? INTEGRATION_STATE_LABELS[data.integration.overall_status] : "Not connected", availability: data.integration?.overall_status || "unknown", detail: data.integration?.status_explanation || "No verified integration state is available", freshness: data.evidence.last_successful_sync_at ? `Last sync ${relative(data.evidence.last_successful_sync_at)}` : "No successful sync recorded" },
  ];
  return <section aria-labelledby="business-health-heading" className={cc.surface}>
    <SectionHeader id="business-health-heading" title="Business health" description={`Five operational domains · Current and previous UTC day · ${data.context.currency || "currency not verified"}`} />
    <dl className={cn("grid divide-y sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-5", cc.divider)}>{items.map(item => {
      const Icon = item.icon;
      return <div key={item.id} data-health-domain={item.id} className={cn("min-w-0 border-b p-5 last:border-b-0 sm:border-r xl:border-b-0 xl:last:border-r-0", cc.divider)}>
        <dt className="flex items-center gap-2 text-xs font-medium text-[#475467]"><Icon className="h-4 w-4 shrink-0 text-[#667085]" aria-hidden="true" />{item.label}</dt>
        <dd className="mt-3 break-words text-lg font-semibold leading-6 tracking-[-0.02em] text-[#172033]">{item.value}</dd>
        {(item.id === "revenue" && revenue || item.id === "checkouts" && checkout) && <dd className="sr-only">{item.id === "revenue" ? revenue?.definition : checkout?.definition}</dd>}
        <dd className="mt-2"><Availability value={item.availability} /></dd>
        <dd className={cn("mt-2 min-h-10", cc.metadata)}>{item.detail}</dd>
        <dd className={cn("mt-2 inline-flex items-start gap-1.5", cc.metadata)}><Clock3 className="mt-1 h-3 w-3 shrink-0" aria-hidden="true" />{item.freshness}</dd>
      </div>;
    })}</dl>
  </section>;
}

// Backwards-compatible export name; there is only one business-health presentation.
export const BusinessOverview = HealthIndicators;

function CanonicalOperationalActivity({ data }: { data: CommandCenterData }) {
  const navigate = useNavigate();
  const contract = data.operational_activity!;
  const [extra, setExtra] = useState<ActivityItem[]>([]);
  const [cursor, setCursor] = useState(contract.next_cursor);
  const [hasMore, setHasMore] = useState(contract.has_more);
  const [total, setTotal] = useState(contract.total);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setExtra([]); setCursor(contract.next_cursor); setHasMore(contract.has_more); setTotal(contract.total); setFailed(false); }, [contract.generated_at, contract.next_cursor, contract.has_more, contract.total]);
  const items = [...contract.items, ...extra].filter((item, index, all) => all.findIndex(other => other.event_id === item.event_id) === index);
  const loadMore = async () => {
    if (!cursor || pending || !data.context.store) return;
    setPending(true); setFailed(false);
    try {
      const response = await api.get<{ success?: boolean; data?: unknown }>(`/stores/${data.context.store.id}/business-activity`, { cursor, limit: 20 });
      const body = response.data;
      const next = body?.success === true ? body.data : null;
      if (!isValidOperationalActivity(next)) throw new Error("Invalid activity contract");
      setExtra(previous => [...previous, ...next.items]); setCursor(next.next_cursor); setHasMore(next.has_more); setTotal(next.total);
    } catch { setFailed(true); } finally { setPending(false); }
  };
  return <section aria-labelledby="operational-activity-heading" className={cc.surface}>
    <SectionHeader id="operational-activity-heading" title="Operational activity" description={`Recorded findings, integration, webhook and sync events · last ${contract.window_days} days`} aside={<span className={cc.metadata}>{total} recorded</span>} />
    {items.length ? <ul className={cn("divide-y", cc.divider)}>{items.map(item => {
      const investigate = item.type === "finding" && item.finding_id;
      const integrations = item.link === "/integrations";
      return <li key={item.event_id} className="flex gap-3 p-5"><span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", item.severity === "critical" ? "bg-[#b42318]" : item.severity === "warning" || item.severity === "attention" ? "bg-[#b54708]" : item.type === "finding" ? "bg-[#1F06AC]" : "bg-[#98a2b3]")} aria-hidden="true" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><p className="text-xs font-semibold">{item.title}</p><span className={cn("text-[10px] font-medium uppercase tracking-wide", cc.muted)}>{item.type.replaceAll("_", " ")} · {item.severity}</span></div>{item.detail && <p className={cn("mt-1 break-words", cc.metadata)}>{item.detail}</p>}<p className={cn("mt-1", cc.metadata)}>Occurred {dateTime(item.occurred_at)}{new Date(item.received_at).getTime() - new Date(item.occurred_at).getTime() > 300_000 ? ` · recorded ${relative(item.received_at)}` : ""}</p>{investigate && <button type="button" onClick={() => navigate(`/dashboard/rev-intell?finding=${encodeURIComponent(item.finding_id!)}`)} className={cn("mt-2 min-h-9", cc.disclosure)}>Investigate event <ArrowRight className="inline h-3 w-3" /></button>}{integrations && <button type="button" onClick={() => navigate("/dashboard/integrations")} className={cn("mt-2 min-h-9", cc.disclosure)}>Review integration <ArrowRight className="inline h-3 w-3" /></button>}</div></li>;
    })}</ul> : <div className="p-5"><p className="text-xs font-semibold">No operational activity to show</p><p className={cn("mt-1", cc.metadata)}>No activity could be confirmed for this {contract.window_days}-day window. An empty feed may mean no matching records or unavailable source evidence; it does not prove that nothing happened.</p></div>}
    {failed && <p role="alert" className={cn("px-5 pb-3", cc.warning)}>More activity could not be loaded. The events already shown are unchanged.</p>}
    {hasMore && cursor && <div className="p-5 pt-0"><button type="button" onClick={() => void loadMore()} disabled={pending} className={cc.secondary}>{pending ? "Loading…" : `Load more (${Math.max(0, total - items.length)} remaining)`}</button></div>}
  </section>;
}

export function OperationalActivity({ data }: { data: CommandCenterData }) {
  const navigate = useNavigate();
  if (data.operational_activity) return <CanonicalOperationalActivity data={data} />;
  return <section aria-labelledby="operational-activity-heading" className={cc.surface}>
    <SectionHeader id="operational-activity-heading" title="Operational activity" description="Verified findings and system events, in chronological order" />
    {data.activity.length ? <ul className={cn("divide-y", cc.divider)}>{data.activity.map(item => <li key={item.id} className="flex gap-3 p-5"><span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", item.kind === "business" ? "bg-[#1F06AC]" : "bg-[#98a2b3]")} aria-hidden="true" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><p className="text-xs font-semibold">{item.label}</p><span className={cn("text-[10px] font-medium uppercase tracking-wide", cc.muted)}>{item.kind}</span></div><p className={cn("mt-1", cc.metadata)}>{dateTime(item.occurred_at)} · {item.note}</p>{item.kind === "business" && item.finding_id && <button type="button" onClick={() => navigate(`/dashboard/rev-intell?finding=${encodeURIComponent(item.finding_id!)}`)} className={cn("mt-2 min-h-9", cc.disclosure)}>Investigate event <ArrowRight className="inline h-3 w-3" /></button>}</div></li>)}</ul> : <div className="p-5"><p className="text-xs font-semibold">No operational activity to show</p><p className={cn("mt-1", cc.metadata)}>No verified operational activity is recorded for this view. No placeholder events are inserted.</p></div>}
  </section>;
}

function EvidenceRow({ resource }: { resource: EvidenceResource }) {
  return <div className={cn("grid gap-2 border-b py-3 last:border-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-4", cc.divider)}>
    <div className="min-w-0"><p className="text-xs font-semibold capitalize">{resource.label}</p><p className={cn("mt-1", cc.metadata)}>{resource.reason || `${resource.freshness} evidence · coverage ${resource.coverage.replaceAll("_", " ")}`}</p></div>
    <div className="text-left sm:text-right"><Availability value={resource.availability} /><p className={cn("mt-1", cc.metadata)} title={dateTime(resource.last_success_at)}>Last success {relative(resource.last_success_at)}</p></div>
  </div>;
}

export function EvidenceFreshness({ data }: { data: CommandCenterData }) {
  const limited = data.evidence.resources.filter(item => item.availability !== "available");
  return <section aria-labelledby="evidence-heading" className={cc.surface}>
    <SectionHeader id="evidence-heading" title="Data readiness & limitations" description="Source-specific freshness and coverage; no overall health score is inferred" aside={<span className={cc.metadata}>{limited.length} limited</span>} />
    <div className="p-5">
      {limited.length > 0 && <ul className={cn("mb-4 space-y-2", cc.metadata)}>{limited.slice(0, 3).map(resource => <li key={`${resource.store_id}-${resource.resource}-limit`}><span className="font-semibold text-[#344054]">{resource.label}: </span>{resource.reason || availabilityLabel[resource.availability]}</li>)}</ul>}
      <details>
        <summary className={cc.disclosure}>Review resource freshness and coverage</summary>
        <div className="mt-4">{data.evidence.resources.map(resource => <EvidenceRow key={`${resource.store_id}-${resource.resource}`} resource={resource} />)}</div>
        <p className={cn("mt-4", cc.metadata)}>{data.evidence.unknown_semantics}</p>
      </details>
      {data.business_state.stale && <p role="status" className={cn("mt-4 text-xs leading-5", cc.warning)}>Stale snapshot generated {dateTime(data.business_state.generated_at)}. Historical evidence remains available; it is not current performance.</p>}
      {data.integration?.authorization.verified && <p className={cn("mt-4 inline-flex items-center gap-1.5", cc.metadata)}><CheckCircle2 className={cn("h-3.5 w-3.5", cc.positive)} />Authorization verified by successful synchronization.</p>}
    </div>
  </section>;
}
