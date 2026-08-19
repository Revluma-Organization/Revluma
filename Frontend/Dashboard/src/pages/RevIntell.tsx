/**
 * Rev Intell — Full-screen chat interface
 * Changes:
 * 1. Plus icon instead of Paperclip — opens dropdown with "Attach file" / "Photos & Videos"
 * 2. Image/Video icons removed — handled by Plus dropdown
 * 3. Mic + Phone moved to RIGHT side next to send button
 * 4. Chat history items have 3-dot menu (delete / rename)
 * 5. Default currency changed to $
 * 6. Loading animation replaced — modern shimmer bar instead of double orb
 * 7. Both input boxes (welcome + active) are identical
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, Plus, Menu, X, Copy, ThumbsUp, ThumbsDown,
  RotateCcw, TrendingUp, ShoppingCart, Users, BarChart2,
  Zap, RefreshCw, Mic, Phone, MoreHorizontal, Pencil, Trash2,
  FileText, ImageIcon,
} from "lucide-react";
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
  { icon: TrendingUp,   label: "Revenue Analysis",  sub: "What happened to my revenue this week?",      color: "#5865f2" },
  { icon: ShoppingCart, label: "Cart Recovery",      sub: "Which carts should I prioritise recovering?", color: "#059669" },
  { icon: Users,        label: "Churn Risk",         sub: "Which customers are about to leave?",         color: "#d97706" },
  { icon: BarChart2,    label: "Morning Briefing",   sub: "What do I need to know today?",               color: "#7c3aed" },
  { icon: Zap,          label: "Trending Products",  sub: "What's moving in my category right now?",     color: "#db2777" },
  { icon: RefreshCw,    label: "Win-back Campaign",  sub: "Draft a sequence for inactive customers.",    color: "#0891b2" },
];

// ── Demo responses ($ instead of ₦) ──────────────────────────────────────────
function getResponse(prompt: string): string {
  const p = prompt.toLowerCase();
  if (p.includes("revenue") || p.includes("week") || p.includes("briefing") || p.includes("know today"))
    return `**Situation**\nRevenue is up 9% week-over-week, driven by your Skincare category (+23%). Accessories dropped 14%.\n\n**Insight**\nThe Accessories drop correlates with a payment friction spike on Thursday evening. Three SKUs hit checkout step 4 but abandoned at payment reveal — all on mobile.\n\n**Implication**\nAt current volume this friction costs you an estimated $3,200 in recoverable revenue per day.\n\n**Recommendation**\nEnable 1-click payment link recovery for the three affected SKUs. Expected recovery: 22–28%.\n\n**Confidence: 84%** — based on 30-day baseline and your historical recovery patterns.\n\n→ Review the 3 high-abandonment SKUs\n→ Enable payment friction recovery\n→ Set alert if Accessories abandonment exceeds 70%`;
  if (p.includes("churn") || p.includes("customer") || p.includes("leave"))
    return `**Situation**\n47 customers are showing EARLY_WARNING churn signals. Combined LTV: $23,000 annual revenue.\n\n**Top 3 to act on today:**\n1. **Sarah M.** — 9 orders, $720 LTV. Purchase frequency: every 22 days → now 55 days.\n2. **James O.** — 6 orders, $480 LTV. Email open rate: 42% → 8% in 14 days.\n3. **Lisa T.** — 4 orders. Browsed 3 times this week without adding to cart.\n\n**Recommendation**\nSend Sarah a personalised re-engagement email today. No discount — she's not price-sensitive. Product recommendation converts 38% better for her segment.\n\n**Confidence: 81%**\n\n→ Draft win-back email for Sarah\n→ View all 47 at-risk customers\n→ Set up early-warning automation`;
  if (p.includes("cart") || p.includes("abandon") || p.includes("recover") || p.includes("priorit"))
    return `**Situation**\n23 abandoned carts from the last 48 hours — $18,700 in potential revenue.\n\n🔴 **Act within 2 hours:**\n• Cart #4821 — $895 — Failed payment. 1-click recovery: 68% success rate.\n• Cart #4819 — $540 — Repeat buyer reached step 4. WhatsApp reminder recommended.\n\n🟡 **Act today:**\n• 8 carts averaging $320. Price-sensitive — M5 recommends 10% offer, 24h expiry.\n\n⚪ **Monitor only:**\n• 13 carts — low abandonment score. No action yet.\n\n**Confidence: 88%**\n\n→ Send payment link to cart #4821\n→ Send WhatsApp to cart #4819\n→ Launch 10% offer sequence`;
  if (p.includes("trend") || p.includes("product"))
    return `**Situation**\nThree signals stand out in your category from the last 24 hours:\n\n1. **Vitamin C Serums** — search volume +34% in 7 days. Your top 2 competitors are out of stock.\n2. **Retinol Starter Kits** — momentum +19%. TikTok Shop driving discovery, not yet in mainstream search.\n3. **SPF 50 Tinted Moisturiser** — seasonal spike beginning. Peaked 3 weeks from now last year.\n\n**Recommendation**\nStock Vitamin C Serum before the weekend. Conservative revenue estimate: $4,500 additional.\n\n**Confidence: 79%**\n\n→ Check Vitamin C Serum inventory\n→ Set restock alert for Retinol Kits\n→ View full trending report`;
  if (p.includes("win") || p.includes("inactive") || p.includes("draft") || p.includes("sequence"))
    return `**Win-back sequence — inactive 45+ days**\n\n**Email 1 — Day 0:** Useful tip from their last purchase. No pitch. Goal: open rate.\n\n**Email 2 — Day 4:** One product recommendation based on history. Soft CTA — "Take a look."\n\n**Email 3 — Day 9:** 10% discount, 48h expiry. For LTV > $500: free shipping beats discount on margin.\n\n**Email 4 — Day 14:** Urgency close. If no response → mark churned, stop sends.\n\n**Expected win-back rate: 23–31%**\n\n**Confidence: 77%**\n\n→ Create this sequence\n→ Adjust offer amounts\n→ Target customers inactive 45+ days`;
  return `**Situation**\nI've analysed your store across revenue, cart recovery, and customer health.\n\n**Three things stand out today:**\n1. Cart abandonment rate is 71% vs your 61% monthly average — a 10-point spike.\n2. 47 customers showing early churn signals in your most valuable cohorts.\n3. A trending product opportunity with a 10–14 day window.\n\n**Recommendation**\nStart with the cart abandonment spike — fastest path to recovered revenue today.\n\n**Confidence: 76%**\n\n→ Diagnose cart abandonment spike\n→ View churn-risk customers\n→ See product intelligence report`;
}

// ── Orbit orb — used only for welcome screen & sidebar ────────────────────────
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
      <motion.div style={{ position: "absolute", inset: -size * 0.18, borderRadius: "50%",
        border: "1px solid rgba(138,110,255,0.35)", zIndex: 1, transform: "rotate3d(1,0.3,0,55deg)" }}
        animate={{ rotate: -360 }} transition={{ duration: 4.5, repeat: Infinity, ease: "linear" }}>
        <div style={{ position: "absolute", top: -2.5, left: "50%", width: 4.5, height: 4.5, borderRadius: "50%",
          background: "#b89fff", transform: "translateX(-50%)", boxShadow: "0 0 6px rgba(138,110,255,0.9)" }} />
      </motion.div>
    </div>
  );
}

// ── Small orb — avatar only, NO rings ────────────────────────────────────────
function OrbAvatar() {
  return (
    <motion.img src={revIntellLogo} alt="Rev"
      style={{ width: 28, height: 28, objectFit: "contain", flexShrink: 0,
        filter: "drop-shadow(0 0 5px rgba(100,160,255,0.7))" }}
      animate={{ scale: [1, 1.05, 1] }}
      transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }} />
  );
}

// ── Modern loading bar animation ──────────────────────────────────────────────
function LoadingBar({ isDark }: { isDark: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4, paddingBottom: 4 }}>
      {[0.85, 0.65, 0.45].map((w, i) => (
        <motion.div key={i}
          style={{ height: 10, borderRadius: 999, background: isDark ? "#1f2937" : "#e5e7eb",
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

// ── Plus attachment dropdown ──────────────────────────────────────────────────
function AttachMenu({ isDark, onFile, onMedia, card, border, t1, t2 }:
  { isDark: boolean; onFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onMedia: (e: React.ChangeEvent<HTMLInputElement>) => void;
    card: string; border: string; t1: string; t2: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(v => !v)}
        title="Attach"
        className="p-1.5 rounded-lg transition-colors opacity-60 hover:opacity-100"
        style={{ color: t2 }}>
        <Plus size={17} />
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 6, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              style={{ position: "absolute", bottom: "calc(100% + 8px)", left: 0, zIndex: 20,
                background: card, border: `1px solid ${border}`,
                borderRadius: 14, boxShadow: "0 8px 32px rgba(0,0,0,0.15)", padding: "6px", minWidth: 180 }}>
              <label onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-[0.8rem] font-medium cursor-pointer transition-colors hover:bg-black/5"
                style={{ color: t1 }}>
                <FileText size={15} style={{ color: "#5865f2" }} />
                Attach file
                <input type="file" accept="*/*" className="hidden" onChange={onFile} />
              </label>
              <label onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-[0.8rem] font-medium cursor-pointer transition-colors hover:bg-black/5"
                style={{ color: t1 }}>
                <ImageIcon size={15} style={{ color: "#db2777" }} />
                Photos & Videos
                <input type="file" accept="image/*,video/*" className="hidden" onChange={onMedia} />
              </label>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Shared input toolbar ──────────────────────────────────────────────────────
