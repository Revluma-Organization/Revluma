/**
 * Morning Briefing Card
 * Displayed at the top of the Overview dashboard on first daily load.
 * Shows the 6-section Rev Intelligence morning briefing.
 */

import { useState, useEffect, FC } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  TrendingUp, TrendingDown, AlertTriangle, Zap,
  CheckCircle, ChevronDown, ChevronUp, Sunrise,
  Clock, X,
} from "lucide-react";
import { api } from "@/lib/api";
import { useThemeStore } from "@/store";

// ── Types ─────────────────────────────────────────────────────────────────────

interface YesterdayMetric {
  metric:    string;
  value:     string;
  delta:     number;
  direction: "up" | "down" | "stable";
}

interface Priority {
  description:      string;
  estimated_impact: string | null;
  action_label:     string | null;
}

interface Concern {
  severity:     "high" | "medium" | "low";
  description:  string;
  action_label: string | null;
}

interface Opportunity {
  description:     string;
  estimated_value: string | null;
  action_label:    string | null;
}

interface Briefing {
  id:                   string;
  merchant_name:        string;
  generated_at:         string;
  greeting:             string;
  yesterday_in_numbers: YesterdayMetric[];
  todays_priority:      Priority;
  active_concerns:      Concern[];
  opportunities:        Opportunity[];
  overnight_log:        string[];
  has_concerns:         boolean;
  fallback_used:        boolean;
}

// ── Sub-components ────────────────────────────────────────────────────────────

const MetricPill: FC<{ metric: YesterdayMetric; isDark: boolean }> = ({ metric, isDark }) => {
  const up    = metric.direction === "up";
  const down  = metric.direction === "down";
  const color = up ? "#059669" : down ? "#dc2626" : "#64748b";
  const bg    = up ? "rgba(5,150,105,0.08)" : down ? "rgba(220,38,38,0.08)" : "rgba(100,116,139,0.08)";

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "8px 14px", borderRadius: 10,
      background: bg, border: `0.5px solid ${color}25`,
    }}>
      {up   && <TrendingUp  size={13} color={color} />}
      {down && <TrendingDown size={13} color={color} />}
      <div>
        <p style={{ fontSize: "0.7rem", color: "#64748b", margin: 0, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
          {metric.metric}
        </p>
        <p style={{ fontSize: "0.9rem", fontWeight: 700, color: isDark ? "#f1f5f9" : "#0f172a", margin: "2px 0 0" }}>
          {metric.value}
          {metric.delta !== 0 && (
            <span style={{ fontSize: "0.75rem", fontWeight: 500, color, marginLeft: 5 }}>
              {metric.delta > 0 ? "+" : ""}{metric.delta.toFixed(1)}%
            </span>
          )}
        </p>
      </div>
    </div>
  );
};

const SeverityDot: FC<{ severity: string }> = ({ severity }) => {
  const color = severity === "high" ? "#dc2626" : severity === "medium" ? "#d97706" : "#64748b";
  return <div style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0, marginTop: 5 }} />;
};

// ── Main component ────────────────────────────────────────────────────────────

