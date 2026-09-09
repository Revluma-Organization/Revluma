import { FC, useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Sparkles,
  Check,
  CreditCard,
  Loader2,
  ShieldCheck,
  Circle,
  CheckCircle2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";

export interface SubscriptionInfo {
  planName: string;
  status: "trial" | "active" | "past_due" | "canceled";
  trialDaysRemaining?: number;
  monthlyTrackedVisitorsUsed: number;
  monthlyTrackedVisitorsLimit: number;
  resetDate: string;
}

const PLANS = {
  growth: {
    id: "growth",
    name: "Growth",
    monthlyPrice: 29,
    annualTotal: 276,
    features: [
      { text: "AI Cart Recovery (email)", isAi: true },
      { text: "Product Intelligence", isAi: true },
      { text: "Optimal send-time AI", isAi: true },
      { text: "1,000 tracked visitors / mo", isAi: false },
      { text: "1 Store integration", isAi: false },
      { text: "Full dashboard access", isAi: false },
      { text: "Priority email support", isAi: false },
    ],
  },
  scale: {
    id: "scale",
    name: "Scale",
    monthlyPrice: 50,
    annualTotal: 480,
    features: [
      { text: "Everything in Growth", isAi: false },
      { text: "Offer value optimizer", isAi: true },
      { text: "Churn risk prediction", isAi: true },
      { text: "WhatsApp + SMS + Email", isAi: false },
      { text: "10,000 tracked visitors / mo", isAi: false },
      { text: "Dedicated onboarding call", isAi: false },
    ],
  },
};

export const Subscription: FC = () => {
  const navigate = useNavigate();
  
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [isLoadingSub, setIsLoadingSub] = useState<boolean>(true);

  const [activePlan, setActivePlan] = useState<"growth" | "scale">("growth");
  const [billingCycle, setBillingCycle] = useState<"monthly" | "annual">("annual");

  const fetchSubscription = useCallback(async () => {
    setIsLoadingSub(true);
    try {
      const res = await api.get<SubscriptionInfo>("/billing/subscription", undefined, { skipAuthRedirect: true });
      if (res?.data?.planName) setSubscription(res.data);
    } catch (err) {
      console.warn("Failed to fetch subscription info:", err);
    } finally {
      setIsLoadingSub(false);
    }
  }, []);

  useEffect(() => {
    fetchSubscription();
  }, [fetchSubscription]);

  const usagePercent = subscription
    ? Math.min(100, Math.round((subscription.monthlyTrackedVisitorsUsed / Math.max(1, subscription.monthlyTrackedVisitorsLimit)) * 100))
    : 0;
  const remainingVisitors = subscription
    ? Math.max(0, subscription.monthlyTrackedVisitorsLimit - subscription.monthlyTrackedVisitorsUsed)
    : 0;

  // Redirect flow to Checkout page!
  const handleUpgrade = () => {
    navigate('/dashboard/checkout', { 
      state: { plan: activePlan, cycle: billingCycle } 
    });
  };

  const currentPlanData = PLANS[activePlan];

  return (
    <div className="w-full max-w-4xl mx-auto space-y-8 rounded-2xl bg-white p-6 text-slate-900 shadow-xl border border-slate-200 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 sm:p-8">
      
      {/* Dashboard Header */}
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 dark:border-slate-800 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-100 text-sky-600 ring-1 ring-sky-500/20 dark:bg-sky-500/10 dark:text-sky-400">
            <CreditCard className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
              Subscription & Plans
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Manage your subscription tier and track visitor usage.
            </p>
          </div>
        </div>
      </div>

      {/* Usage Banner */}
      {!isLoadingSub && subscription && (
        <motion.section
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-50 to-sky-50/50 p-6 shadow-sm dark:border-sky-500/30 dark:from-slate-900 dark:to-sky-950/40 dark:shadow-xl"
        >
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
            <div className="space-y-3">
              <Badge className="rounded-full border border-sky-200 bg-sky-100 px-3 py-1 text-xs font-bold uppercase tracking-wider text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/20 dark:text-sky-300">
                {subscription.status === "trial" ? "Free Trial" : subscription.planName}
              </Badge>
              <div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white sm:text-2xl">
                  Current Plan: {subscription.planName}
                </h2>
              </div>
            </div>
            <div className="w-full max-w-md space-y-2.5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800/80 dark:bg-slate-950/70 dark:shadow-inner">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="text-slate-500 dark:text-slate-400">Tracked Visitors</span>
                <span className="font-mono text-sky-600 dark:text-sky-400">
                  {subscription.monthlyTrackedVisitorsUsed.toLocaleString()} / {subscription.monthlyTrackedVisitorsLimit.toLocaleString()}
                </span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${usagePercent}%` }}
                  className="h-full rounded-full bg-gradient-to-r from-sky-400 to-emerald-400 dark:from-sky-500"
                />
              </div>
              <div className="text-right text-[0.7rem] text-slate-500">
                {remainingVisitors.toLocaleString()} remaining
              </div>
            </div>
          </div>
        </motion.section>
      )}

      {/* New Upgrade UI */}
      <div className="mx-auto max-w-xl pb-12 pt-8">
        <div className="space-y-6 text-center">
          
          <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white sm:text-4xl">
            Unlock your <span className="text-sky-600 dark:text-sky-500">Automation</span>
          </h2>

          {/* Plan Toggle (Growth vs Scale) */}
          <div className="mx-auto flex w-fit rounded-full bg-slate-100 p-1 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <button
              onClick={() => setActivePlan("growth")}
              className={`rounded-full px-6 py-2.5 text-sm font-semibold transition-all ${
                activePlan === "growth" ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:text-white dark:ring-slate-700" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              Growth plan
            </button>
            <button
              onClick={() => setActivePlan("scale")}
              className={`flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold transition-all ${
                activePlan === "scale" ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:text-white dark:ring-slate-700" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              Scale plan
              <Sparkles className="h-3.5 w-3.5 text-sky-500 dark:text-sky-400" />
            </button>
          </div>

          {/* Dynamic Feature List */}
          <div className="px-4 py-6 text-left">
            <AnimatePresence mode="wait">
              <motion.ul
                key={activePlan}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="space-y-4"
              >
                {currentPlanData.features.map((feature, idx) => (
                  <li key={idx} className="flex items-center gap-3 text-sm font-medium text-slate-700 dark:text-slate-200 sm:text-base">
                    {feature.isAi ? (
                      <Sparkles className="h-5 w-5 shrink-0 text-sky-500 dark:text-sky-400" />
                    ) : (
                      <Check className="h-5 w-5 shrink-0 text-emerald-500" />
                    )}
                    <span>{feature.text}</span>
                  </li>
                ))}
              </motion.ul>
            </AnimatePresence>
          </div>

          {/* Bottom Billing Box (Monthly vs Yearly Selection) */}
          <div className="space-y-4 rounded-3xl bg-white p-4 shadow-xl ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <div className="grid grid-cols-2 gap-3">
              
              {/* Monthly Button */}
              <button
                onClick={() => setBillingCycle("monthly")}
                className={`relative flex flex-col items-start rounded-2xl p-4 text-left transition-all ${
                  billingCycle === "monthly"
                    ? "bg-sky-50 ring-2 ring-sky-500 dark:bg-sky-500/10"
                    : "bg-slate-50 ring-1 ring-slate-200 hover:bg-slate-100 dark:bg-slate-950 dark:ring-slate-800 dark:hover:bg-slate-900"
                }`}
              >
                <div className="mb-2 flex w-full items-center justify-between">
                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Monthly</span>
                  {billingCycle === "monthly" ? (
                    <CheckCircle2 className="h-5 w-5 text-sky-500" />
                  ) : (
                    <Circle className="h-5 w-5 text-slate-300 dark:text-slate-700" />
                  )}
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-slate-900 dark:text-white">${currentPlanData.monthlyPrice}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">/mo</span>
                </div>
              </button>

              {/* Yearly Button */}
              <button
                onClick={() => setBillingCycle("annual")}
                className={`relative flex flex-col items-start rounded-2xl p-4 text-left transition-all ${
                  billingCycle === "annual"
                    ? "bg-sky-50 ring-2 ring-sky-500 dark:bg-sky-500/10"
                    : "bg-slate-50 ring-1 ring-slate-200 hover:bg-slate-100 dark:bg-slate-950 dark:ring-slate-800 dark:hover:bg-slate-900"
                }`}
              >
                <div className="mb-2 flex w-full items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Yearly</span>
                    <Badge className="border-emerald-200 bg-emerald-100 px-1.5 py-0 text-[10px] text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/20 dark:text-emerald-400 dark:hover:bg-emerald-500/20">
                      -20%
                    </Badge>
                  </div>
                  {billingCycle === "annual" ? (
                    <CheckCircle2 className="h-5 w-5 text-sky-500" />
                  ) : (
                    <Circle className="h-5 w-5 text-slate-300 dark:text-slate-700" />
                  )}
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-slate-900 dark:text-white">${currentPlanData.annualTotal}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">/yr</span>
                </div>
              </button>
            </div>

            {/* Primary Action Button */}
            <Button
              type="button"
              onClick={handleUpgrade}
              className="h-14 w-full rounded-xl bg-sky-600 text-base font-bold text-white shadow-lg shadow-sky-600/25 transition-all hover:bg-sky-500 active:scale-[0.98]"
            >
              Start 7-day trial
            </Button>

            <div className="flex flex-col items-center justify-center gap-2 pt-2 text-xs text-slate-500 dark:text-slate-500">
              <div className="flex gap-4">
                <button className="hover:text-slate-700 dark:hover:text-slate-300">Restore subscription</button>
                <button className="hover:text-slate-700 dark:hover:text-slate-300">Terms of Service</button>
              </div>
              <div className="mt-1 flex items-center gap-1">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                <span>Billed ${billingCycle === "annual" ? currentPlanData.annualTotal : currentPlanData.monthlyPrice} after trial. Cancel anytime.</span>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
};

export default Subscription;
      
