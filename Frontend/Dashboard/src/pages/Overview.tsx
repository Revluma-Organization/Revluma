import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUI } from "@/store/ui";
import { api } from "@/lib/api";
import { RevenueChart } from "@/components/dashboard/RevenueChart";
import { LiveActivity } from "@/components/dashboard/LiveActivity";
import type { KPI, ActivityItem, ChartData } from "@/data/mockOverview";
import { Activity, ArrowRight, ArrowUpRight, BrainCircuit, CheckCircle2, ChevronRight, CircleAlert, Clock3, Mail, MessageCircle, Search, ShieldCheck, ShoppingCart, Sparkles, Store, TrendingUp, Users, Workflow, Zap } from "lucide-react";

type ConnectedStore = { name?: string; shop_domain?: string; platform: string; connection_status?: string; setup_status?: string; sync_status?: string };
type CartRow = { id: string; customer_name?: string; cart_value: number; currency?: string; status: string; abandoned_at: string };
type CheckoutStats = { total_abandoned?: number; total_recovered?: number; recovery_rate?: number };
type RecoveryResponse = { success: boolean; data: { stats: CheckoutStats; carts: CartRow[] } };
const card = "rounded-2xl border border-[#e7ebf2] bg-white shadow-[0_3px_18px_rgba(15,23,42,0.035)]";
const iconBox = "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#eaf2ff] text-[#0868ed]";
const money = (value: number, currency = "USD") => { try { return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value); } catch { return String(value); } };

