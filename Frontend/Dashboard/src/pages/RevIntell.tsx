/**
 * Rev Intell — Autonomous AI Revenue Intelligence
 * UI inspired by Cortex reference — clean white sidebar, immersive chat area
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, Plus, Search, Clock, Copy, ThumbsUp, ThumbsDown,
  RotateCcw, TrendingUp, ShoppingCart, Users, BarChart2,
  Zap, RefreshCw, Paperclip, MoreHorizontal, Share2,
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
  preview: string;
  date: "today" | "yesterday" | "7days";
  messages: Message[];
}

// ── Starter prompts ───────────────────────────────────────────────────────────
const STARTERS = [
  { icon: TrendingUp,   label: "Revenue Analysis",   sub: "What happened to my revenue this week?",        color: "#5865f2" },
  { icon: ShoppingCart, label: "Cart Recovery",       sub: "Which carts should I prioritise recovering?",   color: "#059669" },
  { icon: Users,        label: "Churn Risk",          sub: "Which customers are about to leave?",           color: "#d97706" },
  { icon: BarChart2,    label: "Morning Briefing",    sub: "What do I need to know today?",                 color: "#7c3aed" },
  { icon: Zap,          label: "Trending Products",   sub: "What's moving in my category right now?",       color: "#db2777" },
  { icon: RefreshCw,    label: "Win-back Campaign",   sub: "Draft a sequence for inactive customers.",      color: "#0891b2" },
];

// ── Demo responses ────────────────────────────────────────────────────────────
function getResponse(prompt: string): string {
  const p = prompt.toLowerCase();
  if (p.includes("revenue") || p.includes("week") || p.includes("briefing") || p.includes("know today"))
    return `**Situation**\nRevenue is up 9% week-over-week, driven by your Skincare category (+23%). Accessories dropped 14% — worth investigating.\n\n**Insight**\nThe Accessories drop correlates with a payment friction spike on Thursday evening. Three SKUs hit checkout step 4 but abandoned at the payment reveal — all on mobile.\n\n**Implication**\nAt current volume, this friction costs you an estimated ₦3,200 in recoverable revenue per day.\n\n**Recommendation**\nEnable 1-click payment link recovery for the three affected SKUs. Expected recovery: 22–28% of those carts.\n\n**Confidence: 84%** — based on 30-day baseline and your historical recovery patterns.\n\n→ Review the 3 high-abandonment SKUs\n→ Enable payment friction recovery\n→ Set alert if Accessories abandonment exceeds 70%`;
  if (p.includes("churn") || p.includes("customer") || p.includes("leave"))
    return `**Situation**\n47 customers are showing EARLY_WARNING churn signals. Their combined LTV is ₦2.3M in annual revenue.\n\n**Top 3 to act on today:**\n1. **Ngozi F.** — 9 orders, ₦72,000 LTV. Purchase frequency dropped from every 22 days to 55 days.\n2. **Adaeze O.** — 6 orders, ₦48,000 LTV. Email open rate dropped 42% → 8% in 14 days.\n3. **Tunde B.** — 4 orders. Browsed 3 times this week, didn't add to cart.\n\n**Insight**\nNgozi is your highest-value at-risk customer. Churning her costs ~₦180,000 in lost annual revenue.\n\n**Recommendation**\nSend Ngozi a personalised re-engagement email today. No discount — she's not price-sensitive. A product recommendation aligned to her last purchase converts 38% better for her segment.\n\n**Confidence: 81%**\n\n→ Draft win-back email for Ngozi\n→ View all 47 at-risk customers\n→ Set up early-warning automation`;
  if (p.includes("cart") || p.includes("abandon") || p.includes("recover") || p.includes("priorit"))
    return `**Situation**\n23 abandoned carts from the last 48 hours totalling ₦1.87M in potential revenue.\n\n**Priority breakdown:**\n\n🔴 **Act within 2 hours:**\n• Cart #4821 — ₦89,500 — Failed payment. 1-click recovery link has 68% success rate.\n• Cart #4819 — ₦54,000 — Repeat buyer reached checkout step 4. WhatsApp reminder recommended.\n\n🟡 **Act today (medium priority):**\n• 8 carts averaging ₦32,000 — price-sensitive shoppers. M5 recommends 10% offer, 24h expiry.\n\n⚪ **Monitor only:**\n• 13 carts — low abandonment probability. No action needed yet.\n\n**Recommendation**\nFocus on carts #4821 and #4819 first — ₦143,500 at over 60% combined recovery probability.\n\n**Confidence: 88%**\n\n→ Send payment link to cart #4821\n→ Send WhatsApp to cart #4819\n→ Launch 10% offer sequence`;
  if (p.includes("trend") || p.includes("product") || p.includes("categor"))
    return `**Situation**\nRevluma's Product Intelligence scanned 12+ marketplaces in the last 24 hours. Three signals stand out for your category.\n\n**Trending now:**\n1. **Vitamin C Serums** — search volume +34% in 7 days. Your 2 top competitors are out of stock. Window: 10–14 days before the market rebalances.\n2. **Retinol Starter Kits** — momentum building (+19%). TikTok Shop driving discovery, not yet reflected in mainstream search.\n3. **SPF 50 Tinted Moisturiser** — seasonal spike beginning. Last year this SKU peaked 3 weeks from now.\n\n**Recommendation**\nStock Vitamin C Serum before the weekend. Conservative revenue estimate: ₦450,000 in additional sales at your current conversion rate.\n\n**Confidence: 79%** — based on marketplace velocity, competitor stock levels, and your category conversion history.\n\n→ Check Vitamin C Serum inventory\n→ Set restock alert for Retinol Kits\n→ View full trending report`;
  if (p.includes("win") || p.includes("inactive") || p.includes("draft") || p.includes("sequence"))
    return `**Win-back sequence for customers inactive 45+ days**\n\nBased on your customer data, here's what converts best for your segment:\n\n**Email 1 — Day 0 (Re-engagement, no pitch)**\nSubject: "We noticed you've been away, [name]"\nBody: Share a genuinely useful tip related to their last purchase. No discount. No pitch. Goal: open rate.\n\n**Email 2 — Day 4 (Product recommendation)**\nSubject: "You might love this"\nBody: One specific product recommendation based on their purchase history. Soft CTA — "Take a look."\n\n**Email 3 — Day 9 (Offer, if no response)**\nSubject: "We'd love to have you back — here's something for you"\nBody: 10% discount, 48-hour expiry. For LTV > ₦50K: free shipping instead of discount — margin is better.\n\n**Email 4 — Day 14 (Final)**\nSubject: "Last chance — your offer expires tonight"\nBody: Urgency close. If no response after this, mark as churned and stop sends.\n\n**Expected performance:** 23–31% win-back rate based on your historical segment data.\n\n**Confidence: 77%**\n\n→ Create this sequence\n→ Adjust offer amounts\n→ Target customers inactive 45+ days`;
  return `**Situation**\nI've analysed your store data across revenue, cart recovery, and customer health.\n\n**Three things stand out today:**\n1. Cart abandonment rate is 71% vs your 61% monthly average — a 10-point spike worth investigating.\n2. 47 customers showing early churn signals across your most valuable cohorts.\n3. A trending product opportunity in your category with a 10–14 day window.\n\n**Recommendation**\nStart with the cart abandonment spike — it's the fastest path to recovered revenue today.\n\n**Confidence: 76%**\n\n→ Diagnose cart abandonment spike\n→ View churn-risk customers\n→ See product intelligence report`;
}

// ── Orbit animation component (reused for thinking state) ─────────────────────
function ThinkingOrb({ size = 52 }: { size?: number }) {
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <motion.img
        src={revIntellLogo}
        alt="Rev thinking"
        style={{ width: "100%", height: "100%", objectFit: "contain", position: "relative", zIndex: 2,
          filter: "drop-shadow(0 0 10px rgba(100,160,255,0.9)) drop-shadow(0 0 20px rgba(88,101,242,0.6))" }}
        animate={{ scale: [1, 1.1, 1] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
      />
      {/* Ring 1 */}
      <motion.div style={{ position: "absolute", inset: -size * 0.32, borderRadius: "50%",
        border: "1.5px solid rgba(100,160,255,0.6)", zIndex: 1 }}
        animate={{ rotate: 360 }} transition={{ duration: 2.2, repeat: Infinity, ease: "linear" }}>
        <div style={{ position: "absolute", top: "50%", right: -4, width: 7, height: 7, borderRadius: "50%",
          background: "#7eb8ff", transform: "translateY(-50%)", boxShadow: "0 0 8px rgba(100,160,255,0.9)" }} />
      </motion.div>
      {/* Ring 2 */}
      <motion.div style={{ position: "absolute", inset: -size * 0.22, borderRadius: "50%",
        border: "1px solid rgba(138,110,255,0.45)", zIndex: 1, transform: "rotate3d(1,0.3,0,55deg)" }}
        animate={{ rotate: -360 }} transition={{ duration: 3.6, repeat: Infinity, ease: "linear" }}>
        <div style={{ position: "absolute", top: -4, left: "50%", width: 5, height: 5, borderRadius: "50%",
          background: "#b89fff", transform: "translateX(-50%)", boxShadow: "0 0 6px rgba(138,110,255,0.9)" }} />
      </motion.div>
      {/* Ring 3 — outermost, faint */}
      <motion.div style={{ position: "absolute", inset: -size * 0.46, borderRadius: "50%",
        border: "1px solid rgba(88,101,242,0.2)", zIndex: 1 }}
        animate={{ rotate: 360 }} transition={{ duration: 6, repeat: Infinity, ease: "linear" }}>
      </motion.div>
    </div>
  );
}

