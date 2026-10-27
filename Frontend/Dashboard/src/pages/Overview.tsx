import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Activity, BrainCircuit, CheckCircle2, ChevronRight, CircleAlert, Layers3, ShieldCheck, Sparkles, Store, TrendingUp, Zap } from "lucide-react";
import { api } from "@/lib/api";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { RevenueChart } from "@/components/dashboard/RevenueChart";
import { LiveActivity } from "@/components/dashboard/LiveActivity";
import { ConnectBanner } from "@/components/dashboard/ConnectBanner";
import type { KPI, ActivityItem, ChartData } from "@/data/mockOverview";

type ConnectedStore = { id?: string; name?: string; shop_domain?: string; platform: string; connection_status?: string; setup_status?: string; sync_status?: string };
type CheckoutStats = { total_abandoned?: number | string; total_recovered?: number | string; recovery_rate?: number | string };
type CartResponse = { success: boolean; data?: { stats?: CheckoutStats } };

export default function Overview() {
  const navigate = useNavigate();
  const [firstName, setFirstName] = useState("");
  const [kpis, setKpis] = useState<KPI[]>([]);
  const [chart, setChart] = useState<ChartData | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [stores, setStores] = useState<ConnectedStore[]>([]);
  const [recovery, setRecovery] = useState<CheckoutStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [profile, kpi, chartResult, activityResult, storesResult, recoveryResult] = await Promise.allSettled([
        api.get<{ success: boolean; data: { full_name?: string } }>("/auth/me"),
        api.get<{ success: boolean; data: { kpi: KPI[] } }>("/dashboard/kpis"),
        api.get<{ success: boolean; data: { chart: ChartData } }>("/dashboard/chart"),
        api.get<{ success: boolean; data: { activity: ActivityItem[] } }>("/dashboard/activity", { limit: 12 }),
        api.get<{ success: boolean; data: { stores: ConnectedStore[] } }>("/stores"),
        api.get<CartResponse>("/dashboard/cart-recovery"),
      ]);
      if (cancelled) return;
      if (profile.status === "fulfilled") setFirstName(profile.value.data.data?.full_name?.split(" ")[0] || "");
      if (kpi.status === "fulfilled") setKpis(kpi.value.data.data?.kpi || []);
      if (chartResult.status === "fulfilled") setChart(chartResult.value.data.data?.chart || null);
      if (activityResult.status === "fulfilled") setActivity(activityResult.value.data.data?.activity || []);
      if (storesResult.status === "fulfilled") setStores(storesResult.value.data.data?.stores || []);
      if (recoveryResult.status === "fulfilled") setRecovery(recoveryResult.value.data.data?.stats || null);
      setLoadError([kpi, storesResult].some((r) => r.status === "rejected"));
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const connected = stores.find((store) => store.connection_status === "connected");
  const hasStore = Boolean(connected);
  const syncNeedsAttention = Boolean(connected && (connected.setup_status === "failed" || connected.sync_status === "failed"));
  const abandoned = Number(recovery?.total_abandoned ?? 0);
  const recovered = Number(recovery?.total_recovered ?? 0);
  const meaningfulKpis = kpis.filter((k) => ["rev", "carts", "rate", "subs"].includes(k.id)).slice(0, 4);

  return (
    <div className="mx-auto max-w-[1480px] space-y-6 pb-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.17em] text-blue-500"><Sparkles className="h-3.5 w-3.5" /> Command Center</div>
          <h1 className="text-[clamp(1.7rem,3vw,2.4rem)] font-extrabold tracking-tight text-t1">Welcome back{firstName ? `, ${firstName}` : ""}.</h1>
          <p className="mt-2 text-sm text-t2">A clearer view of your business, what needs attention, and what Revluma can help you explore.</p>
        </div>
        <button onClick={() => navigate("/dashboard/rev-intell")} className="inline-flex items-center gap-2 rounded-xl bg-[#0868ed] px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#0758ca]"><BrainCircuit className="h-4 w-4" /> Ask Rev Intell <ArrowRight className="h-4 w-4" /></button>
      </header>

      <ConnectBanner storeConnected={loading ? null : hasStore} />

      {hasStore && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-bg-2 px-4 py-3">
          <div className="flex items-center gap-2.5 text-sm text-t1">
            <Store className="h-4 w-4 text-blue-500" />
            <span className="font-semibold">{connected?.name || connected?.shop_domain || "Connected store"}</span>
            <span className={`rounded-full px-2 py-1 text-xs font-semibold ${syncNeedsAttention ? "bg-red-500/10 text-red-500" : "bg-green-500/10 text-green-600"}`}>{syncNeedsAttention ? "Setup needs attention" : "Connected"}</span>
          </div>
          <button onClick={() => navigate("/dashboard/integrations")} className="inline-flex items-center gap-1 text-xs font-semibold text-blue-500 hover:underline">Manage connection <ChevronRight className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {loadError && <div role="alert" className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-t1">Some store data could not be loaded. Figures below may be incomplete. Refresh the page to retry.</div>}

      <section className="relative overflow-hidden rounded-[22px] border border-blue-500/15 bg-gradient-to-br from-[#09162b] via-[#10254a] to-[#0868ed] p-6 text-white shadow-[0_16px_40px_-30px_rgba(4,50,160,.7)] sm:p-8">
        <div className="pointer-events-none absolute -right-20 -top-32 h-80 w-80 rounded-full border border-white/10" />
        <div className="pointer-events-none absolute -right-5 -top-12 h-60 w-60 rounded-full border border-white/10" />
        <div className="relative grid gap-8 lg:grid-cols-[1.35fr_.65fr] lg:items-center">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-blue-100"><Activity className="h-3.5 w-3.5" /> Your business briefing</span>
            <h2 className="mt-5 max-w-2xl text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
              {loading ? "Preparing your briefing…" : !hasStore ? "Connect your store to unlock business intelligence." : syncNeedsAttention ? "Your store connection needs attention." : abandoned > 0 ? `${abandoned} checkout sessions are currently classified as abandoned.` : "Your workspace is ready. Revluma is monitoring available store activity."}
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-blue-100/85">
              {!hasStore ? "Connect a commerce platform to start receiving real operational data." : syncNeedsAttention ? "Review your integration status before relying on new store activity." : abandoned > 0 ? "Review these checkout records and their eligibility before taking action. Checkout totals may differ from Shopify until reconciliation is complete." : "Explore customer activity, performance, and connected workflows as data becomes available."}
            </p>
            <button onClick={() => navigate(!hasStore || syncNeedsAttention ? "/dashboard/integrations" : abandoned > 0 ? "/dashboard/cart-recovery" : "/dashboard/rev-intell")} className="mt-6 inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-bold text-[#0c3e9e] transition hover:bg-blue-50">
              {!hasStore ? "Connect store" : syncNeedsAttention ? "Review connection" : abandoned > 0 ? "Review checkout activity" : "Explore with Rev Intell"} <ArrowRight className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <div className="rounded-xl border border-white/15 bg-white/10 p-4 backdrop-blur-sm"><p className="text-xs text-blue-100/80">Connection health</p><p className="mt-2 flex items-center gap-2 text-lg font-bold">{!hasStore ? <CircleAlert className="h-5 w-5" /> : syncNeedsAttention ? <CircleAlert className="h-5 w-5 text-red-300" /> : <ShieldCheck className="h-5 w-5 text-green-300" />}{loading ? "Checking…" : !hasStore ? "Not connected" : syncNeedsAttention ? "Needs attention" : "Connected"}</p></div>
            <div className="rounded-xl border border-white/15 bg-white/10 p-4 backdrop-blur-sm"><p className="text-xs text-blue-100/80">Checkout records</p><p className="mt-2 text-2xl font-bold">{recovery ? abandoned.toLocaleString() : "—"}</p><p className="mt-1 text-[11px] text-blue-100/75">Classified abandoned · reconciliation pending</p></div>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-end justify-between gap-4"><div><h2 className="text-lg font-bold text-t1">Business at a glance</h2><p className="mt-1 text-xs text-t2">Available store metrics, without the clutter.</p></div><button onClick={() => navigate("/dashboard/cart-recovery")} className="text-xs font-semibold text-blue-500 hover:underline">Explore recovery <ArrowRight className="inline h-3 w-3" /></button></div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {meaningfulKpis.length ? meaningfulKpis.map((k, i) => <KpiCard key={k.id} kpi={k} index={i} />) : Array.from({ length: 4 }, (_, i) => <div key={i} className="rounded-xl border border-border bg-bg-2 p-5"><div className="h-3 w-24 rounded bg-bg-4" /><div className="mt-4 text-xl font-bold text-t2">{loading ? "Loading…" : "No data yet"}</div></div>)}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="rounded-2xl border border-border bg-bg-2 p-5 sm:p-6">
          <div className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-blue-500" /><h2 className="text-base font-bold text-t1">Explore what matters</h2></div>
          <p className="mt-1 text-xs text-t2">Open a dedicated workspace to investigate and act.</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {[
              { icon: Layers3, title: "Customer intelligence", body: "Explore customer relationships, segments, and available customer records.", to: "/dashboard/customers" },
              { icon: Activity, title: "Checkout recovery", body: "Inspect checkout activity and recovery status.", to: "/dashboard/cart-recovery" },
              { icon: BrainCircuit, title: "Rev Intell", body: "Ask questions and investigate your store with AI.", to: "/dashboard/rev-intell" },
              { icon: Zap, title: "Automation settings", body: "Review available controls and configure supported workflows.", to: "/dashboard/settings/automation" },
            ].map(({ icon: Icon, title, body, to }) => <button key={title} onClick={() => navigate(to)} className="group flex items-start gap-3 rounded-xl border border-border bg-bg-3 p-4 text-left transition hover:border-blue-500/40 hover:shadow-sm"><span className="rounded-lg bg-blue-500/10 p-2 text-blue-500"><Icon className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-bold text-t1">{title}</span><span className="mt-1 block text-xs leading-5 text-t2">{body}</span></span><ChevronRight className="mt-1 h-4 w-4 text-t3 transition group-hover:translate-x-0.5" /></button>)}
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-bg-2 p-5 sm:p-6">
          <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-blue-500" /><h2 className="text-base font-bold text-t1">Operational snapshot</h2></div>
          <p className="mt-1 text-xs text-t2">Only confirmed states are shown here.</p>
          <div className="mt-5 space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-border bg-bg-3 px-4 py-3"><span className="text-sm text-t2">Store connection</span><span className="text-xs font-bold text-t1">{hasStore ? syncNeedsAttention ? "Attention needed" : "Connected" : "Not connected"}</span></div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-bg-3 px-4 py-3"><span className="text-sm text-t2">Recovered checkouts</span><span className="text-xs font-bold text-t1">{recovery ? recovered.toLocaleString() : "Not available"}</span></div>
            <div className="rounded-lg border border-blue-500/15 bg-blue-500/5 px-4 py-3 text-xs leading-5 text-t2">Automated actions are not shown as running unless their execution status can be verified. Manage available controls in automation settings.</div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.45fr_1fr]">
        <RevenueChart chartData={chart} loading={loading} />
        <LiveActivity items={activity} loading={loading} />
      </section>

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-blue-500/20 bg-blue-500/5 p-5 sm:p-6">
        <div className="flex items-start gap-3"><span className="rounded-xl bg-blue-500/10 p-3 text-blue-500"><BrainCircuit className="h-6 w-6" /></span><div><h2 className="text-base font-bold text-t1">Explore your business with Rev Intell</h2><p className="mt-1 max-w-lg text-sm text-t2">Ask about customers, store activity, and what the available data can tell you.</p></div></div>
        <button onClick={() => navigate("/dashboard/rev-intell")} className="inline-flex items-center gap-2 rounded-lg bg-[#0868ed] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0758ca]">Open Rev Intell <ArrowRight className="h-4 w-4" /></button>
      </section>
    </div>
  );
}