export default function Overview() {
  const navigate = useNavigate();
  const { setCopilotOpen } = useUI();
  const [firstName, setFirstName] = useState("");
  const [kpis, setKpis] = useState<KPI[]>([]);
  const [chart, setChart] = useState<ChartData | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [stores, setStores] = useState<ConnectedStore[]>([]);
  const [recovery, setRecovery] = useState<RecoveryResponse["data"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [investigationOpen, setInvestigationOpen] = useState(false);
  useEffect(() => {
    let active = true;
    async function load() {
      const result = await Promise.allSettled([
        api.get<{ success: boolean; data: { full_name?: string } }>("/auth/me"),
        api.get<{ success: boolean; data: { kpi: KPI[] } }>("/dashboard/kpis"),
        api.get<{ success: boolean; data: { chart: ChartData } }>("/dashboard/chart"),
        api.get<{ success: boolean; data: { activity: ActivityItem[] } }>("/dashboard/activity", { limit: 8 }),
        api.get<{ success: boolean; data: { stores: ConnectedStore[] } }>("/stores"),
        api.get<RecoveryResponse>("/dashboard/cart-recovery"),
      ]);
      if (!active) return;
      const [profile, metrics, graph, events, integrations, carts] = result;
      if (profile.status === "fulfilled") setFirstName(profile.value.data.data?.full_name?.split(" ")[0] || "");
      if (metrics.status === "fulfilled") setKpis(metrics.value.data.data?.kpi || []);
      if (graph.status === "fulfilled") setChart(graph.value.data.data?.chart || null);
      if (events.status === "fulfilled") setActivity(events.value.data.data?.activity || []);
      if (integrations.status === "fulfilled") setStores(integrations.value.data.data?.stores || []);
      if (carts.status === "fulfilled") setRecovery(carts.value.data.data);
      setError(metrics.status === "rejected" || integrations.status === "rejected" || carts.status === "rejected");
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, []);
  const connected = stores.find(s => s.connection_status === "connected");
  const needsAttention = Boolean(connected && (connected.setup_status === "failed" || connected.sync_status === "failed"));
  const carts = recovery?.carts || [];
  const abandoned = Number(recovery?.stats?.total_abandoned ?? 0);
  const recovered = Number(recovery?.stats?.total_recovered ?? 0);
  const rate = Number(recovery?.stats?.recovery_rate ?? 0);
  const pendingReview = carts.filter(c => c.status === "abandoned");
  const cartTotal = pendingReview.reduce((sum, c) => sum + Number(c.cart_value || 0), 0);
  const cartCurrencies = [...new Set(pendingReview.map(c => c.currency || "USD"))];
  const cartValueDisplay = cartCurrencies.length === 1 ? money(cartTotal, cartCurrencies[0]) : cartCurrencies.length > 1 ? "Multiple currencies" : money(0);
  const storeLabel = connected?.name || connected?.shop_domain || "Your store";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const metrics = [
    { label: "Recorded cart value", value: recovery ? cartValueDisplay : "—", detail: "Abandoned-classified records", icon: ShoppingCart },
    { label: "Recovered checkouts", value: recovery ? recovered.toLocaleString() : "—", detail: "Recorded recoveries", icon: TrendingUp },
    { label: "Store connection", value: loading ? "Checking…" : !connected ? "Not connected" : needsAttention ? "Attention needed" : "Connected", detail: connected?.platform || "No platform connected", icon: Store },
    { label: "Recovery rate", value: recovery ? `${rate.toFixed(1)}%` : "—", detail: "Based on recorded checkouts", icon: Activity },
  ];
  return (
    <div className="mx-auto max-w-[1580px] space-y-4 pb-10 text-[#101828]">
      <div className="flex flex-wrap items-start justify-between gap-4 pb-1">
        <div>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#687992]">Command Center</p>
          <h1 className="text-[clamp(1.7rem,2.6vw,2.3rem)] font-extrabold tracking-[-0.045em] text-[#0b1426]">{greeting}{firstName ? `, ${firstName}` : ""}</h1>
          <p className="mt-1.5 max-w-3xl text-[13px] leading-6 text-[#69758b]">{!connected ? "Connect your store to begin monitoring business activity." : needsAttention ? "Your store connection needs attention. Review its setup before relying on new data." : "Here's your store's current operational picture. Explore the evidence behind each reported figure."}</p>
        </div>
        <button onClick={() => setCopilotOpen(true)} className="inline-flex items-center gap-2 rounded-xl bg-[#071225] px-4 py-3 text-xs font-semibold text-white transition hover:bg-[#17365d]"><BrainCircuit className="h-4 w-4 text-[#57a5ff]" /> Ask Rev Intell <ArrowUpRight className="h-3.5 w-3.5" /></button>
      </div>
      <section aria-label="Intelligence briefing" className={`${card} flex flex-wrap items-center justify-between gap-4 border-[#d9e6fb] bg-gradient-to-r from-[#f7faff] to-white px-5 py-4 sm:px-6`}>
        <div className="flex min-w-0 items-start gap-3"><span className={iconBox}><BrainCircuit className="h-5 w-5" /></span><div><p className="text-[10px] font-extrabold uppercase tracking-[.13em] text-[#0868ed]">Intelligence briefing</p><h2 className="mt-1 text-sm font-extrabold text-[#14223b]">{!connected ? "Your briefing starts when a store is connected" : needsAttention ? "Data readiness needs attention" : "Your business briefing is being prepared"}</h2><p className="mt-1 max-w-[740px] text-xs leading-5 text-[#74839a]">{!connected ? "Connect a store to make merchant-specific intelligence available." : needsAttention ? "Review your store's webhook and sync status before interpreting intelligence as complete." : "Scheduled intelligence is running. Merchant-specific briefing retrieval is being verified, so no generated summary is shown here yet."}</p></div></div>
        <button onClick={() => !connected || needsAttention ? navigate("/dashboard/integrations") : setCopilotOpen(true)} className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-[#b9d4fb] px-3 py-2.5 text-xs font-bold text-[#0868ed] hover:bg-[#edf5ff]">{!connected || needsAttention ? "Review connection" : "Ask Rev Intell"} <ArrowRight className="h-3.5 w-3.5" /></button>
      </section>
      {error && <div role="alert" className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700"><CircleAlert className="h-4 w-4" /> Some live data is unavailable. Figures may be incomplete.</div>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(({ label, value, detail, icon: Icon }) => <div key={label} className={`${card} flex min-h-[118px] items-start gap-3 p-5`}><span className={iconBox}><Icon className="h-5 w-5" /></span><div className="min-w-0"><p className="text-xs font-medium text-[#77849a]">{label}</p><p className="mt-1.5 break-words text-[clamp(1.1rem,1.9vw,1.6rem)] font-extrabold tracking-tight text-[#0b1426]">{loading ? "…" : value}</p><p className="mt-1 text-[11px] text-[#8190a4]">{detail}</p></div></div>)}
      </div>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,.75fr)]">
        <section className={`${card} relative overflow-hidden border-[#b7d2ff] bg-gradient-to-br from-[#f7faff] via-[#eef5ff] to-[#dfeeff] p-6 sm:p-7`}>
          <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full border-[35px] border-[#c7dcff]/50" />
          <div className="relative flex h-full flex-col justify-between gap-8">
            <div><div className="flex flex-wrap items-center gap-2"><span className="text-[10px] font-bold uppercase tracking-[.13em] text-[#60728d]">Operational priority</span><span className="rounded-full bg-[#dceaff] px-2.5 py-1 text-[10px] font-bold text-[#075bd3]">{!connected ? "Setup" : needsAttention ? "Needs attention" : "Store activity"}</span></div>
              <h2 className="mt-4 max-w-[600px] text-[clamp(1.4rem,2.3vw,2rem)] font-extrabold leading-tight tracking-[-.035em] text-[#0d1930]">{!connected ? "Connect your store to get started" : needsAttention ? "Your store integration needs attention" : abandoned > 0 ? `${abandoned} checkout records need review` : "Your store is connected and ready to explore"}</h2>
              <p className="mt-3 max-w-[570px] text-[13px] leading-6 text-[#60728d]">{!connected ? "Bring your commerce data into Revluma to start exploring customer and checkout activity." : needsAttention ? "Review the connection and synchronization status to restore reliable monitoring." : abandoned > 0 ? "Review the underlying checkout records. Revluma's classification may differ from Shopify until reconciliation is complete." : "Review customer activity, explore store intelligence, or ask Rev Intell a question."}</p>
            </div>
            <div className="flex flex-wrap items-end justify-between gap-4"><div className="flex gap-7"><div><p className="text-xl font-extrabold">{recovery ? cartValueDisplay : "—"}</p><p className="mt-1 text-[11px] text-[#77849a]">Recorded cart value</p></div><div><p className="text-xl font-extrabold">{recovery ? pendingReview.length : "—"}</p><p className="mt-1 text-[11px] text-[#77849a]">Checkout records to review</p></div></div><button onClick={() => !connected || needsAttention ? navigate("/dashboard/integrations") : abandoned ? setInvestigationOpen(true) : setCopilotOpen(true)} className="inline-flex items-center gap-2 rounded-lg bg-[#0868ed] px-4 py-3 text-xs font-bold text-white shadow-sm hover:bg-[#0059cf]">{!connected ? "Connect store" : needsAttention ? "Review integration" : abandoned ? "Investigate evidence" : "Explore intelligence"} <ArrowRight className="h-4 w-4" /></button></div>
          </div>
        </section>
        <section className={`${card} p-5`}><div className="flex items-center justify-between"><h2 className="text-sm font-extrabold">Other important areas</h2><span className="text-[10px] font-semibold text-[#77849a]">Workspaces</span></div><div className="mt-3 divide-y divide-[#edf0f5]">{[
          { icon: Users, label: "Customer intelligence", sub: "Profiles and segments", to: "/dashboard/customers" },
          { icon: ShoppingCart, label: "Checkout recovery", sub: "Review checkout activity", to: "/dashboard/cart-recovery" },
          { icon: BrainCircuit, label: "Rev Intell", sub: "Investigate your store", to: "/dashboard/rev-intell" },
          { icon: Workflow, label: "Automation settings", sub: "Review supported controls", to: "/dashboard/settings/automation" },
        ].map(({ icon: Icon, label, sub, to }) => <button key={label} onClick={() => navigate(to)} className="flex w-full items-center gap-3 py-3 text-left hover:bg-[#f8faff]"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#edf4ff] text-[#0868ed]"><Icon className="h-4 w-4" /></span><span className="flex-1"><span className="block text-xs font-bold text-[#19243a]">{label}</span><span className="mt-0.5 block text-[11px] text-[#8490a1]">{sub}</span></span><ChevronRight className="h-4 w-4 text-[#9da9ba]" /></button>)}</div></section>
      </div>
      <div className="grid gap-3 xl:grid-cols-[1.2fr_.85fr_1fr]">
        <div className={`${card} min-w-0 overflow-hidden p-4`}><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-extrabold">Business performance</h2><span className="text-[10px] text-[#8190a4]">Live reporting</span></div><RevenueChart chartData={chart} loading={loading} /></div>
        <section className={`${card} p-5`}><div className="flex items-center justify-between"><h2 className="text-sm font-extrabold">Operational status</h2><button onClick={() => navigate("/dashboard/integrations")} className="text-[11px] font-semibold text-[#0868ed]">Manage →</button></div><div className="mt-4 space-y-3">{[
          { icon: Store, label: "Store connection", value: !connected ? "Not connected" : needsAttention ? "Needs attention" : "Connected", good: Boolean(connected && !needsAttention) },
          { icon: ShoppingCart, label: "Checkout records", value: recovery ? String(carts.length) : "Unavailable", good: Boolean(recovery) },
          { icon: CheckCircle2, label: "Recovered checkouts", value: recovery ? String(recovered) : "Unavailable", good: Boolean(recovery) },
        ].map(({ icon: Icon, label, value, good }) => <div key={label} className="flex items-center gap-2.5 border-b border-[#edf0f5] pb-3"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#edf4ff] text-[#0868ed]"><Icon className="h-4 w-4" /></span><span className="flex-1 text-[11px] font-semibold">{label}</span><span className={`rounded-md px-2 py-1 text-[10px] font-bold ${good ? "bg-green-50 text-green-700" : "bg-[#f1f4f8] text-[#69758b]"}`}>{value}</span></div>)}<p className="pt-1 text-[11px] leading-5 text-[#8793a5]">Automation execution is not inferred from connection status.</p></div></section>
        <div className={`${card} min-w-0 overflow-hidden p-4`}><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-extrabold">Recent activity</h2><span className="text-[10px] text-[#8190a4]">Recorded events</span></div><LiveActivity items={activity} loading={loading} /></div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <section className={`${card} p-5 sm:p-6`} aria-labelledby="customer-intelligence-heading">
          <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.13em] text-[#78869b]">Audience intelligence</p><h2 id="customer-intelligence-heading" className="mt-1 text-base font-extrabold text-[#111e34]">Customer intelligence</h2></div><span className={iconBox}><Users className="h-5 w-5" /></span></div>
          <div className="mt-5 rounded-xl border border-dashed border-[#d7e2f0] bg-[#f8fbff] p-5">
            <p className="text-sm font-semibold text-[#25334c]">Customer insights are being connected</p>
            <p className="mt-2 text-xs leading-6 text-[#6b7a90]">Customer segmentation and retention indicators will appear here once their merchant-facing data source is validated. No customer counts or churn predictions are inferred from checkout records.</p>
          </div>
          <button onClick={() => navigate("/dashboard/customers")} className="mt-4 inline-flex items-center gap-2 text-xs font-bold text-[#0868ed]">Open customers <ArrowRight className="h-4 w-4" /></button>
        </section>
        <section className={`${card} p-5 sm:p-6`} aria-labelledby="impact-heading">
          <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.13em] text-[#78869b]">Verified outcomes</p><h2 id="impact-heading" className="mt-1 text-base font-extrabold text-[#111e34]">Revluma Impact</h2></div><span className={iconBox}><TrendingUp className="h-5 w-5" /></span></div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-[#f5f8fd] p-4"><p className="text-[11px] font-medium text-[#718198]">Recorded recovered checkouts</p><p className="mt-2 text-2xl font-extrabold text-[#14223b]">{recovery ? recovered.toLocaleString() : "—"}</p></div>
            <div className="rounded-xl bg-[#f5f8fd] p-4"><p className="text-[11px] font-medium text-[#718198]">Attributed revenue</p><p className="mt-2 text-2xl font-extrabold text-[#14223b]">—</p></div>
          </div>
          <p className="mt-4 text-xs leading-5 text-[#718198]">Checkout status is reported from existing records. Financial attribution will appear only after recovery attribution and currency handling are verified.</p>
          <button onClick={() => navigate("/dashboard/cart-recovery")} className="mt-4 inline-flex items-center gap-2 text-xs font-bold text-[#0868ed]">Review recovery records <ArrowRight className="h-4 w-4" /></button>
        </section>
      </div>
      {investigationOpen && (
        <div className="fixed inset-0 z-[100] flex justify-end bg-[#071225]/45" onClick={() => setInvestigationOpen(false)}>
          <aside role="dialog" aria-modal="true" aria-label="Checkout finding evidence" onClick={e => e.stopPropagation()} className="flex h-full w-full max-w-[480px] flex-col overflow-y-auto bg-white p-6 shadow-2xl sm:p-8">
            <div className="flex items-center justify-between"><span className="text-[10px] font-extrabold uppercase tracking-[.15em] text-[#0868ed]">Evidence · Checkout activity</span><button aria-label="Close investigation" onClick={() => setInvestigationOpen(false)} className="rounded-lg border border-[#dfe6f0] px-3 py-2 text-xs font-semibold">Close</button></div>
            <h2 className="mt-7 text-2xl font-extrabold tracking-tight text-[#101d33]">Review recorded checkout activity</h2>
            <p className="mt-3 text-sm leading-6 text-[#68788f]">This finding is based on checkout records returned by Revluma's recovery API, not a prediction. Classification may differ from Shopify while reconciliation is incomplete.</p>
            <dl className="mt-7 grid grid-cols-2 gap-3"><div className="rounded-xl bg-[#f5f8fd] p-4"><dt className="text-xs text-[#6b7a90]">Records classified abandoned</dt><dd className="mt-2 text-xl font-bold">{abandoned}</dd></div><div className="rounded-xl bg-[#f5f8fd] p-4"><dt className="text-xs text-[#6b7a90]">Value in preview</dt><dd className="mt-2 text-lg font-bold">{cartValueDisplay}</dd></div></dl>
            <p className="mt-3 text-xs leading-5 text-[#8290a3]">Preview value includes up to 200 returned records. It is not a complete revenue-at-risk estimate.</p>
            <h3 className="mt-8 text-sm font-extrabold">Supporting records</h3>
            <div className="mt-3 divide-y divide-[#e8edf5]">{pendingReview.slice(0, 5).map(row => <div key={row.id} className="flex items-center justify-between gap-3 py-3 text-xs"><span className="min-w-0 truncate text-[#394b66]">{row.customer_name || "Guest checkout"}</span><span className="shrink-0 font-bold">{money(Number(row.cart_value), row.currency || "USD")}</span></div>)}{pendingReview.length === 0 && <p className="py-4 text-xs text-[#78869b]">No supporting records in the current preview.</p>}</div>
            <div className="mt-auto flex flex-wrap gap-2 pt-8"><button onClick={() => { setInvestigationOpen(false); navigate("/dashboard/cart-recovery"); }} className="rounded-lg bg-[#0868ed] px-4 py-3 text-xs font-bold text-white">View all records</button><button onClick={() => { setInvestigationOpen(false); setCopilotOpen(true); }} className="rounded-lg border border-[#cddbf0] px-4 py-3 text-xs font-bold text-[#0868ed]">Ask Rev Intell</button></div>
          </aside>
        </div>
      )}
      <section className={`${card} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf0f5] px-5 py-4"><div><h2 className="text-sm font-extrabold">Recent checkout activity</h2><p className="mt-1 text-[11px] text-[#8190a4]">Live records · classification may differ from Shopify</p></div><button onClick={() => navigate("/dashboard/cart-recovery")} className="inline-flex items-center gap-1 text-xs font-bold text-[#0868ed]">View all <ArrowRight className="h-3.5 w-3.5" /></button></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-xs"><thead className="bg-[#fafbfe] text-[10px] uppercase tracking-wider text-[#8995a7]"><tr><th className="px-5 py-3">Customer</th><th className="px-5 py-3">Cart value</th><th className="px-5 py-3">Classification</th><th className="px-5 py-3">Recorded at</th><th className="px-5 py-3">Action</th></tr></thead><tbody className="divide-y divide-[#edf0f5]">{carts.slice(0, 5).map(row => <tr key={row.id} className="hover:bg-[#fafcff]"><td className="px-5 py-3 font-semibold text-[#26334b]">{row.customer_name || "Guest checkout"}</td><td className="px-5 py-3 font-bold">{money(Number(row.cart_value), row.currency || "USD")}</td><td className="px-5 py-3"><span className="rounded-full bg-[#fff2df] px-2.5 py-1 text-[10px] font-bold capitalize text-[#9a5d0a]">{row.status.replace(/_/g, " ")}</span></td><td className="px-5 py-3 text-[#78869b]">{new Date(row.abandoned_at).toLocaleString()}</td><td className="px-5 py-3"><button onClick={() => navigate("/dashboard/cart-recovery")} className="rounded-lg border border-[#bfd7ff] px-3 py-1.5 font-semibold text-[#0868ed] hover:bg-[#eff6ff]">Review →</button></td></tr>)}{!loading && carts.length === 0 && <tr><td colSpan={5} className="px-5 py-10 text-center text-[#8190a4]">No checkout records available yet.</td></tr>}</tbody></table></div>
      </section>
      <button onClick={() => setCopilotOpen(true)} className={`${card} flex w-full flex-wrap items-center justify-between gap-4 p-5 text-left transition hover:border-[#b7d2ff]`}><span className="flex items-center gap-3"><span className={iconBox}><BrainCircuit className="h-5 w-5" /></span><span><span className="block text-sm font-extrabold">Ask Rev Intell about your business</span><span className="mt-1 block text-xs text-[#8190a4]">Investigate the data available from your connected store.</span></span></span><span className="flex items-center gap-2 text-xs font-bold text-[#0868ed]">Start exploring <ArrowRight className="h-4 w-4" /></span></button>
    </div>
  );
}
