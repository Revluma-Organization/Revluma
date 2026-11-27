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

// Mirrors the landing page pricing (Frontend/Landing/src/content.ts PRICING)
// and the backend PLANS in subscriptionController.js.
const PLANS = {
  starter: {
    id: "starter",
    name: "Starter",
    monthlyPrice: 29,
    annualTotal: 276,
    features: [
      { text: "1 Shopify store", isAi: false },
      { text: "Core store intelligence", isAi: true },
      { text: "Automated signal monitoring", isAi: true },
      { text: "Ranked Top Priorities", isAi: true },
      { text: "Evidence and reasoning", isAi: false },
      { text: "Essential Rev Intelligence access", isAi: true },
      { text: "Basic historical findings", isAi: false },
      { text: "Standard support", isAi: false },
    ],
  },
  premium: {
    id: "premium",
    name: "Premium",
    monthlyPrice: 79,
    annualTotal: 756,
    features: [
      { text: "Everything in Starter", isAi: false },
      { text: "Deeper business investigations", isAi: true },
      { text: "Higher Rev Intelligence allowance", isAi: true },
      { text: "More extensive historical analysis", isAi: false },
      { text: "Advanced findings and prioritisation", isAi: true },
      { text: "More detailed evidence exploration", isAi: false },
      { text: "Advanced business performance insights", isAi: true },
      { text: "Priority support", isAi: false },
    ],
  },
};

export const Subscription: FC = () => {
  const navigate = useNavigate();
  
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [isLoadingSub, setIsLoadingSub] = useState<boolean>(true);

  const [activePlan, setActivePlan] = useState<"starter" | "premium">("starter");
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
    <div className="w-full max-w-4xl mx-auto space-y-8 rounded-2xl bg-white p-6 text-slate-900 shadow-xl border border-slate-200 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100 sm:p-8">
      
      {/* Dashboard Header */}
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 dark:border-neutral-800 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-100 text-sky-600 ring-1 ring-sky-500/20 dark:bg-sky-500/10 dark:text-sky-400">
            <CreditCard className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
              Subscription & Plans
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
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
          className="overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-50 to-sky-50/50 p-6 shadow-sm dark:border-sky-500/30 dark:from-neutral-900 dark:to-sky-950/40 dark:shadow-xl"
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
            <div className="w-full max-w-md space-y-2.5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-neutral-800/80 dark:bg-neutral-950/70 dark:shadow-inner">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="text-slate-500 dark:text-neutral-400">Tracked Visitors</span>
                <span className="font-mono text-sky-600 dark:text-sky-400">
                  {subscription.monthlyTrackedVisitorsUsed.toLocaleString()} / {subscription.monthlyTrackedVisitorsLimit.toLocaleString()}
                </span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-neutral-800">
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

          {/* Plan Toggle (Starter vs Premium) */}
          <div className="mx-auto flex w-fit rounded-full bg-slate-100 p-1 ring-1 ring-slate-200 dark:bg-neutral-900 dark:ring-neutral-800">
            <button
              onClick={() => setActivePlan("starter")}
              className={`rounded-full px-6 py-2.5 text-sm font-semibold transition-all ${
                activePlan === "starter" ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200 dark:bg-neutral-800 dark:text-white dark:ring-neutral-700" : "text-slate-500 hover:text-slate-700 dark:text-neutral-400 dark:hover:text-neutral-200"
              }`}
            >
              Starter plan
            </button>
            <button
              onClick={() => setActivePlan("premium")}
              className={`flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold transition-all ${
                activePlan === "premium" ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200 dark:bg-neutral-800 dark:text-white dark:ring-neutral-700" : "text-slate-500 hover:text-slate-700 dark:text-neutral-400 dark:hover:text-neutral-200"
              }`}
            >
              Premium plan
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
                  <li key={idx} className="flex items-center gap-3 text-sm font-medium text-slate-700 dark:text-neutral-200 sm:text-base">
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
          <div className="space-y-4 rounded-3xl bg-white p-4 shadow-xl ring-1 ring-slate-200 dark:bg-neutral-900 dark:ring-neutral-800">
            <div className="grid grid-cols-2 gap-3">
              
              {/* Monthly Button */}
              <button
                onClick={() => setBillingCycle("monthly")}
                className={`relative flex flex-col items-start rounded-2xl p-4 text-left transition-all ${
                  billingCycle === "monthly"
                    ? "bg-sky-50 ring-2 ring-sky-500 dark:bg-sky-500/10"
                    : "bg-slate-50 ring-1 ring-slate-200 hover:bg-slate-100 dark:bg-neutral-950 dark:ring-neutral-800 dark:hover:bg-neutral-900"
                }`}
              >
                <div className="mb-2 flex w-full items-center justify-between">
                  <span className="text-sm font-semibold text-slate-700 dark:text-neutral-300">Monthly</span>
                  {billingCycle === "monthly" ? (
                    <CheckCircle2 className="h-5 w-5 text-sky-500" />
                  ) : (
                    <Circle className="h-5 w-5 text-slate-300 dark:text-neutral-700" />
                  )}
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-slate-900 dark:text-white">${currentPlanData.monthlyPrice}</span>
                  <span className="text-xs text-slate-500 dark:text-neutral-400">/mo</span>
                </div>
              </button>

              {/* Yearly Button */}
              <button
                onClick={() => setBillingCycle("annual")}
                className={`relative flex flex-col items-start rounded-2xl p-4 text-left transition-all ${
                  billingCycle === "annual"
                    ? "bg-sky-50 ring-2 ring-sky-500 dark:bg-sky-500/10"
                    : "bg-slate-50 ring-1 ring-slate-200 hover:bg-slate-100 dark:bg-neutral-950 dark:ring-neutral-800 dark:hover:bg-neutral-900"
                }`}
              >
                <div className="mb-2 flex w-full items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-slate-700 dark:text-neutral-300">Yearly</span>
                    <Badge className="border-emerald-200 bg-emerald-100 px-1.5 py-0 text-[10px] text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/20 dark:text-emerald-400 dark:hover:bg-emerald-500/20">
                      -20%
                    </Badge>
                  </div>
                  {billingCycle === "annual" ? (
                    <CheckCircle2 className="h-5 w-5 text-sky-500" />
                  ) : (
                    <Circle className="h-5 w-5 text-slate-300 dark:text-neutral-700" />
                  )}
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-slate-900 dark:text-white">${currentPlanData.annualTotal}</span>
                  <span className="text-xs text-slate-500 dark:text-neutral-400">/yr</span>
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

            <div className="flex flex-col items-center justify-center gap-2 pt-2 text-xs text-slate-500 dark:text-neutral-500">
              <div className="flex gap-4">
                <button className="hover:text-slate-700 dark:hover:text-neutral-300">Restore subscription</button>
                <button className="hover:text-slate-700 dark:hover:text-neutral-300">Terms of Service</button>
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
      
