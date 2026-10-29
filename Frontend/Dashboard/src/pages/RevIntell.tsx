/**
 * Rev Intell — Production Frontend
 * Phase 4 complete: real API, URL-based conversation routing, adaptive rendering
 *
 * Architecture:
 *   URL is the source of truth for active conversation.
 *   /dashboard/rev-intell           → welcome screen, no conversation
 *   /dashboard/rev-intell/:id       → load and display that conversation
 *
 *   Refresh preserves conversation.
 *   Browser back/forward works.
 *   Direct URL access works.
 *   Tenant isolation: conversations verified server-side.
 */

import {
  useState, useRef, useEffect, useCallback, FC,
  useMemo,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { createPortal } from "react-dom";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import {
  Send, Plus, Menu, X, Copy, ThumbsUp, ThumbsDown,
  RotateCcw, TrendingUp, ShoppingCart, Users, BarChart2,
  Zap, RefreshCw, Mic, Phone, MoreHorizontal, Pencil,
  Trash2, FileText, ImageIcon, AlertCircle, RefreshCcw,
} from "lucide-react";
import revIntellLogo from "@/assets/images/rev-intell-logo.png";
import { useAuth } from "@/context/AuthContext";
import { useThemeStore } from "@/store";
import api, { ApiError } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

type ResponseType =
  | "chat" | "conversational" | "analysis" | "capability"
  | "clarification" | "knowledge" | "action_plan" | "error";

interface RevResponse {
  response_type:   ResponseType;
  text?:           string;
  situation?:      string;
  insight?:        string;
  implication?:    string;
  recommendation?: string;
  confidence?:     { score: number; basis: string };
  actions?:        Array<{ label: string; tool: string | null; params: Record<string, unknown> }>;
  agents_used?:    string[];
  warnings?:       string[];
}

interface Message {
  id:          string;
  role:        "user" | "rev";
  content:     string | RevResponse;
  timestamp:   Date;
  isStreaming?: boolean;
  hasError?:   boolean;
  errorCode?:  string;
}

interface Conversation {
  id:               string;
  title:            string;
  message_count:    number;
  last_activity_at: string;
}

// ── Error message mapper ──────────────────────────────────────────────────────

function cleanError(code?: string, _raw?: string): string {
  switch (code) {
    case "INTELLIGENCE_TIMEOUT":      return "Rev is taking longer than usual. Try again.";
    case "INTELLIGENCE_UNAVAILABLE":  return "Rev is momentarily unavailable. Try again in a moment.";
    case "INTELLIGENCE_INVALID_RESPONSE": return "Rev had an issue preparing a response. Try again.";
    case "INTELLIGENCE_AUTH_FAILED":  return "Rev intelligence is temporarily offline.";
    case "INTELLIGENCE_NOT_CONFIGURED": return "Rev Intelligence is being set up. Check back shortly.";
    case "RATE_LIMITED":              return "You're sending messages too quickly. Wait a moment.";
    case "VALIDATION_ERROR":          return "Your message couldn't be sent. Please check and try again.";
    default:                          return "Rev couldn't process this right now. Try again in a moment.";
  }
}

// ── Starters ──────────────────────────────────────────────────────────────────

const STARTERS = [
  { icon: TrendingUp,   label: "Revenue",      sub: "What happened to my revenue this week?",       color: "#5865f2" },
  { icon: ShoppingCart, label: "Cart Recovery", sub: "Which carts should I prioritise recovering?",  color: "#059669" },
  { icon: Users,        label: "Churn Risk",   sub: "Which customers are about to leave?",          color: "#d97706" },
  { icon: BarChart2,    label: "Briefing",     sub: "What do I need to know today?",                color: "#7c3aed" },
  { icon: Zap,          label: "Trends",       sub: "What's moving in my category right now?",      color: "#db2777" },
  { icon: RefreshCw,    label: "Win-back",     sub: "Draft a sequence for inactive customers.",     color: "#0891b2" },
];

// ── Orb components ────────────────────────────────────────────────────────────

function OrbHero({ size = 90 }: { size?: number }) {
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <motion.img src={revIntellLogo} alt="Rev"
        style={{ width: "100%", height: "100%", objectFit: "contain", position: "relative", zIndex: 2,
          filter: "drop-shadow(0 0 10px rgba(100,160,255,0.9)) drop-shadow(0 0 20px rgba(88,101,242,0.6))" }}
        animate={{ scale: [1, 1.06, 1] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }} />
      <motion.div style={{ position: "absolute", inset: -size * 0.3, borderRadius: "50%",
        border: "1.5px solid rgba(100,160,255,0.5)", zIndex: 1 }}
        animate={{ rotate: 360 }} transition={{ duration: 3, repeat: Infinity, ease: "linear" }}>
        <div style={{ position: "absolute", top: "50%", right: -3, width: 6, height: 6, borderRadius: "50%",
          background: "#7eb8ff", transform: "translateY(-50%)", boxShadow: "0 0 8px rgba(100,160,255,0.9)" }} />
      </motion.div>
    </div>
  );
}

function OrbAvatar() {
  return (
    <div style={{ position: "relative", width: 32, height: 32, flexShrink: 0, marginTop: 2 }}>
      <div style={{ position: "absolute", inset: -4, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(88,101,242,0.15) 0%, transparent 70%)" }} />
      <motion.div style={{ position: "absolute", inset: -6, borderRadius: "50%",
        border: "1px solid rgba(100,160,255,0.35)" }}
        animate={{ rotate: 360 }} transition={{ duration: 4, repeat: Infinity, ease: "linear" }}>
        <div style={{ position: "absolute", top: "50%", right: -2.5, width: 4, height: 4, borderRadius: "50%",
          background: "#7eb8ff", transform: "translateY(-50%)", boxShadow: "0 0 5px rgba(100,160,255,0.9)" }} />
      </motion.div>
      <motion.img src={revIntellLogo} alt="Rev"
        style={{ width: 32, height: 32, objectFit: "contain", position: "relative", zIndex: 2,
          filter: "drop-shadow(0 0 6px rgba(100,160,255,0.8))" }}
        animate={{ scale: [1, 1.06, 1] }}
        transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }} />
    </div>
  );
}

// ── Loading shimmer ───────────────────────────────────────────────────────────

function LoadingBar({ isDark }: { isDark: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4, paddingBottom: 4 }}>
      {[0.85, 0.65, 0.45].map((w, i) => (
        <motion.div key={i}
          style={{ height: 10, borderRadius: 999,
            background: isDark ? "#1f2937" : "#e5e7eb",
            width: `${w * 100}%`, overflow: "hidden", position: "relative" }}>
          <motion.div
            style={{ position: "absolute", inset: 0, borderRadius: 999,
              background: `linear-gradient(90deg, transparent 0%, ${isDark ? "rgba(88,101,242,0.5)" : "rgba(88,101,242,0.3)"} 50%, transparent 100%)` }}
            animate={{ x: ["-100%", "200%"] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut", delay: i * 0.18 }} />
        </motion.div>
      ))}
    </div>
  );
}

// ── ResponseCard — adaptive to response type ──────────────────────────────────

