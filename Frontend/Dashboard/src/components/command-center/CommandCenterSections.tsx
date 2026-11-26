import {
  AlertCircle, ArrowRight, CheckCircle2, CircleDollarSign, Clock3,
  PackageCheck, PlugZap, ShoppingBag, ShoppingCart,
} from "lucide-react";
import { useInRouterContext, useNavigate } from "react-router-dom";
import { investigationRoute } from "@/lib/workspaceNavigation";
import { useEffect, useRef, useState } from "react";
import { INTEGRATION_STATE_LABELS } from "@/lib/integrationState";
import { api } from "@/lib/api";
import { type ActivityItem, type BusinessIndicator, BUSINESS_STATUS_LABEL, DATA_QUALITY_LABEL, isValidOperationalActivity } from "@/lib/businessHealth";
import { resolveReportingContext } from "@/lib/overviewReporting";
import { cn } from "@/lib/utils";
import { BusinessOverviewHeader } from "./BusinessOverviewHeader";
import { CommandCenterWelcomeSection } from "./CommandCenterWelcomeSection";
import { OperationalBriefingSection } from "./OperationalBriefingSection";
import { TopPrioritiesSection } from "./TopPrioritiesSection";
import { cc } from "./tokens";
import type { BusinessMetric, CommandCenterData, EvidenceResource } from "./types";

export {
  BusinessOverviewHeader,
  CommandCenterWelcomeSection,
  CommandCenterWelcomeSection as CommandCenterHeader,
  OperationalBriefingSection,
  OperationalBriefingSection as OperationalBriefing,
  TopPrioritiesSection,
  TopPrioritiesSection as PriorityFindings,
};

function useWorkspaceNavigation() {
  const inRouter = useInRouterContext();
  const navigate = useNavigate();
  return (route: string) => {
    if (!inRouter) {
      window.location.assign(route);
      return;
    }
    if (!route.startsWith("/dashboard/rev-intell")) return navigate(route);
    const current = new URL(window.location.href);
    const finding = new URL(route, current.origin).searchParams.get("finding");
    if (finding && /^[0-9a-f-]{36}$/i.test(finding)) current.searchParams.set("finding", finding);
    navigate(investigationRoute(route, `${current.pathname}${current.search}${current.hash}`));
  };
}

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
  return <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4 sm:px-6", cc.divider)}>
    <div className="min-w-0">
      <h2 id={id} className={cc.sectionTitle}>{title}</h2>
      <p className="mt-0.5 text-[13px] leading-5 text-ink-muted">{description}</p>
    </div>
    {aside}
  </div>;
}

function Availability({ value }: { value: string }) {
  const positive = value === "available" || value === "fresh" || value === "connected" || value === "healthy";
  const negative = value === "retrieval_failed" || value === "failed" || value === "critical";
  const warning = ["stale", "partial", "attention", "deteriorating"].includes(value);
  const Icon = positive ? CheckCircle2 : AlertCircle;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[11px] font-medium",
        positive ? cc.positive : negative ? cc.negative : warning ? cc.warning : cc.muted,
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {availabilityLabel[value] || value.replaceAll("_", " ")}
    </span>
  );
}

