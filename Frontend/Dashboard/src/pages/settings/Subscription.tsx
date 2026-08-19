/**
 * Revluma — Subscription & Plans
 *
 * Matches the choose-plan.html visual language:
 * light lavender background, white cards, blue center card.
 *
 * Button logic:
 *   free      → Growth: Upgrade  | Scale: Upgrade
 *   trialing  → Growth: Upgrade  | Scale: Upgrade
 *   growth    → Growth: Current Plan (disabled) | Scale: Upgrade
 *   scale     → Growth: Downgrade | Scale: Current Plan (disabled)
 */

import { FC, useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2,
  Loader2,
  X,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  CreditCard,
  Calendar,
  AlertCircle,
} from "lucide-react";
import { api } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CurrentSub {
  plan: "free" | "growth" | "scale" | "enterprise";
  status: "trialing" | "active" | "cancelled" | "past_due" | "paused";
  billing_cycle: "monthly" | "annual" | null;
  current_period_end: string | null;
  trial_ends_at: string | null;
  cancelled_at: string | null;
}

type ButtonIntent = "current" | "upgrade" | "downgrade" | "get_started";

// ── Plan definitions ──────────────────────────────────────────────────────────

const PLANS = [
  {
    id: "free" as const,
    name: "Free Trial",
    price: "$0",
    priceSuffix: "/7 days",
    subtitle: "Try Revluma free. No card required.",
    features: [
      "AI Cart Recovery (email)",
      "Product Intelligence",
      "B2C CRM",
      "1,000 tracked visitors",
      "1 Store integration",
      "Full dashboard access",
    ],
    isFeatured: false,
  },
  {
    id: "growth" as const,
    name: "Growth",
    price: "$29",
    priceSuffix: "/month",
    subtitle: "For stores doing up to $50K/mo.",
    badge: "Most Popular",
    features: [
      "Everything in Free Trial",
      "AI abandonment scoring (M1)",
      "Sensitivity classifier (M2)",
      "Optimal send-time AI (M3)",
      "ROAS opportunity scoring",
      "Priority email support",
    ],
    isFeatured: true,
  },
  {
    id: "scale" as const,
    name: "Scale",
    price: "$50",
    priceSuffix: "/month",
    subtitle: "For stores scaling past $100K/mo.",
    features: [
      "Everything in Growth",
      "WhatsApp + SMS + Email",
      "Churn risk prediction (M4)",
      "Offer value optimizer (M5)",
      "10,000 tracked visitors/mo",
      "Dedicated onboarding call",
    ],
    isFeatured: false,
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function getButtonIntent(
  planId: "free" | "growth" | "scale",
  currentPlan: CurrentSub["plan"]
): ButtonIntent {
  if (planId === "free") {
    return currentPlan === "free" || currentPlan === undefined
      ? "current"
      : "downgrade";
  }
  if (planId === currentPlan) return "current";

  const order: Record<string, number> = { free: 0, growth: 1, scale: 2, enterprise: 3 };
  return order[planId] > order[currentPlan ?? "free"] ? "upgrade" : "downgrade";
}

function planLabel(currentPlan: CurrentSub["plan"]): string {
  const map: Record<string, string> = {
    free: "Free Trial",
    growth: "Growth",
    scale: "Scale",
    enterprise: "Enterprise",
  };
  return map[currentPlan] ?? "Free Trial";
}

function statusLabel(sub: CurrentSub): string {
  if (sub.status === "trialing") return "Trial active";
  if (sub.status === "active") return "Active";
  if (sub.status === "past_due") return "Payment overdue";
  if (sub.status === "cancelled") return "Cancelled";
  return sub.status;
}

function periodEnd(sub: CurrentSub): string | null {
  const d = sub.current_period_end || sub.trial_ends_at;
  if (!d) return null;
  return new Date(d).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

const Subscription: FC = () => {
  const [sub, setSub] = useState<CurrentSub | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [confirmPlan, setConfirmPlan] = useState<typeof PLANS[0] | null>(null);
  const [billing, setBilling] = useState<"monthly" | "annual">("monthly");

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchSub = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ data: CurrentSub }>(
        "/subscriptions/current",
        undefined,
        { skipAuthRedirect: true }
      );
      // api.get returns the parsed JSON directly
      const data = (res as any)?.data ?? (res as any);
      setSub(data?.data ?? data ?? null);
    } catch {
      setSub(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSub(); }, [fetchSub]);

  const currentPlan: CurrentSub["plan"] = sub?.plan ?? "free";

  const handleAction = async (plan: typeof PLANS[0], intent: ButtonIntent) => {
    if (intent === "current") return;

    // Free plan downgrade = cancel subscription
    if (intent === "downgrade" && plan.id === "free") {
      setConfirmPlan(plan);
      return;
    }

    // Upgrade or plan switch → go to Paystack
    if (intent === "upgrade" || (intent === "downgrade" && plan.id !== "free")) {
      setActionLoading(plan.id);
      try {
        const token = (() => {
          try {
            const raw = localStorage.getItem("rv-auth");
            return raw ? JSON.parse(raw)?.state?.csrfToken : null;
          } catch { return null; }
        })();

        const API =
          (window as any).REVLUMA_CONFIG?.API_BASE_URL ||
          "https://revluma-backend.onrender.com/api/v1";

        const res = await fetch(`${API}/subscriptions/initialize`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            plan: plan.id,
            billing_cycle: billing,
            currency: "NGN",
          }),
        });
        const data = await res.json();

        if (data.success && data.data?.authorization_url) {
          sessionStorage.setItem("paystack_reference", data.data.reference);
          window.location.href = data.data.authorization_url;
        } else {
          showToast(data.error || "Could not initialize payment. Try again.", "error");
        }
      } catch {
        showToast("Network error. Please try again.", "error");
      } finally {
        setActionLoading(null);
      }
    }
  };

  const handleCancelConfirm = async () => {
    setActionLoading("cancel");
    try {
      const token = (() => {
        try {
          const raw = localStorage.getItem("rv-auth");
          return raw ? JSON.parse(raw)?.state?.csrfToken : null;
        } catch { return null; }
      })();
      const API =
        (window as any).REVLUMA_CONFIG?.API_BASE_URL ||
        "https://revluma-backend.onrender.com/api/v1";

      const res = await fetch(`${API}/subscriptions/cancel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();
      if (data.success) {
        showToast("Subscription cancelled. Access continues until your billing period ends.");
        fetchSub();
      } else {
        showToast(data.error || "Cancellation failed.", "error");
      }
    } catch {
      showToast("Network error. Please try again.", "error");
    } finally {
      setActionLoading(null);
      setConfirmPlan(null);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        fontFamily: "'Satoshi', -apple-system, sans-serif",
        minHeight: "100%",
        padding: "0",
      }}
    >
      {/* ── Toast ── */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            style={{
              position: "fixed",
              top: 24,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 9999,
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 20px",
              borderRadius: 12,
              fontSize: 13,
              fontWeight: 600,
              boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
              background: toast.type === "success" ? "#ecfdf5" : "#fef2f2",
              border: `1px solid ${toast.type === "success" ? "#a7f3d0" : "#fecaca"}`,
              color: toast.type === "success" ? "#065f46" : "#991b1b",
              minWidth: 280,
            }}
          >
            {toast.type === "success"
              ? <CheckCircle2 size={16} color="#059669" />
              : <AlertCircle size={16} color="#dc2626" />}
            <span>{toast.msg}</span>
            <button
              onClick={() => setToast(null)}
              style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", padding: 2 }}
            >
              <X size={14} color="#9ca3af" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Header ── */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: "rgba(88,101,242,0.1)", border: "1px solid rgba(88,101,242,0.2)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <CreditCard size={20} color="#5865f2" />
          </div>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1a1a2e", margin: 0 }}>
              Subscription &amp; Plans
            </h1>
            <p style={{ fontSize: 13, color: "#7880a8", margin: 0 }}>
              Manage your plan and billing
            </p>
          </div>
        </div>
      </div>

      {/* ── Current plan status bar ── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        style={{
          background: "white",
          borderRadius: 16,
          border: "1px solid #e0e3f0",
          padding: "20px 24px",
          marginBottom: 32,
          boxShadow: "0 2px 12px rgba(88,101,242,0.07)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        {loading ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#7880a8", fontSize: 13 }}>
            <Loader2 size={16} className="animate-spin" color="#5865f2" />
            Loading subscription...
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 6,
                background: sub?.status === "active" || sub?.status === "trialing"
                  ? "rgba(5,150,105,0.08)" : "rgba(239,68,68,0.08)",
                border: `1px solid ${sub?.status === "active" || sub?.status === "trialing"
                  ? "rgba(5,150,105,0.2)" : "rgba(239,68,68,0.2)"}`,
                borderRadius: 999, padding: "4px 12px",
              }}>
                <div style={{
                  width: 7, height: 7, borderRadius: "50%",
                  background: sub?.status === "active" || sub?.status === "trialing"
                    ? "#059669" : "#ef4444",
                }} />
                <span style={{
                  fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase",
                  color: sub?.status === "active" || sub?.status === "trialing" ? "#059669" : "#ef4444",
                }}>
                  {sub ? statusLabel(sub) : "No subscription"}
                </span>
              </div>

              <div>
                <span style={{ fontSize: 15, fontWeight: 700, color: "#1a1a2e" }}>
                  Current plan: {planLabel(currentPlan)}
                </span>
                {sub && periodEnd(sub) && (
                  <span style={{ fontSize: 12, color: "#7880a8", marginLeft: 10 }}>
                    <Calendar size={11} style={{ display: "inline", marginRight: 3, verticalAlign: "middle" }} />
                    {sub.status === "trialing" ? "Trial ends" : "Renews"} {periodEnd(sub)}
                  </span>
                )}
              </div>
            </div>

            {sub?.status === "active" && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#7880a8" }}>
                <ShieldCheck size={14} color="#5865f2" />
                Secured by Paystack
              </div>
            )}
          </>
        )}
      </motion.div>

      {/* ── Billing toggle ── */}
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 0, marginBottom: 36 }}>
        {(["monthly", "annual"] as const).map((b, i) => (
          <button
            key={b}
            onClick={() => setBilling(b)}
            style={{
              padding: "8px 24px", fontSize: 13, fontWeight: 600,
              border: "1.5px solid #c8cce8",
              borderRight: i === 0 ? "none" : "1.5px solid #c8cce8",
              borderRadius: i === 0 ? "999px 0 0 999px" : "0 999px 999px 0",
              background: billing === b ? "#5865f2" : "transparent",
              color: billing === b ? "white" : "#7880a8",
              cursor: "pointer", transition: "all 0.2s",
              fontFamily: "inherit",
            }}
          >
            {b === "monthly" ? "Monthly" : "Yearly"}
          </button>
        ))}
        {billing === "annual" && (
          <span style={{
            marginLeft: 10,
            background: "rgba(74,222,128,0.12)", border: "1px solid rgba(74,222,128,0.25)",
            color: "#16a34a", fontSize: 11, fontWeight: 700,
            padding: "3px 10px", borderRadius: 999,
            letterSpacing: "0.04em", textTransform: "uppercase",
          }}>
            Save 20%
          </span>
        )}
      </div>

      {/* ── Plan cards ── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1.08fr 1fr",
        gap: 20,
        alignItems: "center",
      }}
        className="subscription-cards"
      >
        {PLANS.map((plan) => {
          const intent = getButtonIntent(plan.id as any, currentPlan);
          const isCurrent = intent === "current";
          const isLoading = actionLoading === plan.id;

          const displayPrice = billing === "annual" && plan.id === "growth"
            ? "$23" : billing === "annual" && plan.id === "scale"
            ? "$40" : plan.price;

          return (
            <motion.div
              key={plan.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: PLANS.indexOf(plan) * 0.07 }}
              style={{
                background: plan.isFeatured
                  ? "linear-gradient(160deg, #6b7df5 0%, #5865f2 45%, #4a55e8 100%)"
                  : "white",
                borderRadius: 20,
                padding: "32px 28px 28px",
                position: "relative",
                border: plan.isFeatured ? "1px solid #3a4fa0" : "1px solid #e0e3f0",
                transform: plan.isFeatured ? "translateY(-14px)" : "none",
                boxShadow: plan.isFeatured
                  ? "0 20px 60px rgba(88,101,242,0.38), 0 4px 16px rgba(88,101,242,0.2)"
                  : "0 4px 24px rgba(88,101,242,0.07)",
              }}
            >
              {/* Most popular badge */}
              {plan.badge && (
                <div style={{
                  position: "absolute", top: -13, left: "50%", transform: "translateX(-50%)",
                  background: "white", color: "#5865f2",
                  fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em",
                  padding: "4px 14px", borderRadius: 999, whiteSpace: "nowrap",
                  boxShadow: "0 2px 8px rgba(88,101,242,0.2)",
                }}>
                  {plan.badge}
                </div>
              )}

              {/* Current plan tag */}
              {isCurrent && (
                <div style={{
                  position: "absolute", top: 14, right: 14,
                  background: plan.isFeatured ? "rgba(255,255,255,0.2)" : "rgba(88,101,242,0.1)",
                  border: `1px solid ${plan.isFeatured ? "rgba(255,255,255,0.35)" : "rgba(88,101,242,0.25)"}`,
                  color: plan.isFeatured ? "white" : "#5865f2",
                  fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em",
                  padding: "3px 10px", borderRadius: 999,
                }}>
                  Current Plan
                </div>
              )}

              {/* Price */}
              <div style={{
                fontSize: 40, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1,
                color: plan.isFeatured ? "white" : "#1a1a2e",
              }}>
                {displayPrice}{" "}
                <span style={{
                  fontSize: 14, fontWeight: 500,
                  color: plan.isFeatured ? "rgba(255,255,255,0.6)" : "#9098c0",
                }}>
                  {plan.priceSuffix}
                </span>
              </div>

              {/* Annual note */}
              <div style={{ fontSize: 11, color: plan.isFeatured ? "rgba(255,255,255,0.45)" : "#b0b8d0", marginTop: 4, minHeight: 16 }}>
                {billing === "annual" && plan.id === "growth" ? "Billed $276/year (save $72)" :
                 billing === "annual" && plan.id === "scale"  ? "Billed $480/year (save $120)" : "\u00a0"}
              </div>

              {/* Name */}
              <div style={{
                fontSize: 20, fontWeight: 700, marginTop: 14, marginBottom: 6,
                color: plan.isFeatured ? "white" : "#1a1a2e",
              }}>
                {plan.name}
              </div>

              {/* Desc */}
              <p style={{
                fontSize: 13, lineHeight: 1.55, marginBottom: 18,
                color: plan.isFeatured ? "rgba(255,255,255,0.6)" : "#7880a8",
              }}>
                {plan.subtitle}
              </p>

              {/* Divider */}
              <div style={{
                height: 1, marginBottom: 18,
                background: plan.isFeatured ? "rgba(255,255,255,0.15)" : "#f0f1f8",
              }} />

              {/* Features */}
              <ul style={{ listStyle: "none", padding: 0, margin: "0 0 24px", display: "flex", flexDirection: "column", gap: 10 }}>
                {plan.features.map((f, i) => (
                  <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13.5 }}>
                    <div style={{
                      width: 18, height: 18, borderRadius: "50%", flexShrink: 0, marginTop: 1,
                      display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700,
                      background: plan.isFeatured ? "rgba(255,255,255,0.18)" : "rgba(88,101,242,0.1)",
                      color: plan.isFeatured ? "white" : "#5865f2",
                      border: `1px solid ${plan.isFeatured ? "rgba(255,255,255,0.25)" : "rgba(88,101,242,0.2)"}`,
                    }}>
                      ✓
                    </div>
                    <span style={{ color: plan.isFeatured ? "rgba(255,255,255,0.88)" : "#3a3f6e" }}>
                      {f}
                    </span>
                  </li>
                ))}
              </ul>

              {/* CTA Button */}
              <button
                onClick={() => !isCurrent && !isLoading && handleAction(plan, intent)}
                disabled={isCurrent || !!actionLoading}
                style={{
                  width: "100%", padding: "13px", borderRadius: 999,
                  fontSize: 14, fontWeight: 700, fontFamily: "inherit",
                  cursor: isCurrent || actionLoading ? "not-allowed" : "pointer",
                  border: "none", transition: "all 0.2s",
                  opacity: isCurrent ? 0.65 : 1,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  ...(plan.isFeatured
                    ? { background: "white", color: "#5865f2" }
                    : isCurrent
                    ? { background: "#f0f1f8", color: "#9098c0" }
                    : intent === "downgrade"
                    ? { background: "transparent", color: "#7880a8", border: "1.5px solid #c8cce8" }
                    : { background: "transparent", color: "#5865f2", border: "1.5px solid #c8cce8" }
                  ),
                }}
              >
                {isLoading ? (
                  <><Loader2 size={15} className="animate-spin" /> Processing...</>
                ) : isCurrent ? (
                  "Current Plan"
                ) : intent === "upgrade" ? (
                  <><TrendingUp size={15} /> Upgrade to {plan.name}</>
                ) : intent === "downgrade" && plan.id === "free" ? (
                  <><TrendingDown size={15} /> Cancel to Free</>
                ) : intent === "downgrade" ? (
                  <><TrendingDown size={15} /> Downgrade to {plan.name}</>
                ) : (
                  "Get started"
                )}
              </button>

              {!isCurrent && (plan.id === "growth" || plan.id === "scale") && (
                <p style={{
                  textAlign: "center", fontSize: 11, marginTop: 10,
                  color: plan.isFeatured ? "rgba(255,255,255,0.4)" : "#b0b8d0",
                }}>
                  No charge for 7 days · Cancel anytime
                </p>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* ── Trust line ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
        marginTop: 36, fontSize: 12, color: "#9098c0",
      }}>
        <ShieldCheck size={14} color="#5865f2" />
        <span>Secured by Paystack · Card saved but not charged until day 8 · Cancel before day 8 to pay nothing</span>
      </div>

      {/* ── Cancel confirmation modal ── */}
      <AnimatePresence>
        {confirmPlan && (
          <div style={{
            position: "fixed", inset: 0, zIndex: 999,
            background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
          }}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              style={{
                background: "white", borderRadius: 20,
                padding: 32, maxWidth: 420, width: "100%",
                boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
                border: "1px solid #e0e3f0",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                <h3 style={{ fontSize: 17, fontWeight: 700, color: "#1a1a2e", margin: 0 }}>
                  Cancel subscription?
                </h3>
                <button
                  onClick={() => setConfirmPlan(null)}
                  style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}
                >
                  <X size={18} color="#9098c0" />
                </button>
              </div>

              <p style={{ fontSize: 14, color: "#7880a8", lineHeight: 1.6, marginBottom: 20 }}>
                You'll keep access to your current plan until the end of your billing period.
                After that, your account switches to the free tier.
              </p>

              <div style={{
                background: "#fef9f0", border: "1px solid #fde68a", borderRadius: 10,
                padding: "12px 16px", fontSize: 13, color: "#92400e", marginBottom: 24,
              }}>
                ⚠ Your recovery automations, WhatsApp flows, and advanced AI features will stop at the end of your billing period.
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <button
                  onClick={() => setConfirmPlan(null)}
                  style={{
                    flex: 1, padding: "12px", borderRadius: 999,
                    fontSize: 14, fontWeight: 600, fontFamily: "inherit",
                    background: "#f4f5ff", color: "#5865f2", border: "1.5px solid #c8cce8", cursor: "pointer",
                  }}
                >
                  Keep plan
                </button>
                <button
                  onClick={handleCancelConfirm}
                  disabled={actionLoading === "cancel"}
                  style={{
                    flex: 1, padding: "12px", borderRadius: 999,
                    fontSize: 14, fontWeight: 600, fontFamily: "inherit",
                    background: "#ef4444", color: "white", border: "none", cursor: "pointer",
                    opacity: actionLoading === "cancel" ? 0.7 : 1,
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  }}
                >
                  {actionLoading === "cancel"
                    ? <><Loader2 size={14} className="animate-spin" /> Cancelling...</>
                    : "Yes, cancel"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style>{`
        @media (max-width: 720px) {
          .subscription-cards {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
};

export default Subscription;