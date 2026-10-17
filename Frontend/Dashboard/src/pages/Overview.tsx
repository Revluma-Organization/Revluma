// src/pages/Overview.tsx
import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, Loader2, Sparkles, ArrowRight, ShieldCheck, X } from "lucide-react";
import { ConnectBanner } from "@/components/dashboard/ConnectBanner";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { RevenueChart } from "@/components/dashboard/RevenueChart";
import { LiveActivity } from "@/components/dashboard/LiveActivity";
import { SequencesTable } from "@/components/dashboard/SequencesTable";
import { AbandonedProducts } from "@/components/dashboard/AbandonedProducts";
import { AIInsights } from "@/components/dashboard/AIInsights";
import { RevenueAttribution } from "@/components/dashboard/RevenueAttribution";
import { HealthScore } from "@/components/dashboard/HealthScore";
import { AnalyticsStrip, InnovationRow } from "@/components/dashboard/Strips";
import { QuickActions, TrendingProducts, WinbackLeaderboard } from "@/components/dashboard/BottomGrid";
import type {
  KPI,
  ActivityItem,
  SequenceRow,
  ProductRow,
  DonutSlice,
  Health,
  AnalyticTile,
  InnovationCard,
  ChartData,
  AIInsight,
  Trending,
  WinbackEntry,
} from "@/data/mockOverview";

interface ConnectedStoreInfo {
  id?: string;
  name?: string;
  shop_domain?: string;
  platform: string;
  status: string;
  connection_status?: "connected" | "disconnected";
  setup_status?: string;
  last_synced_at?: string | null;
  sync_status?: string;
}