function renderInline(text: string) {
  // Only render safe web URLs from untrusted model text.
  const safeUrl = (raw: string) => { try { const u = new URL(raw); return ["https:", "http:"].includes(u.protocol) ? u.href : null; } catch { return null; } };\n  // Handle markdown image: ![alt](url)
  const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  if (imgRegex.test(text)) {
    const parts: React.ReactNode[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    const re = /!\[([^\]]*)\]\(([^)]+)\)/g;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) parts.push(<span key={last}>{text.slice(last, m.index)}</span>);
      parts.push(
        <img key={m.index} src={safeUrl(m[2]) ?? undefined} alt={m[1]}
          style={{ maxWidth: "100%", borderRadius: 8, margin: "8px 0", display: "block" }}
          onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      );
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push(<span key={last}>{text.slice(last)}</span>);
    return <>{parts}</>;
  }
  // Handle markdown link: [text](url)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  if (linkRegex.test(text)) {
    const parts: React.ReactNode[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    const re = /\[([^\]]+)\]\(([^)]+)\)/g;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) parts.push(<span key={last}>{renderBasicInline(text.slice(last, m.index))}</span>);
      parts.push(
        <a key={m.index} href={safeUrl(m[2]) ?? undefined} target="_blank" rel="noopener noreferrer"
          style={{ color: "#5865f2", textDecoration: "underline", textDecorationColor: "rgba(88,101,242,0.4)" }}>
          {m[1]}
        </a>
      );
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push(<span key={last}>{renderBasicInline(text.slice(last))}</span>);
    return <>{parts}</>;
  }
  return renderBasicInline(text);
}

function renderBasicInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return <>{parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**"))
      return <strong key={i} style={{ fontWeight: 650 }}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`"))
      return <code key={i} style={{ fontFamily: "ui-monospace, monospace",
        background: "rgba(88,101,242,0.12)", padding: "1px 5px",
        borderRadius: 4, fontSize: "0.86em" }}>{p.slice(1, -1)}</code>;
    return <span key={i}>{p}</span>;
  })}</>;
}

/** Renders rich markdown: headings, bold, bullets, numbers, blockquotes, paragraphs. */
function RichText({ text, t1, isDark }: { text: string; t1: string; isDark?: boolean }) {
  const blocks = text.split(/\n{2,}/).filter(b => b.trim());
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {blocks.map((block, bi) => {
        const lines = block.split("\n").filter(l => l.trim());
        if (!lines.length) return null;

        // ## Heading
        if (lines[0].startsWith("## ")) {
          const heading = lines[0].replace(/^##\s+/, "");
          return (
            <div key={bi}>
              <p style={{ fontSize: "clamp(1.25rem, 1.8vw, 1.5rem)", lineHeight: 1.3, fontWeight: 700, color: t1, margin: "12px 0 10px" }}>
                {renderInline(heading)}
              </p>
              {lines.slice(1).length > 0 && (
                <p style={{ fontSize: "1rem", lineHeight: 1.7, color: t1, margin: 0 }}>
                  {lines.slice(1).map((l, li) => (
                    <span key={li}>{renderInline(l)}{li < lines.slice(1).length - 1 ? <br /> : null}</span>
                  ))}
                </p>
              )}
            </div>
          );
        }

        // # Heading (larger)
        if (lines[0].startsWith("# ")) {
          const heading = lines[0].replace(/^#\s+/, "");
          return (
            <p key={bi} style={{ fontSize: "clamp(1.5rem, 2.2vw, 2.25rem)", lineHeight: 1.25, fontWeight: 750, color: t1, margin: "16px 0 8px", letterSpacing: "-0.01em" }}>
              {renderInline(heading)}
            </p>
          );
        }

        // > Blockquote / callout
        if (lines.every(l => l.startsWith("> "))) {
          return (
            <div key={bi} style={{
              borderLeft: "3px solid #5865f2",
              paddingLeft: 12,
              margin: "2px 0",
              background: isDark ? "rgba(88,101,242,0.08)" : "rgba(88,101,242,0.06)",
              borderRadius: "0 8px 8px 0",
              padding: "8px 12px",
            }}>
              {lines.map((l, li) => (
                <p key={li} style={{ fontSize: "0.9rem", lineHeight: 1.65, color: t1, margin: li > 0 ? "4px 0 0" : 0, fontStyle: "italic" }}>
                  {renderInline(l.replace(/^>\s+/, ""))}
                </p>
              ))}
            </div>
          );
        }

        // Bullet list
        const isBullet = lines.every(l => /^\s*[-*•]\s+/.test(l));
        if (isBullet) {
          return (
            <ul key={bi} style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 5 }}>
              {lines.map((l, li) => (
                <li key={li} style={{ fontSize: "1rem", lineHeight: 1.7, color: t1 }}>
                  {renderInline(l.replace(/^\s*[-*•]\s+/, ""))}
                </li>
              ))}
            </ul>
          );
        }

        // Numbered list
        const isNumber = lines.every(l => /^\s*\d+[.)]\s+/.test(l));
        if (isNumber) {
          return (
            <ol key={bi} style={{ margin: 0, paddingLeft: 22, display: "flex", flexDirection: "column", gap: 5 }}>
              {lines.map((l, li) => (
                <li key={li} style={{ fontSize: "1rem", lineHeight: 1.7, color: t1 }}>
                  {renderInline(l.replace(/^\s*\d+[.)]\s+/, ""))}
                </li>
              ))}
            </ol>
          );
        }

        // Mixed block — render line by line
        return (
          <div key={bi} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {lines.map((l, li) => {
              if (/^\s*[-*•]\s+/.test(l)) return (
                <div key={li} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <span style={{ color: "#5865f2", flexShrink: 0, marginTop: 2 }}>•</span>
                  <span style={{ fontSize: "1rem", lineHeight: 1.7, color: t1 }}>
                    {renderInline(l.replace(/^\s*[-*•]\s+/, ""))}
                  </span>
                </div>
              );
              if (/^\s*\d+[.)]\s+/.test(l)) {
                const num = l.match(/^\s*(\d+)/)?.[1];
                return (
                  <div key={li} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <span style={{ color: "#5865f2", fontWeight: 700, flexShrink: 0, fontSize: "0.85rem", minWidth: 16 }}>{num}.</span>
                    <span style={{ fontSize: "1rem", lineHeight: 1.7, color: t1 }}>
                      {renderInline(l.replace(/^\s*\d+[.)]\s+/, ""))}
                    </span>
                  </div>
                );
              }
              return (
                <p key={li} style={{ fontSize: "1rem", lineHeight: 1.7, color: t1, margin: 0 }}>
                  {renderInline(l)}
                </p>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** Structured cards derived only from values explicitly present in Rev's verified answer. */
const VerifiedComparison: FC<{ text: string; isDark: boolean; t1: string; t2: string }> = ({ text, isDark, t1, t2 }) => {
  if (!text.startsWith("I compared your latest rolling seven days")) return null;
  const blocks = text.split(/(?=\*\*(?:Latest period|Previous period [1-9])\*\*)/);
  const periods = blocks.slice(1).filter(b => /^\*\*(Latest period|Previous period [1-9])\*\*/.test(b));
  if (periods.length !== 4) return null;
  const extract = (body: string, pattern: RegExp) => body.match(pattern)?.[1] ?? null;
  const metrics = periods.map((body, index) => ({
    title: index === 0 ? "Latest 7 days" : `Previous period ${index}`,
    dates: extract(body, /\*\*[^*]+\*\* \(([^)]+)\)/),
    orders: extract(body, /- Orders: (\d+) recorded/),
    carts: extract(body, /- Unrecovered abandoned carts: (\d+) recorded/),
    customers: extract(body, /- Newly recorded customer profiles: (\d+)/),
    firstTime: extract(body, /- First-time purchaser orders: (\d+)/),
    returning: extract(body, /returning purchaser orders: (\d+)/),
    values: [...body.matchAll(/- Orders: \d+ recorded; ([^\n]+?)\.(?=\s|$)/g)].map(m => m[1]),
    discounts: [...body.matchAll(/- Recorded order discounts: ([^\n]+)\./g)].map(m => m[1]),
  }));
  // A zero-record period is valid evidence, not missing data. Do not render empty cards.
  const isComplete = metrics.every((p) => p.dates && p.orders !== null && p.carts !== null &&
    p.customers !== null && p.firstTime !== null && p.returning !== null);
  if (!isComplete) return null;
  const cardBg = isDark ? "#151824" : "#ffffff";
  const border = isDark ? "#34374b" : "#e5e7eb";
  return (
    <section aria-label="Verified store performance comparison" style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <BarChart2 size={16} color="#1F06AC" />
        <span style={{ color: t1, fontSize: 14, fontWeight: 750 }}>Verified performance evidence</span>
        <span style={{ color: t2, fontSize: 11 }}>Rolling 7-day periods · UTC</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
        {metrics.map((period, index) => (
          <div key={index} style={{ border: `1px solid ${index === 0 ? "#1F06AC" : border}`, borderRadius: 12,
            padding: 14, background: index === 0 ? (isDark ? "#1b1740" : "#f4f2ff") : cardBg }}>
            <div style={{ color: t1, fontSize: 13, fontWeight: 750 }}>{period.title}</div>
            <div style={{ color: t2, fontSize: 11, marginTop: 4, marginBottom: 12 }}>{period.dates}</div>
            {([["Orders", period.orders], ["Abandoned carts", period.carts], ["New profiles", period.customers],
               ["First-time orders", period.firstTime], ["Returning orders", period.returning]] as Array<[string, string | null]>).map(([label, value]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "5px 0" }}>
                <span style={{ color: t2, fontSize: 12 }}>{label}</span>
                <strong style={{ color: t1, fontSize: 13 }}>{value ?? "—"}</strong>
              </div>
            ))}
            {period.values.map((value, i) => <div key={`v${i}`} style={{ color: t1, fontSize: 12, marginTop: 9 }}>Recorded order value: <strong>{value}</strong></div>)}
            {period.discounts.map((value, i) => <div key={`d${i}`} style={{ color: t2, fontSize: 12, marginTop: 4 }}>Discounts: {value}</div>)}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, color: t2, marginTop: 12 }}>Recorded merchant data, not verified net sales. Review the evidence limitations below.</div>
    </section>
  );
};

const ResponseCard: FC<{ response: RevResponse; isDark: boolean; t1: string; t2: string; onSend?: (text: string) => void }> = ({
  response, isDark, t1, t2, onSend,
}) => {
  const type = response.response_type;

  // Every non-analysis type renders as rich text, not a report card
  if (type !== "analysis") {
    const text = response.text || "";
    if (!text) return null;
    return <><VerifiedComparison text={text} isDark={isDark} t1={t1} t2={t2} /><RichText text={text} t1={t1} isDark={isDark} /></>;
  }

  // Analysis: 6-part structured response
  const sections = [
    { label: "Situation",      text: response.situation },
    { label: "Insight",        text: response.insight },
    { label: "Implication",    text: response.implication },
    { label: "Recommendation", text: response.recommendation },
  ].filter(s => s.text);

  const conf = response.confidence;
  const confPct = conf ? Math.round(conf.score * 100) : null;
  const confColor = confPct !== null
    ? (confPct >= 75 ? "#059669" : confPct >= 50 ? "#d97706" : "#dc2626")
    : "#9ca3af";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {sections.map(({ label, text }) => (
        <div key={label}>
          <p style={{ fontSize: "1.05rem", fontWeight: 750,
            letterSpacing: "-0.015em", color: t1, margin: "0 0 7px" }}>
            {label}
          </p>
          <RichText text={text!} t1={t1} isDark={isDark} />
        </div>
      ))}

      {confPct !== null && conf && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6,
            padding: "4px 10px", borderRadius: 999,
            background: `${confColor}15`, border: `1px solid ${confColor}30` }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: confColor }} />
            <span style={{ fontSize: "0.72rem", fontWeight: 700, color: confColor }}>
              {confPct}% confidence
            </span>
          </div>
          {conf.basis && (
            <span style={{ fontSize: "0.7rem", color: t2 }}>{conf.basis}</span>
          )}
        </div>
      )}

      {response.actions && response.actions.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {response.actions.map((action, i) => {
            // Map tool names to real dashboard routes
            const toolRoutes: Record<string, string> = {
              view_carts:       "/dashboard/cart-recovery",
              view_customers:   "/dashboard/customers",
              view_revenue:     "/dashboard/analytics",
              view_analytics:   "/dashboard/analytics",
              view_products:    "/dashboard/analytics",
              view_checkout:    "/dashboard/checkout",
              create_campaign:  "/dashboard/campaign",
              view_retention:   "/dashboard/customers",
            };
            const route = action.tool ? toolRoutes[action.tool] : null;
            return (
              <button key={i} style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "7px 14px", borderRadius: 999, fontSize: "0.8rem", fontWeight: 600,
                background: "rgba(88,101,242,0.1)", color: "#5865f2",
                border: "1px solid rgba(88,101,242,0.25)", cursor: "pointer",
                fontFamily: "inherit", transition: "all 0.15s",
              }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = "rgba(88,101,242,0.2)";
                  e.currentTarget.style.transform = "translateY(-1px)";
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = "rgba(88,101,242,0.1)";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
                onClick={() => {
                  if (route) {
                    window.location.href = route;
                  } else if (action.tool === "ask_rev") {
                    // Send a follow-up message to Rev
                    const followUp = action.params?.message as string;
                    if (followUp) onSend?.(followUp);
                  }
                  // Other tool types will be wired as capabilities are built
                }}
              >
                <Zap size={11} />{action.label}
              </button>
            );
          })}
        </div>
      )}

      {response.agents_used && response.agents_used.length > 0 && (
        <p style={{ fontSize: "0.65rem", color: isDark ? "#374151" : "#c4c9d4", margin: 0 }}>
          Analysed by: {response.agents_used.join(", ")} agent{response.agents_used.length > 1 ? "s" : ""}
        </p>
      )}

      {response.warnings && response.warnings.length > 0 && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 6,
          padding: "8px 12px", borderRadius: 8,
          background: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.2)" }}>
          <AlertCircle size={13} color="#d97706" style={{ flexShrink: 0, marginTop: 2 }} />
          <p style={{ fontSize: "0.72rem", color: "#d97706", margin: 0, lineHeight: 1.5 }}>
            {response.warnings.join(" · ")}
          </p>
        </div>
      )}
    </div>
  );
};

// ── Message bubble ────────────────────────────────────────────────────────────

function Bubble({ msg, onCopy, onRetry, onSend, isDark, t1, t2 }: {
  msg: Message; onCopy: (t: string) => void;
  onRetry: () => void; onSend?: (text: string) => void; isDark: boolean; t1: string; t2: string;
}) {
  const isRev = msg.role === "rev";

  if (!isRev) return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="flex justify-end mb-5">
      <div className="max-w-[85%] sm:max-w-[72%] px-4 py-3 rounded-2xl rounded-tr-md text-[0.9rem] leading-relaxed text-white whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
        style={{ background: "linear-gradient(135deg,#5865f2,#4a55e8)" }}>
        {typeof msg.content === "string" ? msg.content : ""}
      </div>
    </motion.div>
  );

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="flex gap-3 mb-7 group">
      <OrbAvatar />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[0.73rem] font-bold" style={{ color: t1 }}>Rev Intelligence</span>
          <span className="text-[0.65rem]" style={{ color: isDark ? "#374151" : "#c4c9d4" }}>
            {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>

        {msg.isStreaming && <LoadingBar isDark={isDark} />}

        {msg.hasError && !msg.isStreaming && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10,
            padding: "12px 14px", borderRadius: 12,
            background: "rgba(220,38,38,0.06)", border: "1px solid rgba(220,38,38,0.18)" }}>
            <AlertCircle size={15} color="#dc2626" style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: "0.86rem", color: "#dc2626", margin: "0 0 8px", fontWeight: 600 }}>
                {typeof msg.content === "string" ? msg.content : "Rev encountered an issue."}
              </p>
              <button onClick={onRetry}
                style={{ display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "5px 12px", borderRadius: 999, fontSize: "0.78rem", fontWeight: 600,
                  background: "rgba(220,38,38,0.1)", color: "#dc2626",
                  border: "1px solid rgba(220,38,38,0.25)", cursor: "pointer", fontFamily: "inherit" }}>
                <RefreshCcw size={12} />Try again
              </button>
            </div>
          </div>
        )}

        {!msg.isStreaming && !msg.hasError && msg.content && (
          typeof msg.content === "object" && "response_type" in (msg.content as object)
            ? <ResponseCard response={msg.content as RevResponse} isDark={isDark} t1={t1} t2={t2} onSend={onSend} />
            : <p style={{ fontSize: "0.9rem", lineHeight: 1.7, color: t1, margin: 0 }}>
                {String(msg.content)}
              </p>
        )}

        {!msg.isStreaming && !msg.hasError && (
          <div className="flex items-center gap-0.5 mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
            {[
              { icon: Copy,       label: "Copy",  fn: () => onCopy(typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)) },
              { icon: ThumbsUp,   label: "Good",  fn: () => {} },
              { icon: ThumbsDown, label: "Bad",   fn: () => {} },
              { icon: RotateCcw,  label: "Retry", fn: onRetry },
            ].map(({ icon: Icon, label, fn }) => (
              <button key={label} onClick={fn}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[0.7rem] transition-colors"
                style={{ color: isDark ? "#374151" : "#c4c9d4", fontFamily: "inherit" }}
                onMouseEnter={e => (e.currentTarget.style.color = t1)}
                onMouseLeave={e => (e.currentTarget.style.color = isDark ? "#374151" : "#c4c9d4")}>
                <Icon size={11} />{label}
              </button>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Attach dropdown ───────────────────────────────────────────────────────────

function AttachMenu({ onFile, onMedia, card, border, t1, t2 }: {
  onFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onMedia: (e: React.ChangeEvent<HTMLInputElement>) => void;
  card: string; border: string; t1: string; t2: string;
}) {
  const [open, setOpen] = useState(false);
  // Keep file inputs OUTSIDE the animated menu so they are never unmounted
  // when the dropdown closes. Unmounting the <input> before onChange fires
  // silently drops the file selection on Chrome/Safari.
  const fileRef  = useRef<HTMLInputElement>(null);
  const mediaRef = useRef<HTMLInputElement>(null);

  const triggerFile  = () => { setOpen(false); setTimeout(() => fileRef.current?.click(),  50); };
  const triggerMedia = () => { setOpen(false); setTimeout(() => mediaRef.current?.click(), 50); };

  return (
    <div style={{ position: "relative" }}>
      {/* Persistent file inputs — never unmounted */}
      <input ref={fileRef}  type="file" accept="*/*"               className="hidden" onChange={onFile} />
      <input ref={mediaRef} type="file" accept="image/*,video/*"   className="hidden" onChange={onMedia} />

      <button onClick={() => setOpen(v => !v)} title="Attach"
        className="p-1.5 rounded-lg transition-colors opacity-60 hover:opacity-100" style={{ color: t2 }}>
        <Plus size={17} />
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <motion.div initial={{ opacity: 0, y: 6, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.95 }} transition={{ duration: 0.15 }}
              style={{ position: "absolute", bottom: "calc(100% + 8px)", left: 0, zIndex: 20,
                background: card, border: `1px solid ${border}`, borderRadius: 14,
                boxShadow: "0 8px 32px rgba(0,0,0,0.15)", padding: "6px", minWidth: 180 }}>
              <button onClick={triggerFile}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-[0.8rem] font-medium cursor-pointer transition-colors hover:bg-black/5 w-full text-left"
                style={{ color: t1, background: "transparent", border: "none", fontFamily: "inherit" }}>
                <FileText size={15} style={{ color: "#5865f2" }} />
                Attach file
              </button>
              <button onClick={triggerMedia}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-[0.8rem] font-medium cursor-pointer transition-colors hover:bg-black/5 w-full text-left"
                style={{ color: t1, background: "transparent", border: "none", fontFamily: "inherit" }}>
                <ImageIcon size={15} style={{ color: "#db2777" }} />
                Photos & Videos
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Input toolbar ─────────────────────────────────────────────────────────────

function InputToolbar({ inputRef, value, onChange, onKeyDown, placeholder, disabled,
  onSend, onFile, onMedia, onVoice, onCall, thinking, card, border, t1, t2, isDark }: {
  inputRef: React.RefObject<HTMLTextAreaElement>;
  value: string; onChange: React.ChangeEventHandler<HTMLTextAreaElement>;
  onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement>;
  placeholder: string; disabled?: boolean;
  onSend: () => void; onFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onMedia: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onVoice: () => void; onCall: () => void; thinking: boolean;
  card: string; border: string; t1: string; t2: string; isDark: boolean;
}) {
  return (
    <div className="rounded-2xl shadow-sm overflow-visible" style={{ background: card, border: `1px solid ${border}` }}>
      <textarea ref={inputRef} value={value} onChange={onChange} onKeyDown={onKeyDown}
        placeholder={placeholder} rows={2} disabled={disabled}
        className="w-full bg-transparent text-[0.9rem] outline-none resize-none px-5 pt-4 pb-2 max-h-36 [scrollbar-width:none] leading-relaxed"
        style={{ color: t1, minHeight: 26 }} />
      <div className="flex items-center justify-between px-3 pb-3">
        <AttachMenu onFile={onFile} onMedia={onMedia} card={card} border={border} t1={t1} t2={t2} />
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button title="Voice message" onClick={onVoice}
            className="p-1.5 rounded-lg transition-colors opacity-60 hover:opacity-100" style={{ color: t2 }}>
            <Mic size={15} />
          </button>
          <button title="Book audio call" onClick={onCall}
            className="p-1.5 rounded-lg transition-colors opacity-60 hover:opacity-100" style={{ color: t2 }}>
            <Phone size={15} />
          </button>
          <motion.button whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.9 }}
            onClick={onSend} disabled={!value.trim() || thinking}
            className="w-8 h-8 rounded-xl flex items-center justify-center transition-all ml-1"
            style={{ background: value.trim() && !thinking ? "#5865f2" : (isDark ? "#1f1f1f" : "#e5e7eb"),
              color: value.trim() && !thinking ? "white" : t2 }}>
            {thinking ? (
              <motion.div style={{ display: "flex", gap: 2.5, alignItems: "center" }}>
                {[0, 1, 2].map(i => (
                  <motion.div key={i}
                    style={{ width: 3, height: 3, borderRadius: "50%", background: "currentColor" }}
                    animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
                    transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }} />
                ))}
              </motion.div>
            ) : <Send size={14} />}
          </motion.button>
        </div>
      </div>
    </div>
  );
}

// ── Conversation history item ─────────────────────────────────────────────────

function ConvItem({ conv, isActive, onClick, onDelete, onRename, isDark, t1, t4 }: {
  conv: Conversation; isActive: boolean;
  onClick: () => void; onDelete: () => void; onRename: () => void;
  isDark: boolean; t1: string; t4: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);

  const openActions = () => {
    if (menuOpen) { setMenuOpen(false); return; }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuHeight = 104;
    const menuWidth = 156;
    const gap = 6;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const viewportTop = window.visualViewport?.offsetTop ?? 0;
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
    const roomBelow = viewportTop + viewportHeight - rect.bottom;
    const top = roomBelow >= menuHeight + gap
      ? rect.bottom + gap
      : rect.top - menuHeight - gap;
    setMenuPosition({
      top: Math.max(viewportTop + 8, Math.min(top, viewportTop + viewportHeight - menuHeight - 8)),
      left: Math.max(8, Math.min(rect.right - menuWidth, viewportWidth - menuWidth - 8)),
    });
    setMenuOpen(true);
  };

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menuOpen]);

  return (
    <div className="relative group/item flex items-center rounded-lg transition-all"
      style={{ background: isActive ? (isDark ? "rgba(88,101,242,0.15)" : "rgba(88,101,242,0.08)") : "transparent" }}
      onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)"; }}
      onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
      <button onClick={onClick}
        className="flex-1 text-left px-3 py-2.5 text-[0.8rem] font-medium truncate min-w-0"
        style={{ color: isActive ? "#5865f2" : t1 }}>
        {conv.title || "Untitled conversation"}
      </button>
      <div className="shrink-0 pr-1">
        <button ref={triggerRef} type="button" aria-label={`Actions for ${conv.title || "Untitled conversation"}`}
          aria-haspopup="menu" aria-expanded={menuOpen}
          onClick={e => { e.stopPropagation(); openActions(); }}
          className="flex items-center justify-center w-9 h-9 rounded-md transition-colors hover:bg-black/5"
          style={{ color: t1 }}>
          <MoreHorizontal size={20} strokeWidth={2.5} />
        </button>
      </div>
      {createPortal(
        <AnimatePresence>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-[150]" onClick={() => setMenuOpen(false)} />
              <motion.div role="menu" aria-label="Conversation actions"
                initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: 0.12 }}
                style={{ position: "fixed", top: menuPosition.top, left: menuPosition.left, zIndex: 151,
                  background: isDark ? "#1a1a1a" : "#fff",
                  border: `1px solid ${isDark ? "#2a2a2a" : "#e5e7eb"}`,
                  borderRadius: 10, padding: 4, width: 156,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.15)" }}>
                <button role="menuitem" onClick={() => { setMenuOpen(false); onRename(); }}
                  className="flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-[0.78rem] font-medium transition-colors hover:bg-black/5 text-left"
                  style={{ color: isDark ? "#e5e7eb" : "#1a1a2e", fontFamily: "inherit" }}>
                  <Pencil size={13} style={{ color: "#5865f2" }} />Rename
                </button>
                <button role="menuitem" onClick={() => { setMenuOpen(false); onDelete(); }}
                  className="flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-[0.78rem] font-medium transition-colors text-left hover:bg-red-500/10"
                  style={{ color: "#dc2626", fontFamily: "inherit" }}>
                  <Trash2 size={13} />Delete
                </button>
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RevIntell() {
  const { user } = useAuth();
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === "dark";
  const firstName = user?.full_name?.split(" ")[0] ?? "there";

  // URL is the source of truth for the active conversation
  const { conversationId: urlConvId } = useParams<{ conversationId?: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const findingId = searchParams.get("finding");

  const [conversations,  setConversations]  = useState<Conversation[]>([]);
  const [activeId,       setActiveId]       = useState<string | null>(urlConvId || null);
  const [messages,       setMessages]       = useState<Message[]>([]);
  const [input,          setInput]          = useState("");
  useEffect(() => {
    if (!findingId) return;
    let active = true;
    api.get<{ success: boolean; data: { finding: { title: string; description: string; evidence: Record<string, unknown> } } }>(
      `/rev/findings/${encodeURIComponent(findingId)}`
    ).then(response => {
      if (!active) return;
      const finding = response.data.data.finding;
      const evidence = JSON.stringify(finding.evidence || {});
      setInput(`Investigate this verified Revluma finding: ${finding.title}. ${finding.description}. Evidence: ${evidence.slice(0, 2500)}. Explain the observed change, limitations, and supported next steps. Do not invent causes.`);
    }).catch(() => { /* Do not expose cross-tenant or unavailable evidence. */ });
    return () => { active = false; };
  }, [findingId]);

  const [thinking,       setThinking]       = useState(false);
  const [menuOpen,       setMenuOpen]       = useState(false);
  const [copied,         setCopied]         = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [convLoading,    setConvLoading]    = useState(false);
  const [lastUserMsg,    setLastUserMsg]    = useState<string>("");
  const [convNotFound,   setConvNotFound]   = useState(false);
  const [imageAttachment, setImageAttachment] = useState<{
    base64: string; mediaType: string; preview: string; name: string;
  } | null>(null);
  const [renameModalId,  setRenameModalId]  = useState<string | null>(null);
  const [renameValue,    setRenameValue]    = useState("");
  const [renameStatus, setRenameStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deletingConvId, setDeletingConvId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);
  // Set right before we navigate() to a conversation we just created ourselves,
  // so the URL-sync effect below doesn't redundantly re-fetch and clobber the
  // (already correct) optimistic messages with a fresh server round trip.
  const justCreatedIdRef = useRef<string | null>(null);

  // Scroll to bottom when messages change
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, thinking]);

  // ── Load conversations list ───────────────────────────────────────────────
  const loadConversations = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await api.get<{ data: Conversation[] }>("/rev/conversations");
      const data = (res as any)?.data?.data ?? (res as any)?.data ?? [];
      setConversations(Array.isArray(data) ? data : []);
    } catch {
      // Silent fail — sidebar just shows empty
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // ── Load specific conversation ────────────────────────────────────────────
  const loadConversation = useCallback(async (convId: string) => {
    setConvNotFound(false);
    setConvLoading(true);
    setMessages([]);

    try {
      const res = await api.get<{
        data: {
          messages: Array<{
            id: string; role: string; content: unknown;
            created_at: string; has_error?: boolean;
          }>;
        };
      }>(`/rev/conversation/${convId}`);

      const msgs = (res as any)?.data?.data?.messages
                ?? (res as any)?.data?.messages
                ?? [];

      const parsed: Message[] = msgs.map((m: any) => {
        let content: string | RevResponse = "";
        const raw = m.content;
        if (typeof raw === "object" && raw !== null) {
          if ("response_type" in raw) {
            content = raw as RevResponse;
          } else if ("text" in raw) {
            content = (raw as any).text || "";
          } else if ("situation" in raw) {
            content = { response_type: "analysis", ...raw } as RevResponse;
          } else {
            content = JSON.stringify(raw);
          }
        } else if (typeof raw === "string") {
          try {
            const parsed2 = JSON.parse(raw);
            if ("response_type" in parsed2) content = parsed2 as RevResponse;
            else if ("text" in parsed2) content = parsed2.text || "";
            else content = raw;
          } catch { content = raw; }
        }
        return {
          id:        m.id,
          role:      m.role as "user" | "rev",
          content,
          timestamp: new Date(m.created_at),
          hasError:  m.has_error || false,
        };
      });

      setMessages(parsed);
    } catch (err: any) {
      if (err?.status === 404 || err?.status === 403) {
        setConvNotFound(true);
      }
    } finally {
      setConvLoading(false);
    }
  }, []);

  // ── URL → state sync (on mount and when URL changes) ─────────────────────
  // Run on mount (to handle refresh) and whenever the URL conversationId changes.
  // Do NOT gate on activeId — on refresh they start equal so the check would skip loading.
  useEffect(() => {
    if (urlConvId) {
      setActiveId(urlConvId);
      // If this URL change is us navigating to a conversation we just created
      // in send() below, our local messages are already the authoritative
      // copy — skip the reload so it can't overwrite them with a duplicate.
      if (justCreatedIdRef.current === urlConvId) {
        justCreatedIdRef.current = null;
        return;
      }
      loadConversation(urlConvId);
    } else {
      setActiveId(null);
      setMessages([]);
      setConvNotFound(false);
    }
  }, [urlConvId]); // loadConversation is stable (useCallback with no deps that change)

  // Load sidebar on mount
  useEffect(() => {
    loadConversations();
  }, []);

  // ── New chat ──────────────────────────────────────────────────────────────
  const newChat = useCallback(() => {
    setMenuOpen(false);
    setInput("");
    setMessages([]);
    setConvNotFound(false);
    navigate("/dashboard/rev-intell");
  }, [navigate]);

  // ── Navigate to conversation ──────────────────────────────────────────────
  const openConversation = useCallback((convId: string) => {
    setMenuOpen(false);
    navigate(`/dashboard/rev-intell/${convId}`);
    // URL change triggers the useEffect above which loads the conversation
  }, [navigate]);

  // ── Send message ──────────────────────────────────────────────────────────
  const send = useCallback(async (text: string, isRetry = false) => {
    if (!text.trim() || thinking) return;
    const trimmed = text.trim();

    if (!isRetry) {
      setLastUserMsg(trimmed);
      setInput("");
      if (inputRef.current) inputRef.current.style.height = "auto";
      // Add user message optimistically (with image preview if present)
      const capturedImg2 = imageAttachment; // snapshot before clear
      const userContent: any = capturedImg2
        ? { text: trimmed, imagePreview: capturedImg2.preview }
        : trimmed;
      setMessages(prev => [...prev, {
        id: `u${Date.now()}`, role: "user", content: userContent, timestamp: new Date(),
      }]);
    }

    // Streaming placeholder
    const sid = `r${Date.now()}`;
    setMessages(prev => [...prev, {
      id: sid, role: "rev", content: "", timestamp: new Date(), isStreaming: true,
    }]);
    setThinking(true);

    try {
      // Capture image BEFORE any state changes
      const capturedImage = imageAttachment;
      setImageAttachment(null); // clear preview immediately for UX

      const body: Record<string, unknown> = { message: trimmed };
      if (activeId) body.conversation_id = activeId;
      if (capturedImage) {
        body.image_base64     = capturedImage.base64;
        body.image_media_type = capturedImage.mediaType;
      }

      const res = await api.post<{
        success: boolean;
        conversation_id: string;
        message_id: string;
        response_type: string;
        text: string | null;
        response: RevResponse;
        error?: { code: string; message: string };
      }>("/rev/chat", body);

      const data = (res as any)?.data ?? (res as any);

      if (!data?.success) {
        setMessages(prev => prev.map(m => m.id === sid ? {
          ...m, isStreaming: false, hasError: true,
          content: cleanError(data?.error?.code, data?.error?.message),
          errorCode: data?.error?.code,
        } : m));
      } else {
        // Navigate to conversation URL if this is a new conversation
        const convId = data.conversation_id;
        if (convId && convId !== activeId) {
          justCreatedIdRef.current = convId;
          setActiveId(convId);
          navigate(`/dashboard/rev-intell/${convId}`, { replace: true });
          loadConversations(); // refresh sidebar
        }

        // Build RevResponse
        const rType = (data.response_type || "analysis") as ResponseType;
        const rIntent = data.intent || undefined;
        const revResponse: RevResponse = {
          response_type: rType,
          text: data.text ?? data.response?.text,
          situation:      data.response?.situation,
          insight:        data.response?.insight,
          implication:    data.response?.implication,
          recommendation: data.response?.recommendation,
          confidence:     data.response?.confidence ?? (
            data.confidence_score !== undefined
              ? { score: data.confidence_score, basis: data.confidence_basis || "" }
              : undefined
          ),
          actions:     data.response?.actions     || data.actions    || [],
          agents_used: data.meta?.agents_used     || data.agents_used || [],
          warnings:    data.response?.warnings    || data.warnings   || [],
        };

        setMessages(prev => prev.map(m => m.id === sid ? {
          ...m, isStreaming: false, content: revResponse,
        } : m));
      }
    } catch (err) {
      const msg = err instanceof ApiError
        ? cleanError(String((err as any).status), err.message)
        : "Rev is taking a moment. Please try again shortly.";
      setMessages(prev => prev.map(m => m.id === sid ? {
        ...m, isStreaming: false, hasError: true, content: msg,
      } : m));
    } finally {
      setThinking(false);
    }
  }, [activeId, thinking, navigate]);

  const handleRetry = useCallback(() => {
    setMessages(prev => {
      const lastRevIdx = [...prev].reverse().findIndex(m => m.role === "rev");
      if (lastRevIdx === -1) return prev;
      return prev.slice(0, prev.length - 1 - lastRevIdx);
    });
    if (lastUserMsg) send(lastUserMsg, true);
  }, [lastUserMsg, send]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
  };
  const resize = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 150) + "px";
  };
  const copy = (t: string) => {
    navigator.clipboard.writeText(t);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    // For images, convert to base64 for Rev to see
    if (f.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        setImageAttachment({ base64, mediaType: f.type, preview: reader.result as string, name: f.name });
      };
      reader.readAsDataURL(f);
    } else {
      send(`[File attached: ${f.name.slice(0, 60)}]`);
    }
    e.target.value = "";
  };
  const handleMedia = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    if (f.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        setImageAttachment({ base64, mediaType: f.type, preview: reader.result as string, name: f.name });
      };
      reader.readAsDataURL(f);
    } else {
      send(`[Media: ${f.name.slice(0, 40)}]`);
    }
    e.target.value = "";
  };
  const removeAttachment = () => setImageAttachment(null);
  const handleVoice = () => alert("Voice messages coming soon.");
  const handleCall  = () => alert("Audio call booking coming soon.");

  const deleteConv = async (id: string) => {
    if (deletingConvId) return;
    setDeletingConvId(id);
    setDeleteError(null);
    try {
      await api.delete(`/rev/conversation/${encodeURIComponent(id)}`);
      setConversations(prev => prev.filter(c => c.id !== id));
      setDeleteConfirmId(null);
      if (activeId === id) newChat();
    } catch {
      setDeleteError("Could not delete this conversation. Please try again.");
    } finally {
      setDeletingConvId(null);
    }
  };
  const renameConv = (id: string) => {
    const conv = conversations.find(c => c.id === id);
    setRenameValue(conv?.title ?? "");
    setRenameError(null);
    setRenameStatus("idle");
    setRenameModalId(id);
  };
  const submitRename = async () => {
    if (!renameModalId || !renameValue.trim() || renameStatus !== "idle") return;
    const id = renameModalId;
    const title = renameValue.trim().slice(0, 100);
    setRenameError(null);
    setRenameStatus("saving");
    try {
      await api.patch(`/rev/conversation/${encodeURIComponent(id)}/title`, { title });
      setConversations(prev => prev.map(c => c.id === id ? { ...c, title } : c));
      setRenameStatus("saved");
      window.setTimeout(() => {
        setRenameModalId(current => current === id ? null : current);
        setRenameStatus(current => current === "saved" ? "idle" : current);
      }, 650);
    } catch {
      setRenameError("Could not rename this conversation. Please try again.");
      setRenameStatus("idle");
    }
  };

  // Theme
  const bg   = isDark ? "#111"    : "#f7f8fc";
  const card = isDark ? "#171717" : "#ffffff";
  const bdr  = isDark ? "#222"    : "#e8eaf0";
  const t1   = isDark ? "#f1f5f9" : "#1a1a2e";
  const t2   = isDark ? "#94a3b8" : "#64748b";
  const t4   = isDark ? "#374151" : "#d1d5db";

  const inputProps = {
    inputRef, value: input, onChange: resize, onKeyDown: handleKey,
    onSend: () => send(input), onFile: handleFile, onMedia: handleMedia,
    onVoice: handleVoice, onCall: handleCall, thinking,
    card, border: bdr, t1, t2, isDark,
  };

  const hasMessages = messages.length > 0;

  return (
    <div className="relative flex flex-col overflow-hidden"
      style={{ height: "calc(100vh - var(--topbar-h, 64px))", margin: "-20px -20px 0", background: bg }}>

      {/* Hamburger */}
      <div className="absolute top-4 right-4 z-30">
        <button onClick={() => setMenuOpen(v => !v)}
          className="flex items-center justify-center w-9 h-9 rounded-xl transition-all hover:opacity-80"
          style={{ background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)", color: t2 }}>
          {menuOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {/* Sidebar */}
      <AnimatePresence>
        {menuOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }} className="absolute inset-0 z-40"
              style={{ background: "rgba(0,0,0,0.3)", backdropFilter: "blur(2px)" }}
              onClick={() => setMenuOpen(false)} />
            <motion.div
              initial={{ x: "100%", opacity: 0 }} animate={{ x: 0, opacity: 1 }}
              exit={{ x: "100%", opacity: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}
              className="absolute top-0 right-0 bottom-0 z-50 flex flex-col"
              style={{ width: 300,
                background: isDark ? "rgba(10,10,10,0.88)" : "rgba(255,255,255,0.9)",
                backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
                borderLeft: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)"}`,
                boxShadow: "-16px 0 60px rgba(0,0,0,0.2)" }}>

              <div className="flex items-center justify-between px-5 pt-5 pb-4"
                style={{ borderBottom: `1px solid ${isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"}` }}>
                <div className="flex items-center gap-2.5">
                  <img src={revIntellLogo} alt="Rev" className="w-6 h-6 object-contain"
                    style={{ filter: "drop-shadow(0 0 5px rgba(100,160,255,0.6))" }} />
                  <span className="text-[0.88rem] font-bold" style={{ color: t1 }}>Rev Intell</span>
                </div>
                <button onClick={() => setMenuOpen(false)}
                  className="p-1 rounded-lg opacity-50 hover:opacity-100 transition-opacity" style={{ color: t1 }}>
                  <X size={16} />
                </button>
              </div>

              <div className="px-4 pt-4 pb-3">
                <button onClick={newChat}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[0.84rem] font-bold text-white"
                  style={{ background: "linear-gradient(135deg,#5865f2,#4a55e8)", boxShadow: "0 4px 14px rgba(88,101,242,0.3)" }}>
                  <Plus size={16} />New chat
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-3 pb-4 [scrollbar-width:none]">
                {historyLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="w-4 h-4 rounded-full border-2 border-t-transparent border-[#5865f2] animate-spin" />
                  </div>
                ) : conversations.length === 0 ? (
                  <p className="text-center text-[0.75rem] py-8" style={{ color: t4 }}>No conversations yet</p>
                ) : (
                  <>
                    <p className="px-2 py-1.5 text-[0.62rem] font-bold uppercase tracking-[0.1em]" style={{ color: t4 }}>
                      Recent
                    </p>
                    {conversations.map(conv => (
                      <ConvItem key={conv.id} conv={conv}
                        isActive={activeId === conv.id}
                        onClick={() => openConversation(conv.id)}
                        onDelete={() => setDeleteConfirmId(conv.id)}
                        onRename={() => renameConv(conv.id)}
                        isDark={isDark} t1={t1} t4={t4} />
                    ))}
                  </>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "none" }}>

        {/* Conversation loading */}
        {convLoading && (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-3">
              <div className="w-6 h-6 rounded-full border-2 border-t-transparent border-[#5865f2] animate-spin" />
              <p className="text-[0.8rem]" style={{ color: t2 }}>Loading conversation...</p>
            </div>
          </div>
        )}

        {/* Conversation not found */}
        {convNotFound && !convLoading && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-[1rem] font-semibold mb-2" style={{ color: t1 }}>Conversation not found</p>
              <p className="text-[0.85rem] mb-4" style={{ color: t2 }}>This conversation doesn't exist or you don't have access.</p>
              <button onClick={newChat}
                className="px-4 py-2 rounded-xl text-[0.85rem] font-semibold text-white"
                style={{ background: "#5865f2" }}>
                Start new chat
              </button>
            </div>
          </div>
        )}

        {/* Welcome screen */}
        {!hasMessages && !convLoading && !convNotFound && !activeId && (
          <div className="flex flex-col items-center justify-start min-h-full px-6 pt-16 pb-6 max-w-2xl mx-auto w-full">
            <motion.div initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5 }} className="mb-6">
              <OrbHero size={90} />
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }} className="text-center mb-8">
              <h2 className="text-[1.55rem] font-bold mb-1" style={{ color: "#5865f2" }}>
                Hello, {firstName}
              </h2>
              <h3 className="text-[1.75rem] font-extrabold tracking-tight mb-3" style={{ color: t1 }}>
                How can I help your revenue today?
              </h3>
              <p className="text-[0.88rem] max-w-md mx-auto leading-relaxed" style={{ color: t2 }}>
                I monitor your store 24/7, detect opportunities before your competitors,
                and tell you exactly what action to take.
              </p>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }} className="w-full mb-7">
              {imageAttachment && (
                <div className="flex items-center gap-3 mb-2 px-1">
                  <div className="relative">
                    <img src={imageAttachment.preview} alt="attachment"
                      className="h-14 w-14 rounded-xl object-cover border"
                      style={{ borderColor: bdr }} />
                    <button onClick={removeAttachment}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold"
                      style={{ background: "#dc2626" }}>×</button>
                  </div>
                  <span className="text-[0.75rem]" style={{ color: t2 }}>{imageAttachment.name.slice(0, 40)}</span>
                </div>
              )}
              <InputToolbar {...inputProps} placeholder="Ask me anything about your business..." />
            </motion.div>

            <div className="grid grid-cols-3 gap-3 w-full">
              {STARTERS.map((s, i) => (
                <motion.button key={s.label}
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 + i * 0.05 }}
                  onClick={() => send(s.sub)}
                  className="flex flex-col items-start p-4 rounded-xl text-left transition-all hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98]"
                  style={{ background: card, border: `1px solid ${bdr}` }}>
                  <s.icon size={18} className="mb-2.5" style={{ color: s.color }} />
                  <p className="text-[0.78rem] font-bold mb-1" style={{ color: t1 }}>{s.label}</p>
                  <p className="text-[0.7rem] leading-snug" style={{ color: t2 }}>{s.sub}</p>
                </motion.button>
              ))}
            </div>
          </div>
        )}

        {/* Message thread */}
        {hasMessages && !convLoading && (
          <div className="max-w-2xl mx-auto px-5 pt-14 pb-4">
            {messages.map(msg => (
              <Bubble key={msg.id} msg={msg} onCopy={copy}
                onRetry={handleRetry} onSend={send} isDark={isDark} t1={t1} t2={t2} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Sticky input — active conversation */}
      {hasMessages && !convLoading && (
        <div className="shrink-0 px-4 pb-4 pt-2 border-t" style={{ borderColor: bdr, background: bg }}>
          <div className="max-w-2xl mx-auto">
            {/* Image attachment preview */}
            {imageAttachment && (
              <div className="flex items-center gap-3 mb-2 px-1">
                <div className="relative group/img">
                  <img src={imageAttachment.preview} alt="attachment"
                    className="h-14 w-14 rounded-xl object-cover border"
                    style={{ borderColor: bdr }} />
                  <button onClick={removeAttachment}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold"
                    style={{ background: "#dc2626" }}>×</button>
                </div>
                <span className="text-[0.75rem]" style={{ color: t2 }}>{imageAttachment.name.slice(0, 40)}</span>
              </div>
            )}
            <InputToolbar {...inputProps} placeholder="Ask Rev anything..." disabled={thinking} />
            <p className="text-center text-[0.63rem] mt-2" style={{ color: t4 }}>
              Rev Intelligence · Powered by your store data · Responses grounded in evidence
            </p>
          </div>
        </div>
      )}

      {/* Rename dialog uses the same viewport-centered mobile UX as deletion. */}
      {createPortal(
        <AnimatePresence>
          {renameModalId && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[200] flex items-center justify-center p-4">
              <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.5)" }}
                onClick={() => { if (renameStatus === "idle") setRenameModalId(null); }} />
              <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                transition={{ duration: 0.15 }}
                role="dialog" aria-modal="true" aria-labelledby="rev-rename-title"
                className="relative z-10 w-full max-w-sm rounded-2xl p-6 shadow-2xl"
                style={{ background: card, border: `1px solid ${bdr}` }}>
                <p id="rev-rename-title" className="text-[0.9rem] font-bold mb-4" style={{ color: t1 }}>Rename conversation</p>
                <form onSubmit={e => { e.preventDefault(); void submitRename(); }}>
                  <input autoFocus value={renameValue} disabled={renameStatus !== "idle"}
                    onChange={e => setRenameValue(e.target.value)}
                    onKeyDown={e => { if (e.key === "Escape" && renameStatus === "idle") setRenameModalId(null); }}
                    maxLength={100} aria-label="Conversation name"
                    className="w-full rounded-xl px-4 py-2.5 text-[0.88rem] outline-none mb-4 disabled:opacity-60"
                    style={{ background: isDark ? "#1f1f1f" : "#f3f4f6", color: t1, border: `1px solid ${bdr}` }}
                    placeholder="Conversation name" />
                  {renameError && <p role="alert" className="text-[0.78rem] mb-3 text-red-500">{renameError}</p>}
                  <div className="flex gap-2 justify-end">
                    <button type="button" disabled={renameStatus !== "idle"}
                      onClick={() => setRenameModalId(null)}
                      className="px-4 py-2 rounded-xl text-[0.82rem] font-medium disabled:opacity-50"
                      style={{ color: t2, background: isDark ? "#1f1f1f" : "#f3f4f6", fontFamily: "inherit" }}>
                      Cancel
                    </button>
                    <button type="submit" disabled={!renameValue.trim() || renameStatus !== "idle"}
                      className="min-w-[100px] px-4 py-2 rounded-xl text-[0.82rem] font-bold text-white flex items-center justify-center gap-2 disabled:cursor-wait"
                      style={{ background: renameStatus === "idle" ? "#5865f2" : renameStatus === "saved" ? "#16a34a" : "#9ca3af", fontFamily: "inherit" }}>
                      {renameStatus === "saving" ? <><RefreshCw size={14} className="animate-spin" />Saving...</> : renameStatus === "saved" ? "Saved ✓" : "Save"}
                    </button>
                  </div>
                </form>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Delete confirmation is portaled to the viewport to avoid transformed sidebar offsets on mobile. */}
      {createPortal(
        <AnimatePresence>
          {deleteConfirmId && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[200] flex items-center justify-center p-4"
              role="presentation">
              <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.5)" }}
                onClick={() => { if (!deletingConvId) { setDeleteConfirmId(null); setDeleteError(null); } }} />
              <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                transition={{ duration: 0.15 }}
                role="alertdialog" aria-modal="true" aria-labelledby="rev-delete-title"
                aria-describedby="rev-delete-description"
                className="relative z-10 w-full max-w-sm rounded-2xl p-6 shadow-2xl"
                style={{ background: card, border: `1px solid ${bdr}` }}>
                <p id="rev-delete-title" className="text-[0.9rem] font-bold mb-2" style={{ color: t1 }}>Delete conversation?</p>
                <p id="rev-delete-description" className="text-[0.82rem] mb-6" style={{ color: t2 }}>
                  This conversation will be permanently deleted and cannot be recovered.
                </p>
                {deleteError && <p role="alert" className="text-[0.78rem] mb-3 text-red-500">{deleteError}</p>}
                <div className="flex gap-2 justify-end">
                  <button type="button" disabled={!!deletingConvId}
                    onClick={() => { setDeleteConfirmId(null); setDeleteError(null); }}
                    className="px-4 py-2 rounded-xl text-[0.82rem] font-medium disabled:opacity-50"
                    style={{ color: t2, background: isDark ? "#1f1f1f" : "#f3f4f6", fontFamily: "inherit" }}>
                    Cancel
                  </button>
                  <button type="button" disabled={!!deletingConvId}
                    onClick={() => deleteConv(deleteConfirmId)}
                    className="min-w-[98px] px-4 py-2 rounded-xl text-[0.82rem] font-bold text-white flex items-center justify-center gap-2 disabled:cursor-wait"
                    style={{ background: deletingConvId ? "#9ca3af" : "#dc2626", fontFamily: "inherit" }}>
                    {deletingConvId ? <><RefreshCw size={14} className="animate-spin" />Deleting...</> : "Delete"}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Copy toast */}
      <AnimatePresence>
        {copied && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 rounded-full text-[0.8rem] shadow-lg"
            style={{ background: card, border: `1px solid ${bdr}`, color: t1 }}>
            <Copy size={12} />Copied
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}