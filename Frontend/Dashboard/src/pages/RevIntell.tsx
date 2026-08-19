/**
 * Rev Intell — Autonomous AI Business Intelligence
 * ChatGPT-like interface for Revluma's AI advisor
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, Plus, ChevronDown, TrendingUp, ShoppingCart,
  Users, BarChart2, Zap, RefreshCw, Copy, ThumbsUp,
  ThumbsDown, RotateCcw, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import revIntellLogo from "@/assets/images/rev-intell-logo.png";

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
  lastMessage: string;
  timestamp: Date;
  messages: Message[];
}

// ── Starter prompts ───────────────────────────────────────────────────────────

const STARTERS = [
  {
    icon: TrendingUp,
    label: "Revenue analysis",
    prompt: "What happened to my revenue this week and why?",
    color: "#5865f2",
    bg: "rgba(88,101,242,0.1)",
  },
  {
    icon: ShoppingCart,
    label: "Cart recovery",
    prompt: "Which abandoned carts should I prioritise recovering today?",
    color: "#059669",
    bg: "rgba(5,150,105,0.1)",
  },
  {
    icon: Users,
    label: "Churn risk",
    prompt: "Which customers are about to churn and what should I do?",
    color: "#d97706",
    bg: "rgba(217,119,6,0.1)",
  },
  {
    icon: BarChart2,
    label: "Morning briefing",
    prompt: "Give me my morning briefing — what do I need to know today?",
    color: "#7c3aed",
    bg: "rgba(124,58,237,0.1)",
  },
  {
    icon: Zap,
    label: "Trending products",
    prompt: "What products are trending in my category right now?",
    color: "#db2777",
    bg: "rgba(219,39,119,0.1)",
  },
  {
    icon: RefreshCw,
    label: "Win-back",
    prompt: "Draft a win-back sequence for customers who haven't bought in 45 days.",
    color: "#0891b2",
    bg: "rgba(8,145,178,0.1)",
  },
];

// ── Demo response generator ───────────────────────────────────────────────────

function getDemoResponse(prompt: string): string {
  const p = prompt.toLowerCase();
  if (p.includes("revenue") || p.includes("week"))
    return `**Situation**\nRevenue is up 9% week-over-week, driven primarily by a recovery in your Skincare category (+23%). However, your Accessories category dropped 14% — that's worth watching.\n\n**Insight**\nThe Accessories drop correlates with a spike in cart abandonment on Thursday evening (78% abandonment rate vs your 61% average). Three SKUs account for 60% of that abandonment — all reached checkout but failed at the payment step.\n\n**Implication**\nIf this continues, you'll lose an estimated $3,200 in Accessories revenue this month. The payment friction issue is recoverable.\n\n**Recommendation**\nI recommend enabling a 1-click payment link recovery sequence for the three affected SKUs. Expected recovery rate: 22–28% of abandoned carts.\n\n**Confidence: 84%** — based on 30-day baseline data and your historical recovery patterns.\n\n**Actions:**\n→ Review the 3 high-abandonment SKUs\n→ Enable payment friction recovery sequence\n→ Set alert if Accessories abandonment stays above 70%`;
  if (p.includes("morning") || p.includes("briefing"))
    return `**Good morning. Here's what matters today.**\n\nRevenue yesterday: **₦2.4M** (+12% vs same day last week)\n\n**One thing needs your attention:**\nYou have 47 customers showing early churn signals — their email open rate dropped 40% in the last 14 days. This cohort is worth ₦890K in annual revenue.\n\n**What I did overnight:**\n• 3 abandoned carts recovered (₦124,500 total)\n• 1 win-back sequence triggered for a VIP customer inactive 38 days\n• Product trend alert: "Vitamin C serums" up 34% in search volume — your competitors are out of stock\n\n**Your top opportunity today:**\nStock Vitamin C Serum before the weekend. Conservative estimate: ₦450,000 in additional revenue.\n\n**Confidence: 79%**\n\n**Actions:**\n→ Review churn-risk customers (47 flagged)\n→ Check Vitamin C Serum inventory\n→ See overnight recovery report`;
  if (p.includes("churn") || p.includes("customer"))
    return `**Situation**\n47 customers are currently showing early churn signals — classified as EARLY_WARNING tier in your M4 model.\n\n**Top 3 to act on now:**\n1. **Adaeze O.** — 6 orders, ₦48,000 LTV. Last purchase: 38 days ago. Email open rate dropped from 42% to 8%.\n2. **Tunde B.** — 4 orders, ₦31,000 LTV. Visited site twice this week but didn't add to cart.\n3. **Ngozi F.** — 9 orders, ₦72,000 LTV (your highest-value at-risk customer). Purchase frequency dropped from every 22 days to 55 days.\n\n**Insight**\nNgozi is your most urgent case. A customer at her LTV tier who churns costs you ~₦180,000 in lost annual revenue.\n\n**Recommendation**\nSend a personalised re-engagement email to Ngozi today referencing her last purchase. No discount yet — she's not price-sensitive based on her history. A trust signal + product recommendation converts 38% better than a discount for her segment.\n\n**Confidence: 81%**\n\n**Actions:**\n→ Draft win-back email for Ngozi\n→ View all 47 churn-risk customers\n→ Set up automated early-warning sequence`;
  if (p.includes("cart") || p.includes("abandon"))
    return `**Situation**\nYou have 23 abandoned carts from the last 48 hours totalling ₦1.87M in potential revenue.\n\n**Prioritised recovery list:**\n\n🔴 **High priority (act within 2 hours):**\n• Cart #4821 — ₦89,500 — Failed payment (card declined). Send 1-click payment link immediately. 68% recovery probability.\n• Cart #4819 — ₦54,000 — Reached checkout step 4 (payment). Shopper has bought 3x before. Send WhatsApp reminder.\n\n🟡 **Medium priority:**\n• 8 carts averaging ₦32,000. Price-sensitive shoppers — M5 recommends 10% offer, expires in 24 hours.\n\n⚪ **Low priority:**\n• 13 carts — low abandonment probability score. Monitor only.\n\n**Recommendation**\nFocus on carts #4821 and #4819 first. Together they're ₦143,500 with a combined recovery probability above 60%.\n\n**Confidence: 88%**\n\n**Actions:**\n→ Send payment link to cart #4821\n→ Send WhatsApp to cart #4819\n→ Launch 10% offer to medium-priority group`;
  return `**Situation**\nI've analysed your store data and here's what stands out:\n\nYour overall revenue trend is positive (+11% month-over-month), but there are three areas where intelligence is needed.\n\n**Insight**\nYour cart abandonment rate (71%) is above the Revluma average for stores your size (64%). The gap is primarily in your checkout step 3 — where shipping costs are revealed. This is a convenience friction issue, not a price issue.\n\n**Implication**\nAt your current traffic volume, this friction costs you an estimated ₦340,000/month in recoverable revenue.\n\n**Recommendation**\nTest free shipping above ₦15,000 order value for 14 days. Your margin on orders above that threshold supports it. Expected impact: 8–12% reduction in step 3 abandonment.\n\n**Confidence: 76%**\n\n**Actions:**\n→ Run free shipping threshold test\n→ View full checkout abandonment funnel\n→ See margin analysis`;
}

// ── Message component ─────────────────────────────────────────────────────────

function MessageBubble({ msg, onCopy }: { msg: Message; onCopy: (text: string) => void }) {
  const isRev = msg.role === "rev";

  // Simple markdown-like rendering
  const renderContent = (text: string) => {
    return text.split("\n").map((line, i) => {
      if (line.startsWith("**") && line.endsWith("**") && line.length > 4) {
        return <p key={i} className="font-bold text-t1 mt-3 first:mt-0">{line.slice(2, -2)}</p>;
      }
      if (line.startsWith("→ ")) {
        return (
          <button key={i} className="flex items-center gap-2 mt-1.5 text-[0.78rem] font-medium px-3 py-1.5 rounded-lg border border-[#5865f2]/30 text-[#5865f2] bg-[#5865f2]/8 hover:bg-[#5865f2]/15 transition-colors w-fit">
            <Sparkles size={11} />
            {line.slice(2)}
          </button>
        );
      }
      if (line.startsWith("🔴 **") || line.startsWith("🟡 **") || line.startsWith("⚪ **")) {
        return <p key={i} className="font-semibold text-t1 mt-3">{line}</p>;
      }
      if (line.startsWith("• ") || line.startsWith("1. ") || line.startsWith("2. ") || line.startsWith("3. ")) {
        return <p key={i} className="text-t2 pl-3 mt-1">{line}</p>;
      }
      if (line.trim() === "") return <div key={i} className="h-1" />;
      return <p key={i} className="text-t2 leading-relaxed">{line}</p>;
    });
  };

  if (!isRev) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex justify-end"
      >
        <div className="max-w-[75%] rounded-2xl rounded-tr-sm bg-[#5865f2] px-4 py-3 text-white text-[0.85rem] leading-relaxed">
          {msg.content}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex gap-3 group"
    >
      {/* Rev Intell avatar */}
      <div className="shrink-0 mt-1">
        <div className="w-8 h-8 rounded-full overflow-hidden bg-[#0a0f1e] border border-[#5865f2]/30 flex items-center justify-center">
          <img src={revIntellLogo} alt="Rev" className="w-6 h-6 object-contain" />
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[0.72rem] font-bold text-t1">Rev Intelligence</span>
          <span className="text-[0.65rem] text-t4">
            {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>

        {msg.isStreaming ? (
          <div className="flex items-center gap-1.5 h-6">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-[#5865f2]"
                animate={{ scale: [1, 1.5, 1], opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.2 }}
              />
            ))}
          </div>
        ) : (
          <div className="text-[0.84rem] space-y-0.5">
            {renderContent(msg.content)}
          </div>
        )}

        {/* Message actions */}
        {!msg.isStreaming && (
          <div className="flex items-center gap-1 mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => onCopy(msg.content)}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[0.7rem] text-t3 hover:text-t1 hover:bg-bg-3 transition-colors"
            >
              <Copy size={11} />Copy
            </button>
            <button className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[0.7rem] text-t3 hover:text-t1 hover:bg-bg-3 transition-colors">
              <ThumbsUp size={11} />
            </button>
            <button className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[0.7rem] text-t3 hover:text-t1 hover:bg-bg-3 transition-colors">
              <ThumbsDown size={11} />
            </button>
            <button className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[0.7rem] text-t3 hover:text-t1 hover:bg-bg-3 transition-colors">
              <RotateCcw size={11} />Regenerate
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RevIntell() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const activeConv = conversations.find((c) => c.id === activeId) ?? null;
  const messages = activeConv?.messages ?? [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  const newConversation = useCallback(() => {
    setActiveId(null);
    setInput("");
    inputRef.current?.focus();
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isThinking) return;
    setInput("");

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text.trim(),
      timestamp: new Date(),
    };

    let convId = activeId;

    if (!convId) {
      // New conversation
      convId = `conv-${Date.now()}`;
      const newConv: Conversation = {
        id: convId,
        title: text.slice(0, 40) + (text.length > 40 ? "…" : ""),
        lastMessage: text.slice(0, 60),
        timestamp: new Date(),
        messages: [userMsg],
      };
      setConversations((prev) => [newConv, ...prev]);
      setActiveId(convId);
    } else {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? { ...c, messages: [...c.messages, userMsg], lastMessage: text.slice(0, 60), timestamp: new Date() }
            : c
        )
      );
    }

    // Show streaming indicator
    setIsThinking(true);
    const streamingId = `r-${Date.now()}`;
    const streamingMsg: Message = {
      id: streamingId,
      role: "rev",
      content: "",
      timestamp: new Date(),
      isStreaming: true,
    };

    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId ? { ...c, messages: [...c.messages, streamingMsg] } : c
      )
    );

    // Simulate AI response (replace with real API call)
    await new Promise((r) => setTimeout(r, 1400 + Math.random() * 800));

    const responseText = getDemoResponse(text);

    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId
          ? {
              ...c,
              messages: c.messages.map((m) =>
                m.id === streamingId
                  ? { ...m, content: responseText, isStreaming: false }
                  : m
              ),
            }
          : c
      )
    );
    setIsThinking(false);
  }, [activeId, isThinking]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Auto-resize textarea
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-[calc(100vh-var(--topbar-h,56px))] overflow-hidden -mx-5 -mt-5">

      {/* ── History sidebar ── */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 260, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="flex flex-col border-r border-border bg-bg-2 shrink-0 overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <img src={revIntellLogo} alt="Rev" className="w-5 h-5 object-contain" />
                <span className="text-[0.8rem] font-bold text-t1">Rev Intell</span>
              </div>
              <button
                onClick={newConversation}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[0.72rem] font-semibold bg-[#5865f2]/10 text-[#5865f2] hover:bg-[#5865f2]/20 transition-colors border border-[#5865f2]/20"
              >
                <Plus size={12} />
                New chat
              </button>
            </div>

            {/* Conversations list */}
            <div className="flex-1 overflow-y-auto py-2 [scrollbar-width:none]">
              {conversations.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 gap-2 px-4 text-center">
                  <img src={revIntellLogo} alt="Rev" className="w-10 h-10 object-contain opacity-30" />
                  <p className="text-[0.72rem] text-t4">No conversations yet</p>
                </div>
              ) : (
                <>
                  <div className="px-3 mb-1">
                    <span className="text-[0.62rem] font-bold uppercase tracking-widest text-t4">Recent</span>
                  </div>
                  {conversations.map((conv) => (
                    <button
                      key={conv.id}
                      onClick={() => setActiveId(conv.id)}
                      className={cn(
                        "w-full text-left px-3 py-2.5 mx-1 rounded-lg transition-colors group",
                        activeId === conv.id
                          ? "bg-[#5865f2]/12 border border-[#5865f2]/20"
                          : "hover:bg-bg-3"
                      )}
                      style={{ width: "calc(100% - 8px)" }}
                    >
                      <p className="text-[0.78rem] font-medium text-t1 truncate">{conv.title}</p>
                      <p className="text-[0.68rem] text-t4 truncate mt-0.5">{conv.lastMessage}</p>
                    </button>
                  ))}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Main chat area ── */}
      <div className="flex flex-col flex-1 min-w-0 bg-bg-1">

        {/* Chat topbar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="p-1.5 rounded-lg text-t3 hover:text-t1 hover:bg-bg-3 transition-colors"
            >
              <ChevronDown
                size={16}
                className="transition-transform"
                style={{ transform: sidebarOpen ? "rotate(90deg)" : "rotate(-90deg)" }}
              />
            </button>
            <div className="flex items-center gap-2">
              <img src={revIntellLogo} alt="Rev Intell" className="w-6 h-6 object-contain drop-shadow-[0_0_8px_rgba(100,160,255,0.6)]" />
              <div>
                <h1 className="text-[0.88rem] font-bold text-t1 leading-none">Rev Intelligence</h1>
                <p className="text-[0.64rem] text-t4 mt-0.5">Your autonomous AI business advisor</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-emerald-500/25 bg-emerald-500/8">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[0.65rem] font-semibold text-emerald-400">Online</span>
            </div>
            <button
              onClick={newConversation}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[0.75rem] font-semibold bg-bg-3 text-t2 hover:text-t1 border border-border hover:border-border-md transition-colors"
            >
              <Plus size={13} />
              New chat
            </button>
          </div>
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            /* ── Welcome screen ── */
            <div className="flex flex-col items-center justify-center h-full px-6 pb-8">
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5 }}
                className="text-center mb-10"
              >
                <motion.img
                  src={revIntellLogo}
                  alt="Rev Intell"
                  className="w-20 h-20 object-contain mx-auto mb-5 drop-shadow-[0_0_24px_rgba(100,160,255,0.5)]"
                  animate={{ scale: [1, 1.04, 1] }}
                  transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                />
                <h2 className="text-2xl font-bold text-t1 tracking-tight mb-2">
                  Good morning. I'm Rev.
                </h2>
                <p className="text-[0.88rem] text-t3 max-w-sm mx-auto leading-relaxed">
                  Your autonomous AI business intelligence advisor. I monitor your revenue,
                  predict what's about to happen, and tell you exactly what to do about it.
                </p>
              </motion.div>

              {/* Starter prompts */}
              <div className="grid grid-cols-2 gap-3 w-full max-w-2xl">
                {STARTERS.map((s, i) => (
                  <motion.button
                    key={s.prompt}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 + i * 0.06 }}
                    onClick={() => sendMessage(s.prompt)}
                    className="flex items-start gap-3 p-4 rounded-xl border border-border bg-bg-2 hover:border-border-md hover:bg-bg-3 transition-all text-left group"
                  >
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                      style={{ background: s.bg }}
                    >
                      <s.icon size={16} style={{ color: s.color }} />
                    </div>
                    <div>
                      <p className="text-[0.75rem] font-bold text-t1 mb-1 group-hover:text-[#5865f2] transition-colors">
                        {s.label}
                      </p>
                      <p className="text-[0.72rem] text-t3 leading-snug">{s.prompt}</p>
                    </div>
                  </motion.button>
                ))}
              </div>
            </div>
          ) : (
            /* ── Message thread ── */
            <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
              {messages.map((msg) => (
                <MessageBubble key={msg.id} msg={msg} onCopy={handleCopy} />
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* ── Input area ── */}
        <div className="shrink-0 px-4 pb-4 pt-2">
          <div className="max-w-3xl mx-auto">
            <div className="relative flex items-end gap-3 rounded-2xl border border-border bg-bg-2 px-4 py-3 focus-within:border-[#5865f2]/50 transition-colors shadow-sm">
              <textarea
                ref={inputRef}
                value={input}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                placeholder="Ask Rev anything about your business…"
                rows={1}
                disabled={isThinking}
                className="flex-1 resize-none bg-transparent text-[0.88rem] text-t1 placeholder:text-t4 outline-none leading-relaxed max-h-40 [scrollbar-width:none]"
                style={{ minHeight: 24 }}
              />
              <motion.button
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.92 }}
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || isThinking}
                className={cn(
                  "flex items-center justify-center w-9 h-9 rounded-xl transition-all shrink-0",
                  input.trim() && !isThinking
                    ? "bg-[#5865f2] text-white shadow-md shadow-[#5865f2]/30 hover:bg-[#4a55e8]"
                    : "bg-bg-3 text-t4 cursor-not-allowed"
                )}
              >
                {isThinking ? (
                  <div className="w-4 h-4 rounded-full border-2 border-t-transparent border-[#5865f2]/50 animate-spin" />
                ) : (
                  <Send size={15} />
                )}
              </motion.button>
            </div>
            <p className="text-center text-[0.65rem] text-t4 mt-2">
              Rev Intelligence is in early access · Responses are AI-generated and may not reflect live data
            </p>
          </div>
        </div>
      </div>

      {/* Copy toast */}
      <AnimatePresence>
        {copied && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 rounded-full bg-bg-2 border border-border shadow-lg text-[0.8rem] text-t1"
          >
            <Copy size={12} />Copied to clipboard
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}