export default function Overview() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [userName, setUserName] = useState<string | null>(null);
  const [kpi, setKpi] = useState<KPI[] | null>(null);
  const [chart, setChart] = useState<ChartData | null>(null);
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [sequences, setSequences] = useState<SequenceRow[] | null>(null);
  const [abandonedProducts, setAbandonedProducts] = useState<ProductRow[] | null>(null);
  const [donutSlices, setDonutSlices] = useState<DonutSlice[] | null>(null);
  const [donutTotal, setDonutTotal] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticTile[] | null>(null);
  const [innovation, setInnovation] = useState<InnovationCard[] | null>(null);
  const [trendingProducts, setTrendingProducts] = useState<Trending[] | null>(null);
  const [winback, setWinback] = useState<WinbackEntry[] | null>(null);
  const [insights, setInsights] = useState<AIInsight[] | null>(null);
  const [storeConnected, setStoreConnected] = useState<boolean | null>(null);
  const [activeStore, setActiveStore] = useState<ConnectedStoreInfo | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Onboarding & Sync UI states
  const [showSuccessToast, setShowSuccessToast] = useState(false);
  const [hideSyncCard, setHideSyncCard] = useState(() => {
    return sessionStorage.getItem("rv_hide_sync_card") === "true";
  });

  useEffect(() => {
    // Trigger toast if redirected from Shopify OAuth callback
    const isJustConnected =
      searchParams.get("shopify") === "connected" ||
      searchParams.get("connected") === "true" ||
      searchParams.get("shop") !== null;

    if (isJustConnected) {
      setShowSuccessToast(true);
      sessionStorage.removeItem("rv_hide_sync_card");
      setHideSyncCard(false);
      // Clean URL query parameters
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("shopify");
      nextParams.delete("connected");
      setSearchParams(nextParams, { replace: true });

      const timer = setTimeout(() => setShowSuccessToast(false), 6000);
      return () => clearTimeout(timer);
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    async function fetchDashboard() {
      try {
        let meData: { full_name: string; organizations?: Array<{ id: string }> } | null = null;
        try {
          const meRes = await api.get<{ success: boolean; data: { full_name: string; organizations?: Array<{ id: string }> } }>("/auth/me");
          meData = meRes.data.data;
        } catch {
          try {
            const meRes = await api.get<{ success: boolean; data: { full_name: string } }>("/auth/getProfile");
            meData = meRes.data.data;
          } catch {
            // Identity fallback
          }
        }
        if (meData?.full_name) setUserName(meData.full_name);
      } catch {
        // Non-blocking
      }

      const settled = await Promise.allSettled([
        api.get<{ success: boolean; data: { kpi: KPI[] } }>("/dashboard/kpis"),
        api.get<{ success: boolean; data: { chart: ChartData } }>("/dashboard/chart"),
        api.get<{ success: boolean; data: { activity: ActivityItem[] } }>("/dashboard/activity", { limit: 20 }),
        api.get<{ success: boolean; data: { stores: ConnectedStoreInfo[] } }>("/stores"),
      ]);

      const [kpiResult, chartResult, activityResult, storesResult] = settled;

      if (kpiResult.status === "fulfilled") {
        setKpi(kpiResult.value.data.data?.kpi ?? null);
      }
      if (chartResult.status === "fulfilled") {
        setChart(chartResult.value.data.data?.chart ?? null);
      }
      if (activityResult.status === "fulfilled") {
        setActivity(activityResult.value.data.data?.activity ?? null);
      }
      if (storesResult.status === "fulfilled") {
        const stores = storesResult.value.data.data?.stores ?? [];
        const connected = stores.find((s) => s.connection_status === "connected");
        setStoreConnected(Boolean(connected));
        setActiveStore(connected ?? null);
      }

      setLoading(false);
    }
    fetchDashboard();
  }, []);

  const firstName = userName ? userName.split(" ")[0] : null;
  const hasDataArrived = Boolean((kpi && kpi.length > 0) || (activity && activity.length > 0));

  function dismissSyncCard() {
    sessionStorage.setItem("rv_hide_sync_card", "true");
    setHideSyncCard(true);
  }

  return (
    <div className="mx-auto max-w-[1480px] space-y-5">
      {/* Immediate Connection Success Toast */}
      <AnimatePresence>
        {showSuccessToast && (
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            className="fixed right-5 top-5 z-[999] flex items-center gap-3.5 rounded-2xl border border-emerald-500/30 bg-bg-2 px-5 py-4 shadow-2xl"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[0.85rem] font-bold text-t1">Store Connected Successfully!</p>
              <p className="text-[0.75rem] text-t2">
                Revluma is now syncing your orders, customers, and abandoned checkouts.
              </p>
            </div>
            <button
              onClick={() => setShowSuccessToast(false)}
              className="ml-2 text-t3 hover:text-t1"
            >
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Shown when NO store is connected */}
      <ConnectBanner storeConnected={storeConnected} />

      {/* Shown when a store IS connected: Live Sync Status + CTA */}
      {storeConnected && !hideSyncCard && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-2xl border border-emerald-500/25 bg-bg-2 p-5 shadow-sm"
        >
          <button
            onClick={dismissSyncCard}
            title="Dismiss setup guide"
            className="absolute right-4 top-4 rounded-lg p-1 text-t3 transition-colors hover:bg-bg-4 hover:text-t1"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-[0.72rem] font-bold uppercase tracking-wider text-emerald-400">
                <Sparkles className="h-3.5 w-3.5" />
                {activeStore?.platform ? `${activeStore.platform} Active` : "Store Connected"}
                {activeStore?.shop_domain ? ` • ${activeStore.shop_domain}` : ""}
              </div>
              <h2 className="text-[1.05rem] font-bold text-t1">
                {hasDataArrived
                  ? "Initial Store Synchronization Complete"
                  : "Initial Store Synchronization in Progress…"}
              </h2>
              <p className="max-w-2xl text-[0.8rem] text-t2">
                {hasDataArrived
                  ? "Your historical customers, orders, and checkout events are synced. Configure your safety limits to activate automated cart recovery."
                  : "We are indexing your customers, orders, and abandoned checkouts in the background. Your dashboard metrics will populate automatically over the next 1–2 minutes."}
              </p>

              {/* Sync Checklist Metrics */}
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <div className="flex items-center gap-1.5 rounded-lg border border-border bg-bg-3 px-3 py-1.5 text-[0.75rem] font-medium text-t1">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  Storefront API Linked
                </div>
                <div className="flex items-center gap-1.5 rounded-lg border border-border bg-bg-3 px-3 py-1.5 text-[0.75rem] font-medium text-t1">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  Webhooks & Pixel Active
                </div>
                <div className="flex items-center gap-1.5 rounded-lg border border-border bg-bg-3 px-3 py-1.5 text-[0.75rem] font-medium text-t1">
                  {hasDataArrived ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
                  )}
                  {hasDataArrived ? "Orders & Carts Synced" : "Syncing Orders & Abandoned Carts…"}
                </div>
              </div>
            </div>

            {/* Call To Action */}
            <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col lg:items-end">
              <button
                onClick={() => navigate("/dashboard/settings/automation")}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-[0.82rem] font-bold text-black shadow-md transition-all hover:bg-emerald-400"
              >
                Configure Automation
                <ArrowRight className="h-4 w-4" />
              </button>
              <span className="flex items-center gap-1 text-[0.7rem] text-t3">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                Safe mode: nothing sends until you save limits
              </span>
            </div>
          </div>
        </motion.div>
      )}

      {/* Welcome */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32 }}
      >
        <h1 className="display text-[1.6rem] font-extrabold tracking-tight text-t1 sm:text-[1.85rem]">
          Welcome back,{" "}
          {loading
            ? <span className="inline-block h-7 w-28 animate-pulse rounded-md bg-bg-4 align-middle" />
            : (firstName ?? "--")}{" "}
          <span className="wave-emoji">👋</span>
        </h1>
        <p className="mt-1 text-[0.85rem] text-t2">
          Here's what's happening with your store today
        </p>
      </motion.div>

      {/* KPI grid */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {kpi
          ? kpi.map((k, i) => <KpiCard key={k.id} kpi={k} index={i} />)
          : Array.from({ length: 6 }).map((_, i) => <KpiCardSkeleton key={i} index={i} />)}
      </section>

      {/* Chart + Activity */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <RevenueChart chartData={chart} loading={loading} />
        <LiveActivity items={activity} loading={loading} />
      </section>

      {/* Sequences + Products */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <SequencesTable sequences={sequences} loading={loading} />
        <AbandonedProducts products={abandonedProducts} loading={loading} />
      </section>

      {/* Insights + Donut + Health */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <AIInsights insights={insights} loading={loading} />
        <RevenueAttribution slices={donutSlices} total={donutTotal} loading={loading} />
        <HealthScore health={health} loading={loading} />
      </section>

      {/* Analytics strip */}
      <AnalyticsStrip tiles={analytics} loading={loading} />

      {/* Innovation row */}
      <InnovationRow cards={innovation} loading={loading} />

      {/* Bottom grid */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <QuickActions />
        <TrendingProducts products={trendingProducts} loading={loading} />
        <WinbackLeaderboard entries={winback} loading={loading} />
      </section>

      {/* Global error toast */}
      {error && (
        <div className="fixed bottom-4 right-4 z-[999] rounded-xl border border-red-500/30 bg-bg-2 px-4 py-3 text-[0.82rem] shadow-elegant" style={{ color: "hsl(var(--red))" }}>
          {error}
        </div>
      )}
    </div>
  );
}

function KpiCardSkeleton({ index }: { index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.04 + index * 0.04, duration: 0.32 }}
      className="relative flex flex-col overflow-hidden rounded-xl border border-border bg-bg-2 p-4"
    >
      <div className="mb-3 flex items-start justify-between">
        <div className="h-7 w-7 animate-pulse rounded-md bg-bg-4" />
        <div className="h-5 w-14 animate-pulse rounded-full bg-bg-4" />
      </div>
      <div className="h-8 w-24 animate-pulse rounded-md bg-bg-4" />
      <div className="mt-2 h-3 w-28 animate-pulse rounded-md bg-bg-4" />
      <div className="mt-1 h-2.5 w-20 animate-pulse rounded-md bg-bg-4" />
      <div className="mt-3 h-9 w-full animate-pulse rounded-md bg-bg-4" />
    </motion.div>
  );
}