// ── Message bubble ─────────────────────────────────────────────────────────────
function MessageBubble({ msg, onCopy, theme }: { msg: Message; onCopy: (t: string) => void; theme: string }) {
  const isRev = msg.role === "rev";
  const isDark = theme === "dark";

  const renderContent = (text: string) => text.split("\n").map((line, i) => {
    if (!line.trim()) return <div key={i} className="h-1.5" />;
    if (line.startsWith("→ ")) return (
      <button key={i} onClick={() => {}}
        className="flex items-center gap-2 mt-2 text-[0.78rem] font-semibold px-3.5 py-2 rounded-xl transition-all w-fit"
        style={{ background: "rgba(88,101,242,0.1)", color: "#5865f2", border: "1px solid rgba(88,101,242,0.25)" }}>
        <Zap size={11} />{line.slice(2)}
      </button>
    );
    const bold = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    if (line.startsWith("**") && !line.slice(2).includes("**")) {
      return <p key={i} className="font-bold mt-3 first:mt-0" style={{ color: isDark ? "#fff" : "#1a1a2e" }}
        dangerouslySetInnerHTML={{ __html: bold }} />;
    }
    return <p key={i} className="leading-relaxed" style={{ color: isDark ? "#a0aec0" : "#4a5568" }}
      dangerouslySetInnerHTML={{ __html: bold }} />;
  });

  if (!isRev) return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end mb-4">
      <div className="max-w-[72%] px-4 py-3 rounded-2xl rounded-tr-md text-[0.85rem] leading-relaxed text-white"
        style={{ background: "linear-gradient(135deg, #5865f2, #4a55e8)" }}>
        {msg.content}
      </div>
    </motion.div>
  );

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex gap-4 mb-6 group">
      <div className="shrink-0 mt-1">
        <ThinkingOrb size={30} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[0.73rem] font-bold" style={{ color: isDark ? "#fff" : "#1a1a2e" }}>Rev Intelligence</span>
          <span className="text-[0.65rem]" style={{ color: isDark ? "#4a5568" : "#9ca3af" }}>
            {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
        {msg.isStreaming ? (
          <div className="flex items-center gap-3 py-2">
            <ThinkingOrb size={40} />
            <span className="text-[0.82rem]" style={{ color: isDark ? "#a0aec0" : "#718096" }}>
              Analysing your business data…
            </span>
          </div>
        ) : (
          <div className="text-[0.84rem] space-y-0.5">{renderContent(msg.content)}</div>
        )}
        {!msg.isStreaming && (
          <div className="flex items-center gap-0.5 mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
            {[
              { icon: Copy, label: "Copy", action: () => onCopy(msg.content) },
              { icon: ThumbsUp, label: "Good" },
              { icon: ThumbsDown, label: "Bad" },
              { icon: RotateCcw, label: "Retry" },
            ].map(({ icon: Icon, label, action }) => (
              <button key={label} onClick={action}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[0.7rem] transition-colors"
                style={{ color: isDark ? "#4a5568" : "#9ca3af" }}
                onMouseEnter={e => (e.currentTarget.style.color = isDark ? "#a0aec0" : "#1a1a2e")}
                onMouseLeave={e => (e.currentTarget.style.color = isDark ? "#4a5568" : "#9ca3af")}>
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
    { id: "demo-1", title: "Revenue analysis this week", preview: "Revenue is up 9% week-over-week...", date: "today", messages: [] },
    { id: "demo-2", title: "Cart recovery priorities", preview: "23 abandoned carts totalling...", date: "yesterday", messages: [] },
    { id: "demo-3", title: "Churn risk customers", preview: "47 customers showing early warning...", date: "7days", messages: [] },
  ]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const activeConv = conversations.find((c) => c.id === activeId) ?? null;
  const messages = activeConv?.messages ?? [];

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, isThinking]);

  const newChat = useCallback(() => { setActiveId(null); setInput(""); setTimeout(() => inputRef.current?.focus(), 50); }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isThinking) return;
    setInput("");
    if (inputRef.current) { inputRef.current.style.height = "auto"; }

    const userMsg: Message = { id: `u-${Date.now()}`, role: "user", content: text.trim(), timestamp: new Date() };
    let convId = activeId;

    if (!convId) {
      convId = `conv-${Date.now()}`;
      const newConv: Conversation = {
        id: convId,
        title: text.slice(0, 42) + (text.length > 42 ? "…" : ""),
        preview: text.slice(0, 60),
        date: "today",
        messages: [userMsg],
      };
      setConversations((prev) => [newConv, ...prev]);
      setActiveId(convId);
    } else {
      setConversations((prev) => prev.map((c) =>
        c.id === convId ? { ...c, messages: [...c.messages, userMsg] } : c));
    }

    setIsThinking(true);
    const sid = `r-${Date.now()}`;
    const streamMsg: Message = { id: sid, role: "rev", content: "", timestamp: new Date(), isStreaming: true };
    setConversations((prev) => prev.map((c) =>
      c.id === convId ? { ...c, messages: [...c.messages, streamMsg] } : c));

    await new Promise((r) => setTimeout(r, 1600 + Math.random() * 700));

    setConversations((prev) => prev.map((c) =>
      c.id === convId ? {
        ...c,
        messages: c.messages.map((m) =>
          m.id === sid ? { ...m, content: getResponse(text), isStreaming: false } : m),
      } : c));
    setIsThinking(false);
  }, [activeId, isThinking]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  };
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 150) + "px";
  };
  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const groupedConvs = {
    today:     conversations.filter((c) => c.date === "today"),
    yesterday: conversations.filter((c) => c.date === "yesterday"),
    "7days":   conversations.filter((c) => c.date === "7days"),
  };

  // Colours
  const sidebarBg  = isDark ? "#0d0d0d" : "#ffffff";
  const sidebarBdr  = isDark ? "#1f1f1f" : "#f0f0f0";
  const chatBg      = isDark ? "#111111" : "#f7f8fc";
  const cardBg      = isDark ? "#161616" : "#ffffff";
  const cardBdr     = isDark ? "#222222" : "#ebebf0";
  const textPrimary = isDark ? "#ffffff"  : "#1a1a2e";
  const textMuted   = isDark ? "#6b7280"  : "#9ca3af";
  const textSub     = isDark ? "#374151"  : "#e5e7eb";
  const inputBg     = isDark ? "#161616"  : "#ffffff";

  return (
    <div className="flex overflow-hidden" style={{ height: "calc(100vh - var(--topbar-h, 64px))", margin: "-20px -20px 0" }}>

      {/* ── Left sidebar ── */}
      <div className="flex flex-col shrink-0 border-r" style={{ width: 240, background: sidebarBg, borderColor: sidebarBdr }}>

        {/* Logo + new chat */}
        <div className="px-4 pt-5 pb-4" style={{ borderBottom: `1px solid ${sidebarBdr}` }}>
          <div className="flex items-center gap-2.5 mb-4">
            <img src={revIntellLogo} alt="Rev" className="w-6 h-6 object-contain"
              style={{ filter: "drop-shadow(0 0 6px rgba(100,160,255,0.6))" }} />
            <span className="text-[0.88rem] font-bold" style={{ color: textPrimary }}>Rev Intell</span>
          </div>
          <button onClick={newChat}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[0.82rem] font-semibold transition-all hover:opacity-90 active:scale-[0.98]"
            style={{ background: "#5865f2", color: "white" }}>
            <Plus size={15} />New chat
          </button>
        </div>

        {/* Search */}
        <div className="px-3 pt-3 pb-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: isDark ? "#1a1a1a" : "#f4f5f8" }}>
            <Search size={13} style={{ color: textMuted }} />
            <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search" className="flex-1 bg-transparent text-[0.78rem] outline-none"
              style={{ color: textPrimary }} />
            <kbd className="text-[0.6rem] px-1 rounded" style={{ background: textSub, color: textMuted }}>⌘K</kbd>
          </div>
        </div>

        {/* Nav links */}
        <div className="px-2 py-1">
          {[
            { icon: BarChart2, label: "Explore" },
            { icon: Clock,     label: "History" },
            { icon: Paperclip, label: "Files" },
          ].map(({ icon: Icon, label }) => (
            <button key={label}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[0.8rem] font-medium transition-colors hover:opacity-80"
              style={{ color: textMuted }}>
              <Icon size={14} />{label}
            </button>
          ))}
        </div>

        {/* Conversation history */}
        <div className="flex-1 overflow-y-auto px-2 py-2 [scrollbar-width:none]">
          {Object.entries({ Today: groupedConvs.today, Yesterday: groupedConvs.yesterday, "7 days ago": groupedConvs["7days"] })
            .filter(([, items]) => items.length > 0)
            .map(([label, items]) => (
              <div key={label} className="mb-3">
                <p className="px-3 py-1 text-[0.62rem] font-bold uppercase tracking-widest" style={{ color: textMuted }}>{label}</p>
                {items.map((conv) => (
                  <button key={conv.id} onClick={() => setActiveId(conv.id)}
                    className="w-full text-left px-3 py-2 rounded-lg text-[0.78rem] transition-colors"
                    style={{
                      background: activeId === conv.id ? (isDark ? "rgba(88,101,242,0.15)" : "rgba(88,101,242,0.08)") : "transparent",
                      color: activeId === conv.id ? "#5865f2" : textPrimary,
                    }}>
                    <p className="truncate font-medium">{conv.title}</p>
                  </button>
                ))}
              </div>
            ))}
        </div>

        {/* User */}
        <div className="px-4 py-3 border-t" style={{ borderColor: sidebarBdr }}>
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-[0.7rem] font-bold text-white"
              style={{ background: "linear-gradient(135deg, #5865f2, #7c3aed)" }}>
              {firstName[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[0.75rem] font-semibold truncate" style={{ color: textPrimary }}>{user?.full_name ?? "User"}</p>
              <p className="text-[0.65rem] truncate" style={{ color: textMuted }}>{user?.email ?? ""}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Main chat area ── */}
      <div className="flex flex-col flex-1 min-w-0" style={{ background: chatBg }}>

        {/* Topbar */}
        <div className="flex items-center justify-between px-5 py-3 shrink-0 border-b" style={{ background: sidebarBg, borderColor: sidebarBdr }}>
          <div className="flex items-center gap-2">
            <img src={revIntellLogo} alt="Rev" className="w-5 h-5 object-contain"
              style={{ filter: "drop-shadow(0 0 6px rgba(100,160,255,0.5))" }} />
            <span className="text-[0.84rem] font-bold" style={{ color: textPrimary }}>Rev Intell</span>
            <div className="ml-1 flex items-center gap-1 px-2 py-0.5 rounded-full"
              style={{ background: "rgba(5,150,105,0.1)", border: "1px solid rgba(5,150,105,0.2)" }}>
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[0.63rem] font-semibold text-emerald-500">Live</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="p-1.5 rounded-lg transition-colors hover:opacity-70" style={{ color: textMuted }}><MoreHorizontal size={16} /></button>
            <button className="p-1.5 rounded-lg transition-colors hover:opacity-70" style={{ color: textMuted }}><Share2 size={15} /></button>
            <button
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[0.75rem] font-bold text-white transition-all hover:opacity-90"
              style={{ background: "#5865f2" }}>
              Upgrade
            </button>
          </div>
        </div>

        {/* Messages / Welcome */}
        <div className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            /* Welcome screen */
            <div className="flex flex-col items-center justify-center h-full px-6 pb-10 max-w-2xl mx-auto w-full">
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
                className="text-center mb-8">
                <div className="flex justify-center mb-6">
                  <ThinkingOrb size={80} />
                </div>
                <h2 className="text-[1.5rem] font-bold mb-1" style={{ color: "#5865f2" }}>
                  Hello, {firstName}
                </h2>
                <h3 className="text-[1.7rem] font-bold tracking-tight" style={{ color: textPrimary }}>
                  How can I help your revenue today?
                </h3>
                <p className="text-[0.85rem] mt-2 max-w-md mx-auto" style={{ color: textMuted }}>
                  I monitor your store 24/7, detect opportunities before your competitors, and tell you exactly what action to take.
                </p>
              </motion.div>

              {/* Input - centre welcome */}
              <div className="w-full mb-8">
                <div className="rounded-2xl border shadow-sm p-3" style={{ background: inputBg, borderColor: cardBdr }}>
                  <textarea ref={inputRef} value={input} onChange={handleInput} onKeyDown={handleKey}
                    placeholder="Ask me anything about your business…" rows={2}
                    className="w-full bg-transparent text-[0.88rem] outline-none resize-none leading-relaxed placeholder:opacity-50"
                    style={{ color: textPrimary }} />
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center gap-2">
                      <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[0.73rem] font-semibold border transition-colors"
                        style={{ color: "#5865f2", borderColor: "rgba(88,101,242,0.3)", background: "rgba(88,101,242,0.06)" }}>
                        <Zap size={11} />Quick insights
                      </button>
                    </div>
                    <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.92 }}
                      onClick={() => sendMessage(input)} disabled={!input.trim()}
                      className="w-8 h-8 rounded-xl flex items-center justify-center transition-all"
                      style={{ background: input.trim() ? "#5865f2" : (isDark ? "#1f1f1f" : "#e5e7eb"), color: input.trim() ? "white" : textMuted }}>
                      <Send size={14} />
                    </motion.button>
                  </div>
                </div>
              </div>

              {/* Starter cards */}
              <div className="grid grid-cols-3 gap-3 w-full">
                {STARTERS.map((s, i) => (
                  <motion.button key={s.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 + i * 0.05 }}
                    onClick={() => sendMessage(s.sub)}
                    className="flex flex-col items-start p-4 rounded-xl text-left transition-all hover:shadow-md active:scale-[0.98]"
                    style={{ background: cardBg, border: `1px solid ${cardBdr}` }}>
                    <s.icon size={18} className="mb-2" style={{ color: s.color }} />
                    <p className="text-[0.78rem] font-bold mb-1" style={{ color: textPrimary }}>{s.label}</p>
                    <p className="text-[0.7rem] leading-snug" style={{ color: textMuted }}>{s.sub}</p>
                  </motion.button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-6 py-6">
              {messages.map((msg) => (
                <MessageBubble key={msg.id} msg={msg} onCopy={handleCopy} theme={theme} />
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input bar (active conversation) */}
        {messages.length > 0 && (
          <div className="shrink-0 px-4 pb-4 pt-2">
            <div className="max-w-3xl mx-auto">
              <div className="rounded-2xl border shadow-sm" style={{ background: inputBg, borderColor: cardBdr }}>
                <div className="px-4 pt-3 pb-2">
                  <textarea ref={inputRef} value={input} onChange={handleInput} onKeyDown={handleKey}
                    placeholder="Ask Rev anything…" rows={1} disabled={isThinking}
                    className="w-full bg-transparent text-[0.88rem] outline-none resize-none max-h-36 [scrollbar-width:none] leading-relaxed placeholder:opacity-40"
                    style={{ color: textPrimary, minHeight: 24 }} />
                </div>
                <div className="flex items-center justify-between px-3 pb-3">
                  <div className="flex items-center gap-1">
                    <button className="p-1.5 rounded-lg transition-colors hover:opacity-70" style={{ color: textMuted }}><Paperclip size={15} /></button>
                  </div>
                  <motion.button whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.9 }}
                    onClick={() => sendMessage(input)} disabled={!input.trim() || isThinking}
                    className="w-8 h-8 rounded-xl flex items-center justify-center"
                    style={{ background: input.trim() && !isThinking ? "#5865f2" : (isDark ? "#1f1f1f" : "#e5e7eb"), color: input.trim() && !isThinking ? "white" : textMuted }}>
                    {isThinking
                      ? <div className="w-3.5 h-3.5 rounded-full border-2 border-t-transparent border-current animate-spin" />
                      : <Send size={14} />}
                  </motion.button>
                </div>
              </div>
              <p className="text-center text-[0.63rem] mt-2" style={{ color: textMuted }}>
                Rev Intelligence · Early access · Responses are AI-generated
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Copy toast */}
      <AnimatePresence>
        {copied && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 rounded-full text-[0.8rem] shadow-lg"
            style={{ background: sidebarBg, border: `1px solid ${sidebarBdr}`, color: textPrimary }}>
            <Copy size={12} />Copied
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}