export default function MorningBriefing() {
  const theme  = useThemeStore(s => s.theme);
  const isDark = theme === "dark";

  const [briefing,   setBriefing]   = useState<Briefing | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(false);
  const [dismissed,  setDismissed]  = useState(false);
  const [expanded,   setExpanded]   = useState(false);

  const t1  = isDark ? "#f1f5f9" : "#0f172a";
  const t2  = isDark ? "#94a3b8" : "#64748b";
  const bg  = isDark ? "#111"    : "#ffffff";
  const bdr = isDark ? "#1e1e2e" : "#e8eaf0";

  useEffect(() => {
    // Only load once per day — check sessionStorage
    const key = `rev_briefing_${new Date().toISOString().slice(0, 10)}`;
    const cached = sessionStorage.getItem(key);
    if (cached) {
      try {
        setBriefing(JSON.parse(cached));
        setLoading(false);
        return;
      } catch { /* ignore */ }
    }

    (api as any).get("/rev/briefing")
      .then((res: any) => {
        const b = res?.data?.data || res?.data;
        if (b) {
          setBriefing(b);
          sessionStorage.setItem(key, JSON.stringify(b));
        } else {
          setError(true);
        }
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  // Dismissed for this session
  if (dismissed) return null;

  // Loading skeleton
  if (loading) return (
    <div style={{
      background: bg, border: `0.5px solid ${bdr}`, borderRadius: 16,
      padding: "20px 24px", marginBottom: 24,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <Sunrise size={16} color="#5865f2" />
        <div style={{ height: 14, width: 160, background: bdr, borderRadius: 6 }} />
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {[120, 100, 140, 110].map((w, i) => (
          <div key={i} style={{ height: 56, width: w, background: bdr, borderRadius: 10 }} />
        ))}
      </div>
    </div>
  );

  // Error / unavailable — show nothing, don't break the page
  if (error || !briefing) return null;

  const generatedAt = new Date(briefing.generated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        background: bg,
        border: `0.5px solid ${bdr}`,
        borderRadius: 16,
        marginBottom: 24,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div style={{
        padding: "16px 20px",
        borderBottom: expanded ? `0.5px solid ${bdr}` : "none",
        display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12,
      }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flex: 1 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            background: "rgba(88,101,242,0.1)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Sunrise size={18} color="#5865f2" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.08em", color: "#5865f2" }}>
                MORNING BRIEFING
              </span>
              <span style={{ fontSize: "0.68rem", color: t2, display: "flex", alignItems: "center", gap: 3 }}>
                <Clock size={10} />{generatedAt}
              </span>
              {briefing.fallback_used && (
                <span style={{ fontSize: "0.66rem", color: "#d97706", background: "rgba(217,119,6,0.1)", padding: "1px 6px", borderRadius: 4 }}>
                  limited data
                </span>
              )}
            </div>
            <p style={{ fontSize: "0.92rem", fontWeight: 600, color: t1, margin: 0, lineHeight: 1.45 }}>
              {briefing.greeting}
            </p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button
            onClick={() => setExpanded(v => !v)}
            style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "5px 10px", borderRadius: 8, fontSize: "0.75rem",
              fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              background: isDark ? "#1f1f1f" : "#f3f4f6",
              color: t2, border: "none",
            }}
          >
            {expanded ? <><ChevronUp size={13} />Less</> : <><ChevronDown size={13} />Details</>}
          </button>
          <button
            onClick={() => setDismissed(true)}
            style={{
              width: 28, height: 28, borderRadius: 8, border: "none",
              background: "transparent", cursor: "pointer", color: t2,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Yesterday metrics — always visible */}
      {briefing.yesterday_in_numbers.length > 0 && (
        <div style={{ padding: "14px 20px", borderBottom: `0.5px solid ${bdr}` }}>
          <p style={{ fontSize: "0.68rem", fontWeight: 700, color: t2, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 10px" }}>
            Yesterday
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {briefing.yesterday_in_numbers.map((m, i) => (
              <MetricPill key={i} metric={m} isDark={isDark} />
            ))}
          </div>
        </div>
      )}

      {/* Today's priority — always visible */}
      {briefing.todays_priority?.description && (
        <div style={{
          padding: "14px 20px",
          borderBottom: (briefing.has_concerns || expanded) ? `0.5px solid ${bdr}` : "none",
          background: "rgba(88,101,242,0.03)",
        }}>
          <p style={{ fontSize: "0.68rem", fontWeight: 700, color: "#5865f2", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 8px" }}>
            Today's Priority
          </p>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: "0.88rem", color: t1, margin: 0, lineHeight: 1.55 }}>
                {briefing.todays_priority.description}
              </p>
              {briefing.todays_priority.estimated_impact && (
                <p style={{ fontSize: "0.75rem", color: "#059669", margin: "4px 0 0", fontWeight: 600 }}>
                  {briefing.todays_priority.estimated_impact}
                </p>
              )}
            </div>
            {briefing.todays_priority.action_label && (
              <button style={{
                padding: "7px 14px", borderRadius: 8, fontSize: "0.8rem",
                fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                background: "#5865f2", color: "#fff", border: "none", flexShrink: 0,
                display: "flex", alignItems: "center", gap: 5,
              }}>
                <Zap size={12} />{briefing.todays_priority.action_label}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Active concerns — visible if has_concerns */}
      <AnimatePresence>
        {briefing.has_concerns && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            style={{ overflow: "hidden", borderBottom: expanded ? `0.5px solid ${bdr}` : "none" }}
          >
            <div style={{ padding: "14px 20px" }}>
              <p style={{ fontSize: "0.68rem", fontWeight: 700, color: "#d97706", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 10px" }}>
                Active Concerns
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {briefing.active_concerns.map((c, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                    <SeverityDot severity={c.severity} />
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: "0.84rem", color: t1, margin: 0, lineHeight: 1.5 }}>{c.description}</p>
                    </div>
                    {c.action_label && (
                      <button style={{
                        padding: "4px 10px", borderRadius: 6, fontSize: "0.73rem",
                        fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                        background: "rgba(220,38,38,0.08)", color: "#dc2626",
                        border: "0.5px solid rgba(220,38,38,0.2)", flexShrink: 0,
                      }}>
                        {c.action_label}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Expanded sections: Opportunities + Overnight log */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            style={{ overflow: "hidden" }}
          >
            {/* Opportunities */}
            {briefing.opportunities.length > 0 && (
              <div style={{ padding: "14px 20px", borderBottom: `0.5px solid ${bdr}` }}>
                <p style={{ fontSize: "0.68rem", fontWeight: 700, color: "#059669", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 10px" }}>
                  Opportunities
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {briefing.opportunities.map((o, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <CheckCircle size={13} color="#059669" style={{ flexShrink: 0 }} />
                      <p style={{ fontSize: "0.84rem", color: t1, margin: 0, flex: 1 }}>{o.description}</p>
                      {o.estimated_value && (
                        <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#059669", flexShrink: 0 }}>
                          {o.estimated_value}
                        </span>
                      )}
                      {o.action_label && (
                        <button style={{
                          padding: "4px 10px", borderRadius: 6, fontSize: "0.73rem",
                          fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                          background: "rgba(5,150,105,0.08)", color: "#059669",
                          border: "0.5px solid rgba(5,150,105,0.2)", flexShrink: 0,
                        }}>
                          {o.action_label}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Overnight log */}
            {briefing.overnight_log.length > 0 && (
              <div style={{ padding: "14px 20px" }}>
                <p style={{ fontSize: "0.68rem", fontWeight: 700, color: t2, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 10px" }}>
                  What Rev did overnight
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {briefing.overnight_log.map((log, i) => (
                    <p key={i} style={{ fontSize: "0.82rem", color: t2, margin: 0, lineHeight: 1.5 }}>
                      · {log}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