function InputToolbar({
  inputRef, value, onChange, onKeyDown, placeholder, disabled,
  onSend, onFile, onMedia, onVoice, onCall, thinking,
  card, border, t1, t2, t4, isDark,
}: {
  inputRef: React.RefObject<HTMLTextAreaElement>;
  value: string; onChange: React.ChangeEventHandler<HTMLTextAreaElement>;
  onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement>;
  placeholder: string; disabled?: boolean;
  onSend: () => void;
  onFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onMedia: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onVoice: () => void; onCall: () => void;
  thinking: boolean;
  card: string; border: string; t1: string; t2: string; t4: string; isDark: boolean;
}) {
  return (
    <div className="rounded-2xl shadow-sm overflow-visible" style={{ background: card, border: `1px solid ${border}` }}>
      <textarea ref={inputRef} value={value} onChange={onChange} onKeyDown={onKeyDown}
        placeholder={placeholder} rows={2} disabled={disabled}
        className="w-full bg-transparent text-[0.9rem] outline-none resize-none px-5 pt-4 pb-2 max-h-36 [scrollbar-width:none] leading-relaxed"
        style={{ color: t1, minHeight: 26 }} />
      <div className="flex items-center justify-between px-3 pb-3">
        {/* LEFT — Plus dropdown only */}
        <AttachMenu isDark={isDark} onFile={onFile} onMedia={onMedia} card={card} border={border} t1={t1} t2={t2} />

        {/* RIGHT — Mic + Phone + Send */}
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

// ── Message bubble ─────────────────────────────────────────────────────────────
function Bubble({ msg, onCopy, isDark }: { msg: Message; onCopy: (t: string) => void; isDark: boolean }) {
  const isRev = msg.role === "rev";
  const t1 = isDark ? "#fff" : "#1a1a2e";
  const t2 = isDark ? "#9ca3af" : "#4a5568";

  const render = (text: string) => text.split("\n").map((line, i) => {
    if (!line.trim()) return <div key={i} className="h-1.5" />;
    if (line.startsWith("→ ")) return (
      <button key={i} className="flex items-center gap-2 mt-2 text-[0.78rem] font-semibold px-3.5 py-2 rounded-xl w-fit transition-colors"
        style={{ background: "rgba(88,101,242,0.1)", color: "#5865f2", border: "1px solid rgba(88,101,242,0.25)" }}>
        <Zap size={11} />{line.slice(2)}
      </button>
    );
    const html = line.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    if (line.startsWith("🔴") || line.startsWith("🟡") || line.startsWith("⚪"))
      return <p key={i} className="font-semibold mt-3" style={{ color: t1 }} dangerouslySetInnerHTML={{ __html: html }} />;
    return <p key={i} className="leading-relaxed" style={{ color: t2 }} dangerouslySetInnerHTML={{ __html: html }} />;
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
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3 mb-7 group">
      <OrbAvatar />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[0.73rem] font-bold" style={{ color: t1 }}>Rev Intelligence</span>
          <span className="text-[0.65rem]" style={{ color: isDark ? "#374151" : "#d1d5db" }}>
            {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
        {/* Loading — modern shimmer bars instead of double orb */}
        {msg.isStreaming ? (
          <LoadingBar isDark={isDark} />
        ) : (
          <div className="text-[0.84rem] space-y-0.5">{render(msg.content)}</div>
        )}
        {!msg.isStreaming && (
          <div className="flex items-center gap-0.5 mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
            {[
              { icon: Copy,      label: "Copy",  fn: () => onCopy(msg.content) },
              { icon: ThumbsUp,  label: "Good" },
              { icon: ThumbsDown,label: "Bad"  },
              { icon: RotateCcw, label: "Retry" },
            ].map(({ icon: Icon, label, fn }) => (
              <button key={label} onClick={fn}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[0.7rem] transition-colors"
                style={{ color: isDark ? "#374151" : "#d1d5db" }}
                onMouseEnter={e => (e.currentTarget.style.color = t1)}
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

// ── Conversation history item with 3-dot menu ─────────────────────────────────
function ConvItem({ conv, isActive, onClick, onDelete, onRename, isDark, t1, t4 }:
  { conv: Conversation; isActive: boolean; onClick: () => void;
    onDelete: () => void; onRename: () => void;
    isDark: boolean; t1: string; t4: string }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="relative group/item flex items-center rounded-lg transition-all"
      style={{
        background: isActive ? (isDark ? "rgba(88,101,242,0.15)" : "rgba(88,101,242,0.08)") : "transparent",
      }}
      onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)"; }}
      onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
      <button onClick={onClick} className="flex-1 text-left px-3 py-2.5 text-[0.8rem] font-medium truncate min-w-0"
        style={{ color: isActive ? "#5865f2" : t1 }}>
        {conv.title}
      </button>
      {/* 3-dot menu */}
      <div className="opacity-0 group-hover/item:opacity-100 transition-opacity shrink-0 pr-1">
        <button onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}
          className="p-1 rounded-md opacity-60 hover:opacity-100 transition-opacity" style={{ color: t1 }}>
          <MoreHorizontal size={14} />
        </button>
      </div>
      <AnimatePresence>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-[60]" onClick={() => setMenuOpen(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.12 }}
              style={{ position: "absolute", right: 4, top: "calc(100% + 4px)", zIndex: 70,
                background: isDark ? "#1a1a1a" : "#fff",
                border: `1px solid ${isDark ? "#2a2a2a" : "#e5e7eb"}`,
                borderRadius: 10, padding: 4, minWidth: 140,
                boxShadow: "0 8px 24px rgba(0,0,0,0.15)" }}>
              <button onClick={() => { onRename(); setMenuOpen(false); }}
                className="flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-[0.78rem] font-medium transition-colors hover:bg-black/5 text-left"
                style={{ color: isDark ? "#e5e7eb" : "#1a1a2e" }}>
                <Pencil size={13} style={{ color: "#5865f2" }} />Rename
              </button>
              <button onClick={() => { onDelete(); setMenuOpen(false); }}
                className="flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-[0.78rem] font-medium transition-colors hover:bg-red-50 text-left"
                style={{ color: "#dc2626" }}>
                <Trash2 size={13} />Delete
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
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

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);
  const messages  = conversations.find(c => c.id === activeId)?.messages ?? [];

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, thinking]);

  const newChat = useCallback(() => {
    setActiveId(null); setMenuOpen(false); setInput("");
    setTimeout(() => inputRef.current?.focus(), 60);
  }, []);

  const send = useCallback(async (text: string) => {
    if (!text.trim() || thinking) return;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";

    const userMsg: Message = { id: `u${Date.now()}`, role: "user", content: text.trim(), timestamp: new Date() };
    let cid = activeId;

    if (!cid) {
      cid = `c${Date.now()}`;
      setConversations(prev => [{ id: cid!, title: text.slice(0, 42) + (text.length > 42 ? "…" : ""), date: "today", messages: [userMsg] }, ...prev]);
      setActiveId(cid);
    } else {
      setConversations(prev => prev.map(c => c.id === cid ? { ...c, messages: [...c.messages, userMsg] } : c));
    }

    setThinking(true);
    const sid = `r${Date.now()}`;
    setConversations(prev => prev.map(c => c.id === cid
      ? { ...c, messages: [...c.messages, { id: sid, role: "rev", content: "", timestamp: new Date(), isStreaming: true }] } : c));

    await new Promise(r => setTimeout(r, 1500 + Math.random() * 700));

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

  const handleFile  = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    send(`[Attached file: ${f.name.length > 28 ? f.name.slice(0, 25) + "…" : f.name}]`);
    e.target.value = "";
  };
  const handleMedia = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    send(`[Attached media: ${f.name.length > 28 ? f.name.slice(0, 25) + "…" : f.name}]`);
    e.target.value = "";
  };
  const handleVoice = () => alert("Voice messages coming soon. Rev will be able to listen to your audio briefings.");
  const handleCall  = () => alert("Audio call booking coming soon. You'll be able to schedule a live session with Rev Intelligence.");

  const deleteConv = (id: string) => {
    setConversations(prev => prev.filter(c => c.id !== id));
    if (activeId === id) setActiveId(null);
  };
  const renameConv = (id: string) => {
    const conv = conversations.find(c => c.id === id);
    if (!conv) return;
    const newTitle = window.prompt("Rename conversation:", conv.title);
    if (newTitle?.trim()) setConversations(prev => prev.map(c => c.id === id ? { ...c, title: newTitle.trim() } : c));
  };

  // Theme
  const bg   = isDark ? "#111"    : "#f7f8fc";
  const card = isDark ? "#171717" : "#ffffff";
  const bdr  = isDark ? "#222"    : "#e8eaf0";
  const t1   = isDark ? "#fff"    : "#1a1a2e";
  const t2   = isDark ? "#9ca3af" : "#6b7280";
  const t4   = isDark ? "#374151" : "#d1d5db";

  const commonInputProps = {
    inputRef, value: input, onChange: resize, onKeyDown: handleKey,
    onSend: () => send(input), onFile: handleFile, onMedia: handleMedia,
    onVoice: handleVoice, onCall: handleCall, thinking,
    card, border: bdr, t1, t2, t4, isDark,
  };

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

      {/* Glassmorphic sidebar */}
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

              {/* Header */}
              <div className="flex items-center justify-between px-5 pt-5 pb-4"
                style={{ borderBottom: `1px solid ${isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"}` }}>
                <div className="flex items-center gap-2.5">
                  <img src={revIntellLogo} alt="Rev" className="w-6 h-6 object-contain"
                    style={{ filter: "drop-shadow(0 0 5px rgba(100,160,255,0.6))" }} />
                  <span className="text-[0.88rem] font-bold" style={{ color: t1 }}>Rev Intell</span>
                </div>
                <button onClick={() => setMenuOpen(false)} className="p-1 rounded-lg opacity-50 hover:opacity-100 transition-opacity" style={{ color: t1 }}>
                  <X size={16} />
                </button>
              </div>

              {/* New chat */}
              <div className="px-4 pt-4 pb-3">
                <button onClick={newChat}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[0.84rem] font-bold text-white"
                  style={{ background: "linear-gradient(135deg,#5865f2,#4a55e8)", boxShadow: "0 4px 14px rgba(88,101,242,0.3)" }}>
                  <Plus size={16} />New chat
                </button>
              </div>

              {/* History with 3-dot menus */}
              <div className="flex-1 overflow-y-auto px-3 pb-4 [scrollbar-width:none]">
                {[
                  { label: "Today",      items: conversations.filter(c => c.date === "today") },
                  { label: "Yesterday",  items: conversations.filter(c => c.date === "yesterday") },
                  { label: "7 days ago", items: conversations.filter(c => c.date === "7days") },
                ].filter(g => g.items.length > 0).map(group => (
                  <div key={group.label} className="mb-4">
                    <p className="px-2 py-1.5 text-[0.62rem] font-bold uppercase tracking-[0.1em]" style={{ color: t4 }}>
                      {group.label}
                    </p>
                    {group.items.map(conv => (
                      <ConvItem key={conv.id} conv={conv} isActive={activeId === conv.id}
                        onClick={() => { setActiveId(conv.id); setMenuOpen(false); }}
                        onDelete={() => deleteConv(conv.id)}
                        onRename={() => renameConv(conv.id)}
                        isDark={isDark} t1={t1} t4={t4} />
                    ))}
                  </div>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Scrollable chat */}
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-start min-h-full px-6 pt-16 pb-6 max-w-2xl mx-auto w-full">
            <motion.div initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5 }} className="mb-6">
              <OrbHero size={90} />
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }} className="text-center mb-8">
              <h2 className="text-[1.55rem] font-bold mb-1" style={{ color: "#5865f2" }}>Hello, {firstName}</h2>
              <h3 className="text-[1.75rem] font-extrabold tracking-tight mb-3" style={{ color: t1 }}>
                How can I help your revenue today?
              </h3>
              <p className="text-[0.88rem] max-w-md mx-auto leading-relaxed" style={{ color: t2 }}>
                I monitor your store 24/7, detect opportunities before your competitors,
                and tell you exactly what action to take.
              </p>
            </motion.div>

            {/* Input — identical to active conversation */}
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }} className="w-full mb-7">
              <InputToolbar {...commonInputProps} placeholder="Ask me anything about your business…" />
            </motion.div>

            {/* Starter cards */}
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
        ) : (
          <div className="max-w-2xl mx-auto px-5 pt-14 pb-4">
            {messages.map(msg => <Bubble key={msg.id} msg={msg} onCopy={copy} isDark={isDark} />)}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Sticky input — active conversation */}
      {messages.length > 0 && (
        <div className="shrink-0 px-4 pb-4 pt-2 border-t" style={{ borderColor: bdr, background: bg }}>
          <div className="max-w-2xl mx-auto">
            <InputToolbar {...commonInputProps} placeholder="Ask Rev anything…" disabled={thinking} />
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
            style={{ background: card, border: `1px solid ${bdr}`, color: t1 }}>
            <Copy size={12} />Copied
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}