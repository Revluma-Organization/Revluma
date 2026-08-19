/**
 * Rev Intell — Full-screen chat interface
 * - No persistent sidebar
 * - Hamburger top-right → glassmorphic overlay with New Chat + history only
 * - No topbar — just the menu icon
 * - Full height, fully scrollable
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, Plus, Menu, X, Copy, ThumbsUp, ThumbsDown,
  RotateCcw, TrendingUp, ShoppingCart, Users, BarChart2,
  Zap, RefreshCw, Paperclip,
} from "lucide-react";
import { cn } from "@/lib/utils";
import revIntellLogo from "@/assets/images/rev-intell-logo.png";
import { useAuth } from "@/context/AuthContext";
import { useThemeStore } from "@/store";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Message {
  id: string;
  role: "user" | "rev";
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}
interface Conversation {
  id: string;
  title: string;
  date: "today" | "yesterday" | "7days";
  messages: Message[];
}

// ── Starter prompts ───────────────────────────────────────────────────────────
const STARTERS = [
  { icon: TrendingUp,   label: "Revenue Analysis",   sub: "What happened to my revenue this week?",       color: "#5865f2" },
  { icon: ShoppingCart, label: "Cart Recovery",       sub: "Which carts should I prioritise recovering?",  color: "#059669" },
  { icon: Users,        label: "Churn Risk",          sub: "Which customers are about to leave?",          color: "#d97706" },
  { icon: BarChart2,    label: "Morning Briefing",    sub: "What do I need to know today?",                color: "#7c3aed" },
  { icon: Zap,          label: "Trending Products",   sub: "What's moving in my category right now?",      color: "#db2777" },
  { icon: RefreshCw,    label: "Win-back Campaign",   sub: "Draft a sequence for inactive customers.",     color: "#0891b2" },
];

// ── Demo responses ────────────────────────────────────────────────────────────
function getResponse(prompt: string): string {
  const p = prompt.toLowerCase();
  if (p.includes("revenue") || p.includes("week") || p.includes("briefing") || p.includes("know today"))
    return `**Situation**\nRevenue is up 9% week-over-week, driven by your Skincare category (+23%). Accessories dropped 14%.\n\n**Insight**\nThe Accessories drop correlates with a payment friction spike on Thursday evening. Three SKUs hit checkout step 4 but abandoned at payment reveal — all on mobile.\n\n**Implication**\nAt current volume this friction costs you an estimated ₦3,200 in recoverable revenue per day.\n\n**Recommendation**\nEnable 1-click payment link recovery for the three affected SKUs. Expected recovery: 22–28%.\n\n**Confidence: 84%** — based on 30-day baseline and your historical recovery patterns.\n\n→ Review the 3 high-abandonment SKUs\n→ Enable payment friction recovery\n→ Set alert if Accessories abandonment exceeds 70%`;
  if (p.includes("churn") || p.includes("customer") || p.includes("leave"))
    return `**Situation**\n47 customers are showing EARLY_WARNING churn signals. Combined LTV: ₦2.3M annual revenue.\n\n**Top 3 to act on today:**\n1. **Ngozi F.** — 9 orders, ₦72,000 LTV. Purchase frequency: every 22 days → now 55 days.\n2. **Adaeze O.** — 6 orders, ₦48,000 LTV. Email open rate: 42% → 8% in 14 days.\n3. **Tunde B.** — 4 orders. Browsed 3 times this week without adding to cart.\n\n**Recommendation**\nSend Ngozi a personalised re-engagement email today. No discount — she's not price-sensitive. Product recommendation converts 38% better for her segment.\n\n**Confidence: 81%**\n\n→ Draft win-back email for Ngozi\n→ View all 47 at-risk customers\n→ Set up early-warning automation`;
  if (p.includes("cart") || p.includes("abandon") || p.includes("recover") || p.includes("priorit"))
    return `**Situation**\n23 abandoned carts from the last 48 hours — ₦1.87M in potential revenue.\n\n🔴 **Act within 2 hours:**\n• Cart #4821 — ₦89,500 — Failed payment. 1-click recovery: 68% success rate.\n• Cart #4819 — ₦54,000 — Repeat buyer reached step 4. WhatsApp reminder recommended.\n\n🟡 **Act today:**\n• 8 carts averaging ₦32,000. Price-sensitive — M5 recommends 10% offer, 24h expiry.\n\n⚪ **Monitor only:**\n• 13 carts — low abandonment score. No action yet.\n\n**Confidence: 88%**\n\n→ Send payment link to cart #4821\n→ Send WhatsApp to cart #4819\n→ Launch 10% offer sequence`;
  if (p.includes("trend") || p.includes("product"))
    return `**Situation**\nThree signals stand out in your category from the last 24 hours:\n\n1. **Vitamin C Serums** — search volume +34% in 7 days. Your top 2 competitors are out of stock.\n2. **Retinol Starter Kits** — momentum +19%. TikTok Shop driving discovery, not yet in mainstream search.\n3. **SPF 50 Tinted Moisturiser** — seasonal spike beginning. Peaked 3 weeks from now last year.\n\n**Recommendation**\nStock Vitamin C Serum before the weekend. Conservative revenue estimate: ₦450,000 additional.\n\n**Confidence: 79%**\n\n→ Check Vitamin C Serum inventory\n→ Set restock alert for Retinol Kits\n→ View full trending report`;
  if (p.includes("win") || p.includes("inactive") || p.includes("draft") || p.includes("sequence"))
    return `**Win-back sequence — inactive 45+ days**\n\n**Email 1 — Day 0:** Useful tip from their last purchase. No pitch. Goal: open rate.\n\n**Email 2 — Day 4:** One product recommendation based on history. Soft CTA — "Take a look."\n\n**Email 3 — Day 9:** 10% discount, 48h expiry. For LTV > ₦50K: free shipping beats discount on margin.\n\n**Email 4 — Day 14:** Urgency close. If no response → mark churned, stop sends.\n\n**Expected win-back rate: 23–31%**\n\n**Confidence: 77%**\n\n→ Create this sequence\n→ Adjust offer amounts\n→ Target customers inactive 45+ days`;
  return `**Situation**\nI've analysed your store across revenue, cart recovery, and customer health.\n\n**Three things stand out today:**\n1. Cart abandonment rate is 71% vs your 61% monthly average — a 10-point spike.\n2. 47 customers showing early churn signals in your most valuable cohorts.\n3. A trending product opportunity with a 10–14 day window.\n\n**Recommendation**\nStart with the cart abandonment spike — fastest path to recovered revenue today.\n\n**Confidence: 76%**\n\n→ Diagnose cart abandonment spike\n→ View churn-risk customers\n→ See product intelligence report`;
}

// ── Orbit orb ─────────────────────────────────────────────────────────────────
function ThinkingOrb({ size = 52 }: { size?: number }) {
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <motion.img src={revIntellLogo} alt="Rev"
        style={{ width: "100%", height: "100%", objectFit: "contain", position: "relative", zIndex: 2,
          filter: "drop-shadow(0 0 10px rgba(100,160,255,0.9)) drop-shadow(0 0 20px rgba(88,101,242,0.6))" }}
        animate={{ scale: [1, 1.08, 1] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }} />
      <motion.div style={{ position: "absolute", inset: -size * 0.32, borderRadius: "50%",
        border: "1.5px solid rgba(100,160,255,0.55)", zIndex: 1 }}
        animate={{ rotate: 360 }} transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}>
        <div style={{ position: "absolute", top: "50%", right: -3.5, width: 6, height: 6, borderRadius: "50%",
          background: "#7eb8ff", transform: "translateY(-50%)", boxShadow: "0 0 8px rgba(100,160,255,0.9)" }} />
      </motion.div>
      <motion.div style={{ position: "absolute", inset: -size * 0.2, borderRadius: "50%",
        border: "1px solid rgba(138,110,255,0.4)", zIndex: 1, transform: "rotate3d(1,0.3,0,55deg)" }}
        animate={{ rotate: -360 }} transition={{ duration: 3.8, repeat: Infinity, ease: "linear" }}>
        <div style={{ position: "absolute", top: -3, left: "50%", width: 5, height: 5, borderRadius: "50%",
          background: "#b89fff", transform: "translateX(-50%)", boxShadow: "0 0 6px rgba(138,110,255,0.9)" }} />
      </motion.div>
      <motion.div style={{ position: "absolute", inset: -size * 0.48, borderRadius: "50%",
        border: "1px solid rgba(88,101,242,0.15)", zIndex: 1 }}
        animate={{ rotate: 360 }} transition={{ duration: 6.5, repeat: Infinity, ease: "linear" }} />
    </div>
  );
}

// ── Message bubble ─────────────────────────────────────────────────────────────
function Bubble({ msg, onCopy, isDark }: { msg: Message; onCopy: (t: string) => void; isDark: boolean }) {
  const isRev = msg.role === "rev";
  const text1 = isDark ? "#fff" : "#1a1a2e";
  const text2 = isDark ? "#9ca3af" : "#4a5568";

  const render = (text: string) => text.split("\n").map((line, i) => {
    if (!line.trim()) return <div key={i} className="h-1.5" />;
    if (line.startsWith("→ ")) return (
      <button key={i} className="flex items-center gap-2 mt-2 text-[0.78rem] font-semibold px-3.5 py-2 rounded-xl transition-all w-fit"
        style={{ background: "rgba(88,101,242,0.1)", color: "#5865f2", border: "1px solid rgba(88,101,242,0.25)" }}>
        <Zap size={11} />{line.slice(2)}
      </button>
    );
    const html = line.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    if (line.startsWith("🔴") || line.startsWith("🟡") || line.startsWith("⚪"))
      return <p key={i} className="font-semibold mt-3" style={{ color: text1 }} dangerouslySetInnerHTML={{ __html: html }} />;
    return <p key={i} className="leading-relaxed" style={{ color: text2 }} dangerouslySetInnerHTML={{ __html: html }} />;
  });

  if (!isRev) return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end mb-5">
      <div className="max-w-[72%] px-4 py-3 rounded-2xl rounded-tr-md text-[0.86rem] leading-relaxed text-white"
        style={{ background: "linear-gradient(135deg,#5865f2,#4a55e8)" }}>
        {msg.content}
      </div>
    </motion.div>
  );

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex gap-4 mb-7 group">
      <div className="shrink-0 mt-0.5"><ThinkingOrb size={28} /></div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[0.73rem] font-bold" style={{ color: text1 }}>Rev Intelligence</span>
          <span className="text-[0.65rem]" style={{ color: isDark ? "#374151" : "#d1d5db" }}>
            {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
        {msg.isStreaming ? (
          <div className="flex items-center gap-4 py-1">
            <ThinkingOrb size={38} />
            <span className="text-[0.82rem]" style={{ color: text2 }}>Analysing your business data…</span>
          </div>
        ) : (
          <div className="text-[0.84rem] space-y-0.5">{render(msg.content)}</div>
        )}
        {!msg.isStreaming && (
          <div className="flex items-center gap-0.5 mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
            {[
              { icon: Copy, label: "Copy", fn: () => onCopy(msg.content) },
              { icon: ThumbsUp, label: "Good" },
              { icon: ThumbsDown, label: "Bad" },
              { icon: RotateCcw, label: "Retry" },
            ].map(({ icon: Icon, label, fn }) => (
              <button key={label} onClick={fn}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[0.7rem] transition-colors"
                style={{ color: isDark ? "#374151" : "#d1d5db" }}
                onMouseEnter={e => (e.currentTarget.style.color = text1)}
                onMouseLeave={e => (e.currentTarget.style.color = isDark ? "#374151" : "#d1d5db")}>
                <Icon size={11} />{label}
              </button>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function RevIntell() {
  const { user } = useAuth();
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === "dark";
  const firstName = user?.full_name?.split(" ")[0] ?? "there";

  const [conversations, setConversations] = useState<Conversation[]>([
    { id: "d1", title: "Revenue analysis this week",  date: "today",     messages: [] },
    { id: "d2", title: "Cart recovery priorities",    date: "yesterday", messages: [] },
    { id: "d3", title: "Churn risk customers",        date: "7days",     messages: [] },
  ]);
  const [activeId,  setActiveId]  = useState<string | null>(null);
  const [input,     setInput]     = useState("");
  const [thinking,  setThinking]  = useState(false);
  const [menuOpen,  setMenuOpen]  = useState(false);
  const [copied,    setCopied]    = useState(false);

  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLTextAreaElement>(null);
  const messages   = conversations.find((c) => c.id === activeId)?.messages ?? [];

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, thinking]);

  const newChat = useCallback(() => {
    setActiveId(null);
    setMenuOpen(false);
    setInput("");
    setTimeout(() => inputRef.current?.focus(), 60);
  }, []);

  const openConv = (id: string) => { setActiveId(id); setMenuOpen(false); };

  const send = useCallback(async (text: string) => {
    if (!text.trim() || thinking) return;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";

    const userMsg: Message = { id: `u${Date.now()}`, role: "user", content: text.trim(), timestamp: new Date() };
    let cid = activeId;

    if (!cid) {
      cid = `c${Date.now()}`;
      setConversations(prev => [{
        id: cid!, title: text.slice(0, 42) + (text.length > 42 ? "…" : ""),
        date: "today", messages: [userMsg],
      }, ...prev]);
      setActiveId(cid);
    } else {
      setConversations(prev => prev.map(c => c.id === cid ? { ...c, messages: [...c.messages, userMsg] } : c));
    }

    setThinking(true);
    const sid = `r${Date.now()}`;
    setConversations(prev => prev.map(c => c.id === cid
      ? { ...c, messages: [...c.messages, { id: sid, role: "rev", content: "", timestamp: new Date(), isStreaming: true }] } : c));

    await new Promise(r => setTimeout(r, 1500 + Math.random() * 800));

    setConversations(prev => prev.map(c => c.id === cid
      ? { ...c, messages: c.messages.map(m => m.id === sid ? { ...m, content: getResponse(text), isStreaming: false } : m) } : c));
    setThinking(false);
  }, [activeId, thinking]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
  };
  const resize = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 150) + "px";
  };
  const copy = (t: string) => { navigator.clipboard.writeText(t); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  // Theme colours
  const bg      = isDark ? "#111"     : "#f7f8fc";
  const card    = isDark ? "#171717"  : "#ffffff";
  const border  = isDark ? "#222"     : "#e8eaf0";
  const t1      = isDark ? "#fff"     : "#1a1a2e";
  const t2      = isDark ? "#9ca3af"  : "#6b7280";
  const t4      = isDark ? "#374151"  : "#d1d5db";

  return (
    <div
      className="relative flex flex-col overflow-hidden"
      style={{
        height: "calc(100vh - var(--topbar-h, 64px))",
        margin: "-20px -20px 0",
        background: bg,
      }}
    >
      {/* ── Hamburger menu button — top right ── */}
      <div className="absolute top-4 right-4 z-30">
        <button
          onClick={() => setMenuOpen(v => !v)}
          className="flex items-center justify-center w-9 h-9 rounded-xl transition-all hover:opacity-80"
          style={{ background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)", color: t2 }}
          aria-label="Menu"
        >
          {menuOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {/* ── Glassmorphic sidebar overlay ── */}
      <AnimatePresence>
        {menuOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 z-40"
              style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(2px)" }}
              onClick={() => setMenuOpen(false)}
            />

            {/* Sidebar panel — slides in from right */}
            <motion.div
              initial={{ x: "100%", opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: "100%", opacity: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}
              className="absolute top-0 right-0 bottom-0 z-50 flex flex-col"
              style={{
                width: 300,
                background: isDark
                  ? "rgba(10,10,10,0.85)"
                  : "rgba(255,255,255,0.88)",
                backdropFilter: "blur(24px)",
                WebkitBackdropFilter: "blur(24px)",
                borderLeft: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}`,
                boxShadow: "-16px 0 60px rgba(0,0,0,0.25)",
              }}
            >
              {/* Sidebar header */}
              <div className="flex items-center justify-between px-5 pt-5 pb-4"
                style={{ borderBottom: `1px solid ${isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"}` }}>
                <div className="flex items-center gap-2.5">
                  <img src={revIntellLogo} alt="Rev" className="w-6 h-6 object-contain"
                    style={{ filter: "drop-shadow(0 0 6px rgba(100,160,255,0.6))" }} />
                  <span className="text-[0.88rem] font-bold" style={{ color: t1 }}>Rev Intell</span>
                </div>
                <button onClick={() => setMenuOpen(false)} className="p-1 rounded-lg opacity-50 hover:opacity-100 transition-opacity" style={{ color: t1 }}>
                  <X size={16} />
                </button>
              </div>

              {/* New chat button */}
              <div className="px-4 pt-4 pb-3">
                <button onClick={newChat}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[0.84rem] font-bold text-white transition-all hover:opacity-90 active:scale-[0.98]"
                  style={{ background: "linear-gradient(135deg,#5865f2,#4a55e8)", boxShadow: "0 4px 14px rgba(88,101,242,0.35)" }}>
                  <Plus size={16} />New chat
                </button>
              </div>

              {/* History only */}
              <div className="flex-1 overflow-y-auto px-3 pb-4 [scrollbar-width:none]">
                {[
                  { label: "Today",     items: conversations.filter(c => c.date === "today") },
                  { label: "Yesterday", items: conversations.filter(c => c.date === "yesterday") },
                  { label: "7 days ago",items: conversations.filter(c => c.date === "7days") },
                ].filter(g => g.items.length > 0).map(group => (
                  <div key={group.label} className="mb-4">
                    <p className="px-2 py-1.5 text-[0.62rem] font-bold uppercase tracking-[0.1em]" style={{ color: t4 }}>
                      {group.label}
                    </p>
                    {group.items.map(conv => (
                      <button key={conv.id} onClick={() => openConv(conv.id)}
                        className="w-full text-left px-3 py-2.5 rounded-lg text-[0.8rem] font-medium transition-all"
                        style={{
                          color: activeId === conv.id ? "#5865f2" : t1,
                          background: activeId === conv.id
                            ? (isDark ? "rgba(88,101,242,0.15)" : "rgba(88,101,242,0.08)")
                            : "transparent",
                        }}
                        onMouseEnter={e => { if (activeId !== conv.id) (e.currentTarget as HTMLElement).style.background = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)"; }}
                        onMouseLeave={e => { if (activeId !== conv.id) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                      >
                        {conv.title}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Scrollable chat area ── */}
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
        {messages.length === 0 ? (
          /* Welcome screen */
          <div className="flex flex-col items-center justify-start min-h-full px-6 pt-16 pb-6 max-w-2xl mx-auto w-full">
            {/* Orb */}
            <motion.div initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5 }} className="mb-6">
              <ThinkingOrb size={90} />
            </motion.div>

            {/* Greeting */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.45 }} className="text-center mb-8">
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

            {/* Input box */}
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }} className="w-full mb-7">
              <div className="rounded-2xl shadow-sm overflow-hidden"
                style={{ background: card, border: `1px solid ${border}` }}>
                <textarea ref={inputRef} value={input} onChange={resize} onKeyDown={handleKey}
                  placeholder="Ask me anything about your business…" rows={2}
                  className="w-full bg-transparent text-[0.9rem] outline-none resize-none px-5 pt-4 pb-2 leading-relaxed"
                  style={{ color: t1 }} />
                <div className="flex items-center justify-between px-4 pb-3">
                  <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[0.73rem] font-semibold border transition-colors"
                    style={{ color: "#5865f2", borderColor: "rgba(88,101,242,0.3)", background: "rgba(88,101,242,0.06)" }}>
                    <Zap size={11} />Quick insights
                  </button>
                  <motion.button whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.9 }}
                    onClick={() => send(input)} disabled={!input.trim()}
                    className="w-8 h-8 rounded-xl flex items-center justify-center transition-all"
                    style={{ background: input.trim() ? "#5865f2" : (isDark ? "#1f1f1f" : "#e5e7eb"),
                      color: input.trim() ? "white" : t2 }}>
                    <Send size={14} />
                  </motion.button>
                </div>
              </div>
            </motion.div>

            {/* Starter cards */}
            <div className="grid grid-cols-3 gap-3 w-full">
              {STARTERS.map((s, i) => (
                <motion.button key={s.label}
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 + i * 0.05 }}
                  onClick={() => send(s.sub)}
                  className="flex flex-col items-start p-4 rounded-xl text-left transition-all hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98]"
                  style={{ background: card, border: `1px solid ${border}` }}>
                  <s.icon size={18} className="mb-2.5" style={{ color: s.color }} />
                  <p className="text-[0.78rem] font-bold mb-1" style={{ color: t1 }}>{s.label}</p>
                  <p className="text-[0.7rem] leading-snug" style={{ color: t2 }}>{s.sub}</p>
                </motion.button>
              ))}
            </div>
          </div>
        ) : (
          /* Message thread */
          <div className="max-w-2xl mx-auto px-5 pt-14 pb-4">
            {messages.map(msg => (
              <Bubble key={msg.id} msg={msg} onCopy={copy} isDark={isDark} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* ── Sticky input bar — only shown during active conversation ── */}
      {messages.length > 0 && (
        <div className="shrink-0 px-4 pb-4 pt-2 border-t" style={{ borderColor: border, background: bg }}>
          <div className="max-w-2xl mx-auto">
            <div className="rounded-2xl shadow-sm overflow-hidden"
              style={{ background: card, border: `1px solid ${border}` }}>
              <textarea ref={inputRef} value={input} onChange={resize} onKeyDown={handleKey}
                placeholder="Ask Rev anything…" rows={1} disabled={thinking}
                className="w-full bg-transparent text-[0.9rem] outline-none resize-none px-5 pt-3.5 pb-2 max-h-36 [scrollbar-width:none] leading-relaxed"
                style={{ color: t1, minHeight: 26 }} />
              <div className="flex items-center justify-between px-4 pb-3">
                <button className="p-1.5 rounded-lg transition-colors opacity-50 hover:opacity-100" style={{ color: t2 }}>
                  <Paperclip size={15} />
                </button>
                <motion.button whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.9 }}
                  onClick={() => send(input)} disabled={!input.trim() || thinking}
                  className="w-8 h-8 rounded-xl flex items-center justify-center transition-all"
                  style={{ background: input.trim() && !thinking ? "#5865f2" : (isDark ? "#1f1f1f" : "#e5e7eb"),
                    color: input.trim() && !thinking ? "white" : t2 }}>
                  {thinking
                    ? <div className="w-3.5 h-3.5 rounded-full border-2 border-t-transparent border-current animate-spin" />
                    : <Send size={14} />}
                </motion.button>
              </div>
            </div>
            <p className="text-center text-[0.63rem] mt-2" style={{ color: t4 }}>
              Rev Intelligence · Early access · Responses are AI-generated
            </p>
          </div>
        </div>
      )}

      {/* Copy toast */}
      <AnimatePresence>
        {copied && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 rounded-full text-[0.8rem] shadow-lg"
            style={{ background: card, border: `1px solid ${border}`, color: t1 }}>
            <Copy size={12} />Copied
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}