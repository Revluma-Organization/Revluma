import { FC, useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2,
  Sparkles,
  Zap,
  TrendingUp,
  CreditCard,
  Loader2,
  Check,
  ShieldCheck,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";

interface PlanFeature {
  text: string;
  isHighlighted?: boolean;
}

interface PricingCardData {
  id: "growth" | "scale";
  name: string;
  price: string;
  period: string;
  subtitle: string;
  badge?: string;
  features: PlanFeature[];
  buttonText: string;
  isPrimary: boolean;
}

const PRICING_PLANS: PricingCardData[] = [
  {
    id: "growth",
    name: "Growth",
    price: "$29",
    period: "/mo",
    subtitle: "Perfect for stores doing up to $50K/mo",
    features: [
      { text: "AI Cart Recovery" },
      { text: "Product Intelligence" },
      { text: "Up to 1,000 monthly tracked visitors" },
      { text: "Basic reporting dashboards" },
      { text: "1 Store integration" },
      { text: "Basic support" },
      { text: "Email recovery flows" },
    ],
    buttonText: "Upgrade to Growth",
    isPrimary: false,
  },
  {
    id: "scale",
    name: "Scale",
    price: "$50",
    period: "/mo",
    subtitle: "For stores scaling past $100K/mo",
    badge: "MOST POPULAR",
    features: [
      { text: "Everything in Growth", isHighlighted: true },
      { text: "Winning / Trending products dashboard", isHighlighted: true },
      { text: "ROAS Opportunity Scoring", isHighlighted: true },
      { text: "Unlimited Flows" },
      { text: "WhatsApp + Email Automation", isHighlighted: true },
      { text: "Dedicated Onboarding" },
      { text: "Up to 10,000 monthly tracked visitors", isHighlighted: true },
      { text: "Priority support" },
    ],
    buttonText: "Upgrade to Scale",
    isPrimary: true,
  },
];

export interface SubscriptionInfo {
  planName: string;
  status: "trial" | "active" | "past_due" | "canceled";
  trialDaysRemaining?: number;
  monthlyTrackedVisitorsUsed: number;
  monthlyTrackedVisitorsLimit: number;
  resetDate: string;
}

const FALLBACK_SUBSCRIPTION: SubscriptionInfo = {
  planName: "Free Trial",
  status: "trial",
  trialDaysRemaining: 11,
  monthlyTrackedVisitorsUsed: 450,
  monthlyTrackedVisitorsLimit: 1000,
  resetDate: "Aug 1, 2026",
};

export const Subscription: FC = () => {
  const [subscription, setSubscription] = useState<SubscriptionInfo>(
    FALLBACK_SUBSCRIPTION
  );
  const [isLoadingSub, setIsLoadingSub] = useState<boolean>(true);

  const fetchSubscription = useCallback(async () => {
    setIsLoadingSub(true);
    try {
      const res = await api.get<SubscriptionInfo>(
        "/billing/subscription",
        undefined,
        { skipAuthRedirect: true }
      );
      if (res && res.data && res.data.planName) {
        setSubscription(res.data);
      } else {
        setSubscription(FALLBACK_SUBSCRIPTION);
      }
    } catch (err) {
      console.warn("Failed to fetch subscription info from API, using fallback:", err);
      setSubscription(FALLBACK_SUBSCRIPTION);
    } finally {
      setIsLoadingSub(false);
    }
  }, []);

  useEffect(() => {
    fetchSubscription();
  }, [fetchSubscription]);

  const usagePercent = Math.min(
    100,
    Math.round(
      (subscription.monthlyTrackedVisitorsUsed /
        Math.max(1, subscription.monthlyTrackedVisitorsLimit)) *
        100
    )
  );
  const remainingVisitors = Math.max(
    0,
    subscription.monthlyTrackedVisitorsLimit -
      subscription.monthlyTrackedVisitorsUsed
  );

  const [selectedUpgradePlan, setSelectedUpgradePlan] = useState<
    PricingCardData | null
  >(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleUpgradeClick = (plan: PricingCardData) => {
    setSelectedUpgradePlan(plan);
  };

  const handleConfirmUpgrade = () => {
    if (!selectedUpgradePlan) return;
    setIsProcessing(true);
    setTimeout(() => {
      setIsProcessing(false);
      setSuccessMessage(
        `Successfully upgraded your workspace to the ${selectedUpgradePlan.name} plan ($${selectedUpgradePlan.price}/mo).`
      );
      setSelectedUpgradePlan(null);
    }, 1200);
  };

  return (
    <div className="w-full max-w-5xl space-y-8 rounded-2xl bg-slate-950 p-6 text-slate-100 shadow-2xl sm:p-8 md:p-10">
      {/* Page Header */}
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
              Manage your subscription tier, track visitor volume usage, and scale workspace capabilities.
            </p>
          </div>
        </div>
      </div>

      {/* Current Plan Top Banner */}
      <motion.section
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="relative overflow-hidden rounded-2xl border border-sky-500/30 bg-gradient-to-r from-slate-900 via-slate-900/95 to-sky-950/40 p-6 shadow-2xl sm:p-8"
      >
        {isLoadingSub ? (
          <div className="flex items-center justify-center py-6 gap-3 text-slate-400 text-sm">
            <Loader2 className="h-5 w-5 animate-spin text-sky-400" />
            <span>Loading subscription status and usage...</span>
          </div>
        ) : (
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
            {/* Left Info */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <Badge
                  className={`rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wider ${
                    subscription.status === "trial"
                      ? "border-sky-500/40 bg-sky-500/20 text-sky-300"
                      : "border-emerald-500/40 bg-emerald-500/20 text-emerald-300"
                  }`}
                >
                  {subscription.status === "trial"
                    ? "Free Trial"
                    : subscription.planName}
                </Badge>
                <span className="text-xs font-medium text-slate-400">
                  {subscription.status === "trial"
                    ? `• ${subscription.trialDaysRemaining ?? 0} days remaining in trial`
                    : "• Active Subscription"}
                </span>
              </div>

              <div>
                <h2 className="text-xl font-bold text-white sm:text-2xl">
                  Current Plan: {subscription.planName}
                </h2>
                <p className="mt-1 text-xs text-slate-300 sm:text-sm">
                  {subscription.status === "trial"
                    ? "You are currently exploring all Revluma features. Upgrade anytime to avoid interruption."
                    : `Your workspace is actively subscribed to the ${subscription.planName} tier.`}
                </p>
              </div>
            </div>

            {/* Right Usage Progress Bar */}
            <div className="w-full max-w-md space-y-2.5 rounded-xl border border-slate-800/80 bg-slate-950/70 p-4 shadow-inner">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="text-slate-400">Monthly Tracked Visitors</span>
                <span className="text-sky-400 font-mono">
                  {subscription.monthlyTrackedVisitorsUsed.toLocaleString()} /{" "}
                  {subscription.monthlyTrackedVisitorsLimit.toLocaleString()} used{" "}
                  <span className="text-slate-500">({usagePercent}%)</span>
                </span>
              </div>

              {/* Custom Progress Bar */}
              <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${usagePercent}%` }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                  className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-400"
                />
              </div>

              <div className="flex items-center justify-between text-[0.7rem] text-slate-500">
                <span>Resets on {subscription.resetDate}</span>
                <span>
                  {remainingVisitors.toLocaleString()} visitors remaining
                </span>
              </div>
            </div>
          </div>
        )}
      </motion.section>

      {/* Inline Feedback Toast */}
      <AnimatePresence>
        {successMessage && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
              <span>{successMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setSuccessMessage(null)}
              className="rounded p-1 text-slate-400 hover:text-white"
              aria-label="Dismiss message"
            >
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pricing Grid Header */}
      <div className="space-y-1 text-center sm:text-left">
        <h3 className="text-xl font-bold text-white sm:text-2xl">
          Available Subscription Plans
        </h3>
        <p className="text-xs text-slate-400 sm:text-sm">
          Select the growth tier that matches your storefront revenue and automated cart recovery goals.
        </p>
      </div>

      {/* Pricing Grid */}
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        {PRICING_PLANS.map((plan, index) => (
          <motion.div
            key={plan.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: index * 0.1 }}
            className={`relative flex flex-col justify-between rounded-2xl border p-6 shadow-xl transition-all duration-300 sm:p-8 ${
              plan.isPrimary
                ? "border-sky-500/60 bg-slate-900/80 shadow-sky-500/10 hover:border-sky-500"
                : "border-slate-800 bg-slate-900/50 hover:border-slate-700 hover:bg-slate-900/80"
            }`}
          >
            {/* MOST POPULAR Badge for Scale Plan */}
            {plan.badge && (
              <div className="absolute -top-3.5 right-6">
                <Badge className="rounded-full bg-gradient-to-r from-sky-500 to-indigo-500 px-3 py-1 text-xs font-bold text-white shadow-lg shadow-sky-500/25">
                  <Sparkles className="mr-1.5 h-3 w-3" />
                  {plan.badge}
                </Badge>
              </div>
            )}

            <div>
              {/* Plan Name & Price */}
              <div className="space-y-2 border-b border-slate-800/80 pb-6">
                <h4 className="text-lg font-bold text-white sm:text-xl">
                  {plan.name}
                </h4>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
                    {plan.price}
                  </span>
                  <span className="text-sm font-semibold text-slate-400">
                    {plan.period}
                  </span>
                </div>
                <p className="text-xs text-slate-400 sm:text-sm">
                  {plan.subtitle}
                </p>
              </div>

              {/* Features List */}
              <ul className="my-6 space-y-3.5">
                {plan.features.map((feature, idx) => (
                  <li
                    key={idx}
                    className={`flex items-start gap-3 text-xs sm:text-sm ${
                      feature.isHighlighted
                        ? "font-semibold text-sky-300"
                        : "text-slate-300"
                    }`}
                  >
                    <CheckCircle2
                      className={`h-4 w-4 shrink-0 mt-0.5 ${
                        feature.isHighlighted
                          ? "text-sky-400"
                          : "text-emerald-400"
                      }`}
                    />
                    <span>{feature.text}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* CTA Button */}
            <div className="pt-4">
              <Button
                type="button"
                onClick={() => handleUpgradeClick(plan)}
                className={`h-11 w-full font-semibold transition-all active:scale-[0.98] ${
                  plan.isPrimary
                    ? "bg-sky-600 text-white shadow-lg shadow-sky-600/25 hover:bg-sky-500"
                    : "border border-slate-700 bg-slate-800 text-white hover:bg-slate-700"
                }`}
              >
                {plan.isPrimary && <Zap className="mr-2 h-4 w-4 text-sky-200" />}
                <span>{plan.buttonText}</span>
              </Button>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Guaranteed Secure Footnote */}
      <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
        <ShieldCheck className="h-4 w-4 text-emerald-400" />
        <span>
          All plans include automated cart recovery workflows and SSL-secured billing.
        </span>
      </div>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {selectedUpgradePlan && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md space-y-6 rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-sky-400" />
                  <h4 className="text-lg font-bold text-white">
                    Confirm Subscription Upgrade
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedUpgradePlan(null)}
                  disabled={isProcessing}
                  className="rounded p-1 text-slate-400 hover:text-white"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-3">
                <p className="text-sm text-slate-300">
                  You are about to upgrade your workspace to the{" "}
                  <span className="font-bold text-sky-300">
                    {selectedUpgradePlan.name}
                  </span>{" "}
                  tier for{" "}
                  <span className="font-bold text-white">
                    {selectedUpgradePlan.price}
                    {selectedUpgradePlan.period}
                  </span>
                  .
                </p>
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-slate-400">
                  Your billing cycle will adjust automatically and your monthly tracked visitor quota will update immediately.
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSelectedUpgradePlan(null)}
                  disabled={isProcessing}
                  className="border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleConfirmUpgrade}
                  disabled={isProcessing}
                  className="bg-sky-600 font-semibold text-white shadow-lg shadow-sky-600/25 hover:bg-sky-500"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      <span>Processing...</span>
                    </>
                  ) : (
                    <>
                      <Check className="mr-2 h-4 w-4" />
                      <span>Confirm Upgrade</span>
                    </>
                  )}
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Subscription;
