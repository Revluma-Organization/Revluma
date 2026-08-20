import { FC, useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
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

// Data merged from Choose-plan HTML
const PLANS = {
  growth: {
    id: "growth",
    name: "Growth",
    monthlyPrice: 29,
    annualPrice: 23, // Per month when billed annually
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
    annualPrice: 40,
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
  // Dashboard State
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [isLoadingSub, setIsLoadingSub] = useState<boolean>(true);

  // UI State
  const [activePlan, setActivePlan] = useState<"growth" | "scale">("growth");
  const [billingCycle, setBillingCycle] = useState<"monthly" | "annual">("annual");
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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

  // Paystack redirect logic 
  const handleUpgrade = async () => {
    setIsProcessing(true);
    setErrorMsg(null);
    try {
      const res = await api.post<{ success: boolean; data?: { authorization_url: string }; error?: string }>(
        "/subscriptions/initialize",
        {
          plan: activePlan,
          billing_cycle: billingCycle,
          currency: "USD", 
        },
        { skipAuthRedirect: true }
      );

      // Trigger Paystack Redirect
      if (res?.data?.authorization_url) {
        window.location.href = res.data.authorization_url;
      } else {
        setErrorMsg(res?.error || "Could not initialize payment. Please try again.");
      }
    } catch (err) {
      setErrorMsg("Network error. Check your connection and try again.");
      console.error("Upgrade failed:", err);
    } finally {
      setIsProcessing(false);
    }
  };

  const currentPlanData = PLANS[activePlan];

  return (
    <div className="w-full max-w-4xl mx-auto space-y-8 rounded-2xl bg-slate-950 p-6 text-slate-100 sm:p-8">
      
      {/* Dashboard Header */}
      <div className="flex flex-col justify-between gap-4 border-b border-slate-800 pb-6 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-500/10 text-sky-400 ring-1 ring-sky-500/20">
            <CreditCard className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Subscription & Plans
            </h1>
            <p className="mt-1 text-sm text-slate-400">
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
          className="overflow-hidden rounded-2xl border border-sky-500/30 bg-gradient-to-r from-slate-900 to-sky-950/40 p-6 shadow-xl"
        >
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
            <div className="space-y-3">
              <Badge className="rounded-full border border-sky-500/40 bg-sky-500/20 px-3 py-1 text-xs font-bold uppercase tracking-wider text-sky-300">
                {subscription.status === "trial" ? "Free Trial" : subscription.planName}
              </Badge>
              <div>
                <h2 className="text-xl font-bold text-white sm:text-2xl">
                  Current Plan: {subscription.planName}
                </h2>
              </div>
            </div>
            <div className="w-full max-w-md space-y-2.5 rounded-xl border border-slate-800/80 bg-slate-950/70 p-4 shadow-inner">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="text-slate-400">Tracked Visitors</span>
                <span className="text-sky-400 font-mono">
                  {subscription.monthlyTrackedVisitorsUsed.toLocaleString()} / {subscription.monthlyTrackedVisitorsLimit.toLocaleString()}
                </span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${usagePercent}%` }}
                  className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-400"
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
      <div className="mx-auto max-w-xl pt-8 pb-12">
        <div className="text-center space-y-6">
          
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
            Unlock your <span className="text-sky-500">Automation</span>
          </h2>

          {/* Plan Toggle (Growth vs Scale) */}
          <div className="mx-auto flex w-fit rounded-full bg-slate-900 p-1 ring-1 ring-slate-800">
            <button
              onClick={() => setActivePlan("growth")}
              className={`rounded-full px-6 py-2.5 text-sm font-semibold transition-all ${
                activePlan === "growth" ? "bg-slate-800 text-white shadow-md ring-1 ring-slate-700" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Growth plan
            </button>
            <button
              onClick={() => setActivePlan("scale")}
              className={`flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold transition-all ${
                activePlan === "scale" ? "bg-slate-800 text-white shadow-md ring-1 ring-slate-700" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Scale plan
              <Sparkles className="h-3.5 w-3.5 text-sky-400" />
            </button>
          </div>

          {/* Dynamic Feature List */}
          <div className="text-left py-6 px-4">
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
                  <li key={idx} className="flex items-center gap-3 text-sm sm:text-base text-slate-200 font-medium">
                    {feature.isAi ? (
                      <Sparkles className="h-5 w-5 shrink-0 text-sky-400" />
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
          <div className="rounded-3xl bg-slate-900 p-4 ring-1 ring-slate-800 shadow-xl space-y-4">
            <div className="grid grid-cols-2 gap-3">
              
              {/* Monthly Button */}
              <button
                onClick={() => setBillingCycle("monthly")}
                className={`flex flex-col items-start rounded-2xl p-4 transition-all text-left relative ${
                  billingCycle === "monthly"
                    ? "bg-sky-500/10 ring-2 ring-sky-500"
                    : "bg-slate-950 ring-1 ring-slate-800 hover:bg-slate-900"
                }`}
              >
                <div className="flex w-full items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-slate-300">Monthly</span>
                  {billingCycle === "monthly" ? (
                    <CheckCircle2 className="h-5 w-5 text-sky-500" />
                  ) : (
                    <Circle className="h-5 w-5 text-slate-700" />
                  )}
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-white">${currentPlanData.monthlyPrice}</span>
                  <span className="text-xs text-slate-400">/mo</span>
                </div>
              </button>

              {/* Yearly Button */}
              <button
                onClick={() => setBillingCycle("annual")}
                className={`flex flex-col items-start rounded-2xl p-4 transition-all text-left relative ${
                  billingCycle === "annual"
                    ? "bg-sky-500/10 ring-2 ring-sky-500"
                    : "bg-slate-950 ring-1 ring-slate-800 hover:bg-slate-900"
                }`}
              >
                <div className="flex w-full items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-slate-300">Yearly</span>
                    <Badge className="bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 border-emerald-500/30 text-[10px] px-1.5 py-0">
                      -20%
                    </Badge>
                  </div>
                  {billingCycle === "annual" ? (
                    <CheckCircle2 className="h-5 w-5 text-sky-500" />
                  ) : (
                    <Circle className="h-5 w-5 text-slate-700" />
                  )}
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-white">${currentPlanData.annualPrice}</span>
                  <span className="text-xs text-slate-400">/mo</span>
                </div>
              </button>
            </div>

            {/* Error Message Display */}
            {errorMsg && (
              <div className="text-sm text-red-400 bg-red-400/10 py-2 rounded-lg border border-red-400/20">
                {errorMsg}
              </div>
            )}

            {/* Primary Action Button */}
            <Button
              type="button"
              onClick={handleUpgrade}
              disabled={isProcessing}
              className="h-14 w-full rounded-xl bg-sky-600 text-base font-bold text-white shadow-lg shadow-sky-600/25 hover:bg-sky-500 active:scale-[0.98]"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Redirecting to Secure Payment...
                </>
              ) : (
                "Start 7-day trial"
              )}
            </Button>

            <div className="flex flex-col items-center justify-center gap-2 pt-2 text-xs text-slate-500">
              <div className="flex gap-4">
                <button className="hover:text-slate-300">Restore subscription</button>
                <button className="hover:text-slate-300">Terms of Service</button>
              </div>
              <div className="flex items-center gap-1 mt-1">
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