function MetricValue({ metric }: { metric: BusinessMetric }) {
  const canShow = metric.value !== null && ["available", "stale", "partial"].includes(metric.availability) && !(metric.value === 0 && metric.zero_semantics === "unverified_zero_withheld");
  if (!canShow) return <>—</>;
  if (metric.unit === "money") return money(metric.value!, metric.currency!);
  if (metric.unit === "percent") return `${metric.value! > 0 ? "+" : ""}${metric.value!.toFixed(1)}%`;
  return metric.value!.toLocaleString();
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
  const reporting = resolveReportingContext(data);
  return <section aria-labelledby="business-health-heading" className={cc.surface}>
    <SectionHeader
      id="business-health-heading"
      title="Supporting intelligence"
      description={`Verified operational indicators · ${reporting.periodLabel} · ${reporting.timezone.label}`}
    />
    <p className={cn("border-b bg-subtle px-5 py-2.5 sm:px-6", cc.divider, cc.metadata)}>
      {health.business_status_explanation} Business severity and data quality are independent.
    </p>
    <dl className={cn("grid divide-y sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-5", cc.divider)}>{health.indicators.map(indicator => {
      const Icon = canonicalIcons[indicator.category];
      return <div key={indicator.id} data-health-domain={indicator.category === "product_availability" ? "product-availability" : indicator.category} className={cn("min-w-0 border-b p-5 last:border-b-0 sm:border-r xl:border-b-0 xl:last:border-r-0", cc.divider)}>
        <dt className="flex items-center gap-2 text-xs font-medium text-ink-muted"><Icon className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />{indicator.title}</dt>
        <dd className="mt-3 break-words text-lg font-semibold leading-6 tracking-[-0.02em] text-ink tabular-nums">{canonicalValue(indicator)}</dd>
        <dd className="mt-2 flex flex-wrap items-center gap-2"><Availability value={indicator.status} /><span className={cc.metadata}>{DATA_QUALITY_LABEL[indicator.data_quality]}</span></dd>
        {indicator.change_pct !== null && <dd className={cn("mt-2 tabular-nums", cc.metadata)}>{indicator.change_pct > 0 ? "+" : ""}{indicator.change_pct}% vs previous period</dd>}
        <dd className={cn("mt-2", cc.metadata)}>{indicator.explanation}</dd>
        <dd className="mt-3"><details><summary className={cc.disclosure}>Metric &amp; coverage</summary><div className={cn("mt-2 space-y-2", cc.metadata)}><p>{indicator.metric_definition || "Metric definition unavailable."}</p><p>{indicator.coverage.reason}</p>{indicator.limitations.map(item => <p key={item}>• {item}</p>)}{indicator.next_step && <p><span className="font-semibold text-ink">Next step: </span>{indicator.next_step}</p>}<p className="tabular-nums">Last verified {dateTime(indicator.last_verified_at)}</p></div></details></dd>
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
    <SectionHeader
      id="business-health-heading"
      title="Supporting intelligence"
      description={`Verified operational indicators · Current and previous UTC day · ${data.context.currency || "currency not verified"}`}
    />
    <dl className={cn("grid divide-y sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-5", cc.divider)}>{items.map(item => {
      const Icon = item.icon;
      return <div key={item.id} data-health-domain={item.id} className={cn("min-w-0 border-b p-5 last:border-b-0 sm:border-r xl:border-b-0 xl:last:border-r-0", cc.divider)}>
        <dt className="flex items-center gap-2 text-xs font-medium text-ink-muted"><Icon className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />{item.label}</dt>
        <dd className="mt-3 break-words text-lg font-semibold leading-6 tracking-[-0.02em] text-ink tabular-nums">{item.value}</dd>
        {(item.id === "revenue" && revenue || item.id === "checkouts" && checkout) && <dd className="sr-only">{item.id === "revenue" ? revenue?.definition : checkout?.definition}</dd>}
        <dd className="mt-2"><Availability value={item.availability} /></dd>
        <dd className={cn("mt-2 min-h-10", cc.metadata)}>{item.detail}</dd>
        <dd className={cn("mt-2 inline-flex items-start gap-1.5 tabular-nums", cc.metadata)}><Clock3 className="mt-1 h-3 w-3 shrink-0" aria-hidden="true" />{item.freshness}</dd>
      </div>;
    })}</dl>
  </section>;
}

// Backwards-compatible export names; single canonical supporting intelligence view.
export const BusinessOverview = HealthIndicators;
export const SupportingIntelligence = HealthIndicators;

function CanonicalOperationalActivity({ data }: { data: CommandCenterData }) {
  const openRoute = useWorkspaceNavigation();
  const contract = data.operational_activity!;
  const [extra, setExtra] = useState<ActivityItem[]>([]);
  const [cursor, setCursor] = useState(contract.next_cursor);
  const [hasMore, setHasMore] = useState(contract.has_more);
  const [total, setTotal] = useState(contract.total);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  useEffect(() => {
    generationRef.current += 1;
    abortRef.current?.abort();
    setExtra([]); setCursor(contract.next_cursor); setHasMore(contract.has_more); setTotal(contract.total); setFailed(false);
    return () => { generationRef.current += 1; abortRef.current?.abort(); };
  }, [contract.generated_at, contract.next_cursor, contract.has_more, contract.total, data.context.store?.id]);
  const items = [...contract.items, ...extra].filter((item, index, all) => all.findIndex(other => other.event_id === item.event_id) === index);
  const loadMore = async () => {
    if (!cursor || pending || !data.context.store) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const generation = ++generationRef.current;
    setPending(true); setFailed(false);
    try {
      const response = await api.get<{ success?: boolean; data?: unknown }>(`/stores/${data.context.store.id}/business-activity`, { cursor, limit: 20, signal: controller.signal });
      if (generation !== generationRef.current || controller.signal.aborted) return;
      const body = response.data;
      const next = body?.success === true ? body.data : null;
      if (!isValidOperationalActivity(next)) throw new Error("Invalid activity contract");
      setExtra(previous => [...previous, ...next.items]); setCursor(next.next_cursor); setHasMore(next.has_more); setTotal(next.total);
    } catch { if (generation === generationRef.current && !controller.signal.aborted) setFailed(true); }
    finally { if (generation === generationRef.current) setPending(false); }
  };
  return <section aria-labelledby="operational-activity-heading" className={cc.surface}>
    <SectionHeader id="operational-activity-heading" title="Operational activity" description={`Recorded findings, integration, webhook and sync events · last ${contract.window_days} days`} aside={<span className={cn(cc.metadata, "tabular-nums")}>{total} recorded</span>} />
    {items.length ? <ul className={cn("divide-y", cc.divider)}>{items.map(item => {
      const investigate = item.type === "finding" && item.finding_id;
      const integrations = item.link === "/integrations";
      return <li key={item.event_id} className="flex gap-3 px-5 py-4 sm:px-6"><span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", item.severity === "critical" ? "bg-danger" : item.severity === "warning" || item.severity === "attention" ? "bg-warning-strong" : item.type === "finding" ? "bg-brand" : "bg-ink-faint")} aria-hidden="true" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><p className="text-xs font-semibold text-ink">{item.title}</p><span className={cn("text-[10px] font-medium uppercase tracking-wide", cc.muted)}>{item.type.replaceAll("_", " ")} · {item.severity}</span></div>{item.detail && <p className={cn("mt-1 break-words", cc.metadata)}>{item.detail}</p>}<p className={cn("mt-1 tabular-nums", cc.metadata)}>Occurred {dateTime(item.occurred_at)}{new Date(item.received_at).getTime() - new Date(item.occurred_at).getTime() > 300_000 ? ` · recorded ${relative(item.received_at)}` : ""}</p>{investigate && <button type="button" onClick={() => openRoute(`/dashboard/rev-intell?finding=${encodeURIComponent(item.finding_id!)}`)} className={cn("mt-2 min-h-9", cc.disclosure)}>Investigate event <ArrowRight className="inline h-3 w-3" /></button>}{integrations && <button type="button" onClick={() => openRoute("/dashboard/integrations")} className={cn("mt-2 min-h-9", cc.disclosure)}>Review integration <ArrowRight className="inline h-3 w-3" /></button>}</div></li>;
    })}</ul> : <div className="px-5 py-4 sm:px-6"><p className="text-xs font-semibold text-ink">No operational activity to show</p><p className={cn("mt-1", cc.metadata)}>No activity could be confirmed for this {contract.window_days}-day window. An empty feed may mean no matching records or unavailable source evidence; it does not prove that nothing happened.</p></div>}
    {failed && <p role="alert" className={cn("px-5 pb-3 sm:px-6", cc.warning)}>More activity could not be loaded. The events already shown are unchanged.</p>}
    {hasMore && cursor && <div className="px-5 pb-5 pt-2 sm:px-6"><button type="button" onClick={() => void loadMore()} disabled={pending} className={cc.secondary}>{pending ? "Loading…" : `Load more (${Math.max(0, total - items.length)} remaining)`}</button></div>}
  </section>;
}

export function OperationalActivity({ data }: { data: CommandCenterData }) {
  const openRoute = useWorkspaceNavigation();
  if (data.operational_activity) return <CanonicalOperationalActivity data={data} />;
  return <section aria-labelledby="operational-activity-heading" className={cc.surface}>
    <SectionHeader id="operational-activity-heading" title="Operational activity" description="Verified findings and system events, in chronological order" />
    {data.activity.length ? <ul className={cn("divide-y", cc.divider)}>{data.activity.map(item => <li key={item.id} className="flex gap-3 px-5 py-4 sm:px-6"><span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", item.kind === "business" ? "bg-brand" : "bg-ink-faint")} aria-hidden="true" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><p className="text-xs font-semibold text-ink">{item.label}</p><span className={cn("text-[10px] font-medium uppercase tracking-wide", cc.muted)}>{item.kind}</span></div><p className={cn("mt-1 tabular-nums", cc.metadata)}>{dateTime(item.occurred_at)} · {item.note}</p>{item.kind === "business" && item.finding_id && <button type="button" onClick={() => openRoute(`/dashboard/rev-intell?finding=${encodeURIComponent(item.finding_id!)}`)} className={cn("mt-2 min-h-9", cc.disclosure)}>Investigate event <ArrowRight className="inline h-3 w-3" /></button>}</div></li>)}</ul> : <div className="px-5 py-4 sm:px-6"><p className="text-xs font-semibold text-ink">No operational activity to show</p><p className={cn("mt-1", cc.metadata)}>No verified operational activity is recorded for this view. No placeholder events are inserted.</p></div>}
  </section>;
}

function EvidenceRow({ resource }: { resource: EvidenceResource }) {
  return <div className={cn("grid gap-2 border-b py-3 last:border-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-4", cc.divider)}>
    <div className="min-w-0"><p className="text-xs font-semibold capitalize text-ink">{resource.label}</p><p className={cn("mt-1", cc.metadata)}>{resource.reason || `${resource.freshness} evidence · coverage ${resource.coverage.replaceAll("_", " ")}`}</p></div>
    <div className="text-left sm:text-right"><Availability value={resource.availability} /><p className={cn("mt-1 tabular-nums", cc.metadata)} title={dateTime(resource.last_success_at)}>Last success {relative(resource.last_success_at)}</p></div>
  </div>;
}

export function EvidenceFreshness({ data }: { data: CommandCenterData }) {
  const limited = data.evidence.resources.filter(item => item.availability !== "available");
  return <section aria-labelledby="evidence-heading" className={cc.surface}>
    <SectionHeader id="evidence-heading" title="Data readiness & limitations" description="Source-specific freshness and coverage; no overall health score is inferred" aside={<span className={cc.metadata}>{limited.length} limited</span>} />
    <div className="p-5 sm:px-6">
      {limited.length > 0 && <ul className={cn("mb-4 space-y-2", cc.metadata)}>{limited.slice(0, 3).map(resource => <li key={`${resource.store_id}-${resource.resource}-limit`}><span className="font-semibold text-ink">{resource.label}: </span>{resource.reason || availabilityLabel[resource.availability]}</li>)}</ul>}
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
