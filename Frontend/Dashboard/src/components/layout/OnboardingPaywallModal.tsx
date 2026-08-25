import { FC, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, CheckCircle2, Sparkles, Zap, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

interface OnboardingPaywallModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Pass the user's current status from your auth state
  userStatus?: "free" | "in_trial" | "trial_expired" | "premium";
}

export const OnboardingPaywallModal: FC<OnboardingPaywallModalProps> = ({
  isOpen,
  onClose,
  userStatus = "free",
}) => {
  const [isYearly, setIsYearly] = useState<boolean>(true);
  const [processingPlanId, setProcessingPlanId] = useState<string | null>(null);
  const [isStartingTrial, setIsStartingTrial] = useState<boolean>(false);

  // UX Logic: Only show if explicitly open AND they actually need to see it
  const shouldShow =
    isOpen && (userStatus === "free" || userStatus === "trial_expired");

  // Real Pricing Data Strategy based on Subscription Page
  const plans = [
    {
      id: "growth",
      name: "Growth",
      description: "Unlock your automation for growing storefronts.",
      monthlyPrice: 29,
      yearlyPrice: 23, // $276 / 12 months = $23/mo
      features: [
        "AI Cart Recovery (email)",
        "Product Intelligence",
        "Optimal send-time AI",
        "1,000 tracked visitors / mo",
        "1 Store integration",
        "Full dashboard access",
        "Priority email support",
      ],
      isPopular: false,
      buttonText: "Start Growth Plan",
    },
    {
      id: "scale",
      name: "Scale",
      description: "Advanced intelligence and multi-channel recovery.",
      monthlyPrice: 50,
      yearlyPrice: 40, // $480 / 12 months = $40/mo
      features: [
        "Everything in Growth",
        "Offer value optimizer",
        "Churn risk prediction",
        "WhatsApp + SMS + Email",
        "10,000 tracked visitors / mo",
        "Dedicated onboarding call",
      ],
      isPopular: true,
      buttonText: "Start Scale Plan",
    },
  ];

  // Route to Internal Checkout Page
  const handleCheckout = (planId: string) => {
    setProcessingPlanId(planId);
    
    const interval = isYearly ? "yearly" : "monthly";
    
    // BACKEND / ROUTING TODO: 
    // This routes the user exactly to the checkout page 
    // /dashboard/checkout page will need to read the ?plan= and ?interval= 
    // query parameters from the URL to know what to charge the user
    window.location.href = `/dashboard/checkout?plan=${planId}&interval=${interval}`;
  };

  // Trigger 7-Day Free Trial
  const handleStartTrial = async () => {
    setIsStartingTrial(true);
    try {
      // BACKEND TODO: 
      // Backend needs to ensure this endpoint updates the user's DB status 
      // to "in_trial" and sets a trial_ends_at date in the database.
      await api.post("/billing/start-trial", undefined, { skipAuthRedirect: true });
      
      // Trial successfully started, close the modal to let them explore
      onClose();
    } catch (err) {
      console.error("Failed to start trial:", err);
    } finally {
      setIsStartingTrial(false);
    }
  };

  return (
    <AnimatePresence>
      {shouldShow && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-md dark:bg-black/60"
        >
          {/* Main Modal Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="relative flex max-h-[95vh] w-full max-w-4xl flex-col overflow-hidden rounded-[32px] border border-slate-200 bg-slate-50 shadow-2xl dark:border-slate-800 dark:bg-slate-950"
          >
            {/* --- ABSTRACT GLOW EFFECTS --- */}
            <div className="pointer-events-none absolute -left-40 -top-40 h-96 w-96 rounded-full bg-[#007FFF]/20 blur-[100px] dark:bg-[#007FFF]/30" />
            <div className="pointer-events-none absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-emerald-500/20 blur-[100px] dark:bg-emerald-500/20" />

            {/* Always-Available Close Button */}
            <button
              onClick={onClose}
              disabled={isStartingTrial || processingPlanId !== null}
              className="absolute right-6 top-6 z-50 rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white disabled:opacity-50"
            >
              <X className="h-5 w-5" />
            </button>

            {/* Scrollable Content Area */}
            <div className="relative z-10 flex flex-col overflow-y-auto px-6 py-10 sm:px-12 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
              {/* Header */}
              <div className="mx-auto max-w-xl text-center">
                <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white sm:text-4xl">
                  Unlock full revenue potential
                </h2>
                <p className="mt-3 text-sm text-slate-600 dark:text-slate-400 sm:text-base">
                  Join thousands of brands recovering lost carts and scaling their operations with Revluma. Cancel anytime.
                </p>
              </div>

              {/* Global Billing Toggle */}
              <div className="mx-auto mt-8 flex items-center justify-center">
                <div className="relative flex items-center rounded-full bg-slate-200/50 p-1 dark:bg-slate-900">
                  <motion.div
                    layout
                    className="absolute bottom-1 top-1 rounded-full bg-white shadow-sm dark:bg-slate-800"
                    initial={false}
                    animate={{
                      left: isYearly ? "50%" : "4px",
                      right: isYearly ? "4px" : "50%",
                    }}
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />

                  <button
                    onClick={() => setIsYearly(false)}
                    className={`relative z-10 w-32 rounded-full py-2.5 text-sm font-semibold transition-colors ${
                      !isYearly
                        ? "text-slate-900 dark:text-white"
                        : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                    }`}
                  >
                    Monthly
                  </button>
                  <button
                    onClick={() => setIsYearly(true)}
                    className={`relative z-10 flex w-40 items-center justify-center gap-1.5 rounded-full py-2.5 text-sm font-semibold transition-colors ${
                      isYearly
                        ? "text-slate-900 dark:text-white"
                        : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                    }`}
                  >
                    Yearly
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                      Save 20%
                    </span>
                  </button>
                </div>
              </div>

              {/* Mobile Swipe / Desktop Grid Container */}
               <div className="mt-10 flex w-full items-start snap-x snap-mandatory gap-6 overflow-x-auto py-4 md:grid md:grid-cols-2 md:overflow-visible md:py-0 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                {plans.map((plan) => {
                  const price = isYearly ? plan.yearlyPrice : plan.monthlyPrice;
                  const isProcessingThisPlan = processingPlanId === plan.id;
                  const isAnyLoading = processingPlanId !== null || isStartingTrial;

                  return (
                    <div
                      key={plan.id}
                      className={`relative flex w-[85vw] shrink-0 snap-center flex-col justify-between rounded-[28px] border bg-white p-6 shadow-xl dark:bg-slate-950/50 sm:w-[380px] md:w-auto md:p-8 ${
                        plan.isPopular
                          ? "border-[#007FFF]/40 ring-1 ring-[#007FFF]/20 dark:border-[#007FFF]/50"
                          : "border-slate-200 dark:border-slate-800"
                      }`}
                    >
                      {/* Popular Badge */}
                      {plan.isPopular && (
                        <div className="absolute -top-3.5 left-0 right-0 flex justify-center">
                          <div className="flex items-center gap-1 rounded-full bg-gradient-to-r from-[#007FFF] to-sky-400 px-3 py-1 text-xs font-bold uppercase tracking-wider text-white shadow-md">
                            <Sparkles className="h-3 w-3" />
                            Most Popular
                          </div>
                        </div>
                      )}

                      <div>
                        <div className="flex items-center justify-between">
                          <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                            {plan.name}
                          </h3>
                          {plan.isPopular && <Zap className="h-5 w-5 text-[#007FFF] dark:text-sky-400" />}
                        </div>
                        <p className="mt-2 min-h-[40px] text-sm text-slate-500 dark:text-slate-400">
                          {plan.description}
                        </p>

                        <div className="mt-6 flex items-baseline gap-2">
                          <span className="text-4xl font-extrabold text-slate-900 dark:text-white">
                            ${price}
                          </span>
                          <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
                            / month
                          </span>
                        </div>
                        {isYearly && (
                          <p className="mt-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                            Billed annually (${price * 12}/year)
                          </p>
                        )}
                        {!isYearly && <p className="mt-1 text-xs text-transparent">.</p>}

                        {/* Features List */}
                        <ul className="mt-8 space-y-4">
                          {plan.features.map((feature, i) => (
                            <li key={i} className="flex items-start gap-3">
                              <CheckCircle2 className={`h-5 w-5 shrink-0 ${plan.isPopular ? "text-[#007FFF] dark:text-sky-400" : "text-emerald-500"}`} />
                              <span className="text-sm text-slate-700 dark:text-slate-300">
                                {feature}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      {/* Select Button */}
                      <Button
                        onClick={() => handleCheckout(plan.id)}
                        disabled={isAnyLoading}
                        className={`mt-10 h-12 w-full rounded-xl font-bold transition-all active:scale-[0.98] disabled:opacity-70 ${
                          plan.isPopular
                            ? "bg-[#007FFF] text-white shadow-lg shadow-[#007FFF]/25 hover:bg-[#007FFF]/90"
                            : "bg-slate-100 text-slate-900 hover:bg-slate-200 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800"
                        }`}
                      >
                        {isProcessingThisPlan ? (
                          <span className="flex items-center gap-2">
                            <Loader2 className="h-5 w-5 animate-spin" />
                            Redirecting...
                          </span>
                        ) : (
                          plan.buttonText
                        )}
                      </Button>
                    </div>
                  );
                })}
              </div>

              {/* Skip & Trial Footer */}
              <div className="mt-6 text-center md:mt-10">
                <button
                  onClick={handleStartTrial}
                  disabled={processingPlanId !== null || isStartingTrial}
                  className="group inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800 disabled:opacity-50 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  {isStartingTrial ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Activating 7-Day Free Trial...
                    </span>
                  ) : (
                    "Skip for now — start my 7-day free trial"
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
