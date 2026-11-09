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
  useState, useRef, useEffect, useLayoutEffect, useCallback, FC,
  useMemo,
} from "react";
import { motion, AnimatePresence, MotionConfig, useReducedMotion } from "framer-motion";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { createPortal } from "react-dom";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import {
  Send, Plus, Menu, X, Copy,
  RotateCcw, TrendingUp, ShoppingCart, Users, BarChart2,
  Zap, RefreshCw, Mic, Phone, Pencil,
  Trash2, ImageIcon, AlertCircle, RefreshCcw, Square, Search,
  ThumbsUp, ThumbsDown, Volume2, ArrowLeft,
} from "lucide-react";
import { commandCenterReturnRoute } from "@/lib/workspaceNavigation";
import { explainWorkspaceError, merchantMessage } from "@/lib/workspaceCommunication";
import { workspaceDesign } from "@/lib/workspaceDesign";
import revIntellLogo from "@/assets/images/rev-intell-logo.png";
import { useAuth } from "@/context/AuthContext";
import { useThemeStore } from "@/store";
import api, { ApiError } from "@/lib/api";
import {
  UNKNOWN_STORE, buildStarters, hasWebhookGap, isSyncIncomplete, isSyncStale,
  storeContextFromResponse, storeLabel, type StoreContext, type StoreListResponse,
} from "@/lib/revStoreContext";
import RevAnswerView from "@/components/rev/RevAnswerView";
import { InvestigationTimeline } from "@/components/rev/InvestigationTimeline";
import { JumpToLatest } from "@/components/rev/JumpToLatest";
import EvidencePanel from "@/components/rev/EvidencePanel";
import { normaliseRevAnswer, coveredBy, legacyResponseToPayload, recordList, stringList, textValue } from "@/lib/revPresentation";
import RevMarkdown from "@/components/rev/RevMarkdown";
import {
  streamRevAnswer, RevStreamError,
  type RevAnswerPayload, type InvestigationStep,
} from "@/lib/revStream";

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
  /** Only a pre-persistence rejection permits replacing a local failed attempt. */
  persistence?: "persisted" | "not-persisted" | "unknown";
  imageAssisted?: boolean;
  /** Full evidence-bearing payload for this turn (streamed or rehydrated). */
  payload?:    RevAnswerPayload;
  /** Live investigation steps while the turn is streaming. */
  steps?:      InvestigationStep[];
  cancelled?:  boolean;
  /** The merchant's persisted thumbs rating for a Rev answer (ChatGPT-UI study §5). */
  feedback?:   "up" | "down" | null;
}

interface Conversation {
  id:               string;
  title:            string;
  message_count:    number;
  last_activity_at: string;
}

interface FindingContext {
  id: string;
  title: string;
  description: string;
  lifecycleState?: string;
  currentValidity?: string;
  evidenceQuality?: string;
  reportingPeriod?: { start: string | null; end: string | null; timezone: string } | null;
  confidence?: string;
  limitations?: string[];
  evidenceReferences?: string[];
}

const FINDING_ERRORS = ["INVALID_FINDING_ID", "FINDING_NOT_FOUND", "FINDING_EVIDENCE_UNVERIFIED"];
const EXPLICIT_FINDING_TOPIC_CHANGE = /\b(?:instead|new topic|different topic|leave (?:this|the) finding|unrelated question|forget (?:this|the) finding)\b/i;
const HISTORY_PAGE_SIZE = 20;
const MESSAGE_PAGE_SIZE = 50;
// Authoritative question-length bound. The backend `sanitiseMessage` caps a
// message at 2000 chars; the client enforces the SAME bound so a question is
// never submitted longer than it will be persisted (no silent truncation, no
// UI/DB inconsistency). A backend contract test asserts the two stay equal.
const MAX_QUESTION_LENGTH = 2000;

// Suggested opening questions for an empty conversation.
//
// `sub` is both the caption and the message sent to Rev, so each is written as a
// question a merchant would actually ask. Icons are restricted to those already
// imported from lucide-react above: an unimported identifier here is exactly the
// defect that made this component throw "ReferenceError: STARTERS is not defined".
//
// Every question is answerable from data Revluma is authorized to read, per the
// metric registry (python/src/intelligence/metric_registry.py). Deliberately
// absent: anything about profit or margin, because no unit-cost field exists in
// the schema and Rev must disclose that gap rather than answer a starter prompt
// with an invented figure.
const STARTERS = [
  { label: "This week",  sub: "What changed in my business this week?", icon: TrendingUp,   color: "#1F06AC" },
  { label: "Revenue",    sub: "Why did my revenue change?",             icon: Search,       color: "#2563EB" },
  { label: "Products",   sub: "Which products are underperforming?",    icon: BarChart2,    color: "#0F172A" },
  { label: "Carts",      sub: "Where are carts being abandoned?",       icon: ShoppingCart, color: "#1F06AC" },
  { label: "Customers",  sub: "Which customers buy repeatedly?",        icon: Users,        color: "#2563EB" },
  { label: "Priorities", sub: "What should I focus on first?",          icon: Zap,          color: "#0F172A" },
];

// Use the installed dialog primitive for focus trapping and background isolation.
function ModalSurface({ children, onClose, hasDescription = false, returnFocusTo, ...props }: Omit<React.ComponentProps<typeof motion.div>, "children"> & {
  children: React.ReactNode; onClose: () => void; hasDescription?: boolean; returnFocusTo?: HTMLElement | null;
}) {
  const returnTo = useRef(returnFocusTo ?? document.activeElement as HTMLElement | null);
  return <DialogPrimitive.Root open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogPrimitive.Content asChild {...(hasDescription ? {} : { "aria-describedby": undefined })}
      onCloseAutoFocus={event => {
        event.preventDefault();
        const target = returnTo.current;
        if (target?.isConnected) target.focus();
        else Array.from(document.querySelectorAll<HTMLElement>('button[aria-current="page"], button[aria-label="Open conversation history"], [data-rev-history] button'))
          .find(element => element.getClientRects().length > 0)?.focus();
      }}>
      <motion.div data-rev-modal="" {...props}><DialogPrimitive.Title className="sr-only">{props["aria-label"] || "Conversation options"}</DialogPrimitive.Title>{children}</motion.div>
    </DialogPrimitive.Content>
  </DialogPrimitive.Root>;
}

function LoadMore({ available, loading, error, onLoad, label }: {
  available: boolean; loading: boolean; error: string | null; onLoad: () => void; label: string;
}) {
  return <div className="px-3 py-2 text-xs">
    {error && <p role="alert">{error}</p>}
    {available && <button onClick={onLoad} disabled={loading}
      className="min-h-11 rounded-lg border border-current px-3 py-2"
      aria-label={error ? `Retry ${label.toLowerCase()}` : label}>
      {loading ? <span role="status">Loading…</span> : error ? 'Retry' : label}
    </button>}
  </div>;
}
function responseErrorCode(error: unknown): string | undefined {
  if (error instanceof RevStreamError) return error.code;
  if (error instanceof ApiError) {
    const body = error.body as { error?: { code?: unknown } } | undefined;
    if (typeof body?.error?.code === "string") return body.error.code;
  }
  return undefined;
}

// ── Error message mapper ──────────────────────────────────────────────────────

function cleanError(code?: string, _raw?: string): string {
  const common = explainWorkspaceError(code ? { code, status: code === "UNAUTHORIZED" ? 401 : undefined } : { status: 500 });
  const revSpecific: Record<string, string> = {
    INTELLIGENCE_AUTH_FAILED: "Rev Intelligence isn’t available right now. Your store connection has not been changed; try again shortly.",
    INTELLIGENCE_NOT_CONFIGURED: "Rev Intelligence is being set up. Check back shortly.",
    READ_ONLY: merchantMessage("read_only").body,
    NOTHING_TO_RETRY: "There is no earlier answer to retry yet.",
    INVALID_FINDING_ID: "That finding link isn’t valid. Return to Command Center and choose a current finding.",
    FINDING_NOT_FOUND: merchantMessage("not_found").body,
    FINDING_EVIDENCE_UNVERIFIED: "Revluma hasn’t verified this finding’s evidence yet, so Rev won’t treat it as fact.",
    STREAM_START_FAILED: "Rev couldn’t start this answer. Your question is preserved; try again.",
    STREAM_UNSUPPORTED: "This browser can’t receive Rev’s live answer. Use a current browser and try again.",
    VALIDATION_ERROR: merchantMessage("validation").body,
  };
  return revSpecific[code || ""] || common.body;
}


// ── Orb components ────────────────────────────────────────────────────────────

function OrbHero({ size = 90 }: { size?: number }) {
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <motion.img src={revIntellLogo} alt="Rev"
        style={{ width: "100%", height: "100%", objectFit: "contain", position: "relative", zIndex: 2,
          filter: "drop-shadow(0 0 10px rgba(100,160,255,0.9)) drop-shadow(0 0 20px rgba(31,6,172,0.6))" }}
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
        background: "radial-gradient(circle, rgba(31,6,172,0.15) 0%, transparent 70%)" }} />
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
              background: `linear-gradient(90deg, transparent 0%, ${isDark ? "rgba(31,6,172,0.5)" : "rgba(31,6,172,0.3)"} 50%, transparent 100%)` }}
            animate={{ x: ["-100%", "200%"] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut", delay: i * 0.18 }} />
        </motion.div>
      ))}
    </div>
  );
}


// ── Message bubble ────────────────────────────────────────────────────────────

function answerCopyText(message: Message): string {
  const payload = normaliseRevAnswer(message.payload ?? message.content);
  if (!payload) return textValue(message.content);
  const blocks = [textValue(payload.text)].filter(Boolean);
  let shown = blocks.join("\n\n");
  for (const key of ["situation", "insight", "implication", "recommendation"] as const) {
    const text = textValue(payload.response?.[key]);
    if (!text || coveredBy(shown, text)) continue;
    blocks.push(`${key[0].toUpperCase() + key.slice(1)}\n${text}`);
    shown += `\n${text}`;
  }
  const appendList = (label: string, values: string[]) => {
    const entries = [...new Set(values.filter(text => text.trim() && !coveredBy(shown, text)))];
    if (entries.length) blocks.push(`${label}\n${entries.map(text => `- ${text}`).join("\n")}`);
  };
  appendList("Facts", [...recordList<{ text?: unknown }>(payload.facts), ...recordList<{ text?: unknown }>(payload.comparison_facts)].map(item => textValue(item.text)));
  appendList("Hypotheses — not verified", recordList<{ statement?: unknown }>(payload.hypotheses).map(item => textValue(item.statement)));
  appendList("Unknowns and limits", stringList(payload.unknowns));
  appendList("Warnings", [...stringList(payload.warnings), ...stringList(payload.response?.warnings)]);
  const recommendations = recordList<{ label?: unknown; why?: unknown; measure?: unknown }>(payload.recommendations).flatMap(item => {
    const parts = [item.label, item.why, item.measure].map(textValue).filter(Boolean);
    return parts.length && !parts.every(text => coveredBy(shown, text)) ? [parts.join("\n")] : [];
  });
  if (recommendations.length) blocks.push(`Recommended next steps\nRecommendations only — nothing was changed or sent.\n${recommendations.join("\n\n")}`);
  return blocks.join("\n\n");
}

function Bubble({ msg, onCopy, onRetry, retryLabel, onSend, onOpenEvidence, evidenceOpen, actionsDisabled, onFeedback, speechSupported, speaking, onReadAloud, isDark, t1, t2 }: {
  msg: Message; onCopy: (t: string) => void;
  onRetry: () => void; onSend?: (text: string) => void;
  retryLabel?: string;
  actionsDisabled?: boolean;
  onOpenEvidence?: (messageId: string) => void; evidenceOpen?: boolean;
  onFeedback: (msg: Message, rating: "up" | "down") => void;
  speechSupported: boolean; speaking: boolean;
  onReadAloud: (msg: Message) => void;
  isDark: boolean; t1: string; t2: string;
}) {
  const isRev = msg.role === "rev";

  if (!isRev) return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="flex justify-end mb-5">
      <div className="max-w-[85%] sm:max-w-[72%] px-4 py-3 rounded-2xl rounded-tr-md text-[0.9rem] leading-relaxed text-white whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
        style={{ background: "linear-gradient(135deg,#1F06AC,#17057F)" }}>
        {typeof msg.content === "string" ? msg.content : ""}
      </div>
    </motion.div>
  );

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="flex gap-3 mb-7 group">
      <OrbAvatar />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[0.73rem] font-bold" style={{ color: t1 }}>Rev Intelligence</span>
            <span className="text-[0.65rem]" style={{ color: t2 }}>
            {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>

        {msg.isStreaming && <div role="status" aria-label="Rev is preparing a response"><LoadingBar isDark={isDark} /></div>}

        {msg.isStreaming && !msg.payload && msg.steps && msg.steps.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <InvestigationTimeline steps={msg.steps} streaming dark={isDark} />
          </div>
        )}

        {msg.cancelled && !msg.isStreaming && (
          <div role="status" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
            padding: "10px 12px", borderRadius: 12,
            background: isDark ? "rgba(255,255,255,0.04)" : "#F9FAFB",
            border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "#EAECF0"}` }}>
            <span style={{ fontSize: "0.82rem", color: t2 }}>Generation stopped.</span>
            <button onClick={onRetry} disabled={actionsDisabled}
              style={{ display: "inline-flex", alignItems: "center", gap: 5,
                padding: "5px 12px", borderRadius: 999, fontSize: "0.76rem", fontWeight: 600,
                background: "rgba(31,6,172,0.08)", color: isDark ? "#b4a8ff" : "#1F06AC",
                border: "1px solid rgba(31,6,172,0.2)", cursor: "pointer", fontFamily: "inherit" }}>
              <RefreshCcw size={11} />{retryLabel ?? "Regenerate"}
            </button>
          </div>
        )}

        {msg.hasError && !msg.isStreaming && (
          <div role="alert" style={{ display: "flex", alignItems: "flex-start", gap: 10,
            padding: "12px 14px", borderRadius: 12,
            background: "rgba(220,38,38,0.06)", border: "1px solid rgba(220,38,38,0.18)" }}>
            <AlertCircle size={15} color="#dc2626" style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: "0.86rem", color: isDark ? "#fca5a5" : "#b91c1c", margin: "0 0 8px", fontWeight: 600 }}>
                {typeof msg.content === "string" ? msg.content : "Rev encountered an issue."}
              </p>
              <button onClick={onRetry} disabled={actionsDisabled}
                style={{ display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "5px 12px", borderRadius: 999, fontSize: "0.78rem", fontWeight: 600,
                  background: "rgba(220,38,38,0.1)", color: isDark ? "#fca5a5" : "#b91c1c",
                  border: "1px solid rgba(220,38,38,0.25)", cursor: "pointer", fontFamily: "inherit" }}>
                <RefreshCcw size={12} />{retryLabel ?? "Try again"}
              </button>
            </div>
          </div>
        )}

        {!msg.hasError && !msg.cancelled && msg.payload && (
          <RevAnswerView
            payload={msg.payload}
            streaming={msg.isStreaming}
            dark={isDark}
            evidenceOpen={evidenceOpen}
            onOpenEvidence={() => onOpenEvidence?.(msg.id)}
            onFollowUp={actionsDisabled ? undefined : onSend}
          />
        )}

        {!msg.payload && !msg.isStreaming && !msg.hasError && !msg.cancelled && msg.content && (
          typeof msg.content === "object" && "response_type" in (msg.content as object)
            ? <RevAnswerView
                payload={legacyResponseToPayload(msg.content)}
                dark={isDark}
                evidenceOpen={evidenceOpen}
                onOpenEvidence={() => onOpenEvidence?.(msg.id)}
                onFollowUp={actionsDisabled ? undefined : onSend}
              />
            : <RevMarkdown text={String(msg.content)} tone={isDark ? "dark" : "light"} />
        )}

        {!msg.isStreaming && !msg.hasError && !msg.cancelled && (
          <div className="flex flex-wrap items-center gap-0.5 mt-3 opacity-100 transition-opacity">
            {[
              { icon: Copy,       label: "Copy",  fn: () => onCopy(answerCopyText(msg)) },
            ].map(({ icon: Icon, label, fn }) => (
              <button key={label} onClick={fn} disabled={fn === onRetry && actionsDisabled}
                className="flex min-h-11 items-center gap-1 px-2 py-1 rounded-md text-[0.7rem] transition-colors disabled:opacity-50"
                style={{ color: t2, fontFamily: "inherit" }}
                onMouseEnter={e => (e.currentTarget.style.color = t1)}
                onMouseLeave={e => (e.currentTarget.style.color = t2)}>
                <Icon size={11} />{label}
              </button>
            ))}
            {isRev && speechSupported && (
              <button
                onClick={() => onReadAloud(msg)}
                aria-label={speaking ? "Stop reading aloud" : "Read aloud"}
                title={speaking ? "Stop reading aloud" : "Read aloud"}
                className="flex min-h-11 items-center gap-1 px-2 py-1 rounded-md text-[0.7rem] transition-colors"
                style={{ color: speaking ? (isDark ? "#b4a8ff" : "#1F06AC") : t2, fontFamily: "inherit" }}
                onMouseEnter={e => (e.currentTarget.style.color = t1)}
                onMouseLeave={e => (e.currentTarget.style.color = speaking ? (isDark ? "#b4a8ff" : "#1F06AC") : t2)}>
                {speaking ? <Square size={10} /> : <Volume2 size={11} />}
                {speaking ? "Stop" : "Read aloud"}
              </button>
            )}
            {isRev && msg.payload?.message_id && ([
              { rating: "up" as const, icon: ThumbsUp, label: "Helpful" },
              { rating: "down" as const, icon: ThumbsDown, label: "Not helpful" },
            ].map(({ rating, icon: Icon, label }) => {
              const active = msg.feedback === rating;
              return (
                <button
                  key={rating}
                  onClick={() => onFeedback(msg, rating)}
                  disabled={actionsDisabled}
                  aria-label={label}
                  aria-pressed={active}
                  title={label}
                  className="flex min-h-11 items-center px-2 py-1 rounded-md text-[0.7rem] transition-colors disabled:opacity-50"
                  style={{ color: active ? (isDark ? "#b4a8ff" : "#1F06AC") : t2 }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.color = t1; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.color = t2; }}>
                  <Icon size={11} fill={active ? "currentColor" : "none"} />
                </button>
              );
            }))}
            {[
              { icon: RotateCcw,  label: retryLabel ?? "Retry", fn: onRetry },
            ].map(({ icon: Icon, label, fn }) => (
              <button key={label} onClick={fn} disabled={fn === onRetry && actionsDisabled}
                className="flex min-h-11 items-center gap-1 px-2 py-1 rounded-md text-[0.7rem] transition-colors disabled:opacity-50"
                style={{ color: t2, fontFamily: "inherit" }}
                onMouseEnter={e => (e.currentTarget.style.color = t1)}
                onMouseLeave={e => (e.currentTarget.style.color = t2)}>
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

function AttachMenu({ onFile, t1 }: {
  onFile: (event: React.ChangeEvent<HTMLInputElement>) => void; t1: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return <>
    <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={onFile} />
    <DropdownMenu>
      <DropdownMenuTrigger asChild><button aria-label="Attach image" title="Attach image"
        className="flex h-11 w-11 items-center justify-center rounded-lg" style={{ color: t1 }}><Plus size={17} /></button></DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => fileRef.current?.click()} className="min-h-11"><ImageIcon size={15} className="mr-2" />Attach image (up to 5 MB)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </>;
}

// ── Input toolbar ─────────────────────────────────────────────────────────────

function InputToolbar({ inputRef, value, onChange, onKeyDown, placeholder, disabled, sendDisabled,
  onSend, onFile, onStop, thinking, card, border, t1, t2, isDark, maxLength = MAX_QUESTION_LENGTH }: {
  inputRef: React.RefObject<HTMLTextAreaElement>;
  value: string; onChange: React.ChangeEventHandler<HTMLTextAreaElement>;
  onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement>;
  placeholder: string; disabled?: boolean; sendDisabled?: boolean; maxLength?: number;
  onSend: () => void; onFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onStop?: () => void; thinking: boolean;
  card: string; border: string; t1: string; t2: string; isDark: boolean;
}) {
  // `over` is strictly beyond the bound (the textarea maxLength normally makes
  // this unreachable; it guards the programmatic/paste edge). Exactly at the
  // bound a question is still valid, so no "shorten" warning is shown there.
  const over = value.length > maxLength;
  const nearCap = value.length > maxLength - 120;
  return (
    <div className="rounded-2xl shadow-sm overflow-visible" style={{ background: card, border: `1px solid ${over ? "#dc2626" : border}` }}>
      <textarea ref={inputRef} value={value} onChange={onChange} onKeyDown={onKeyDown}
        placeholder={placeholder} aria-label="Message Rev" rows={2} disabled={disabled}
        maxLength={maxLength}
        className="w-full bg-transparent text-[0.9rem] outline-none resize-none px-5 pt-4 pb-2 max-h-36 [scrollbar-width:none] leading-relaxed"
        style={{ color: t1, minHeight: 26 }} />
      {nearCap && (
        <p className="m-0 px-5 pb-1 text-[0.68rem] tabular-nums" aria-live="polite"
          style={{ color: over ? "#dc2626" : t2 }}>
          {value.length} / {maxLength}{over ? " — shorten to send" : ""}
        </p>
      )}
      <div className="flex items-center justify-between px-3 pb-3">
        <AttachMenu onFile={onFile} t1={t1} />
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button title="Voice messages unavailable in this release" aria-label="Voice messages unavailable in this release" disabled
            className="h-11 w-11 flex items-center justify-center rounded-lg opacity-60" style={{ color: t2 }}>
            <Mic size={15} />
          </button>
          <button title="Audio calls unavailable in this release" aria-label="Audio calls unavailable in this release" disabled
            className="p-1.5 rounded-lg transition-colors opacity-60 hover:opacity-100" style={{ color: t2 }}>
            <Phone size={15} />
          </button>
          {thinking && onStop ? (
            <motion.button whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.9 }}
              onClick={onStop} aria-label="Stop generating" title="Stop generating"
              className="w-11 h-11 rounded-xl flex items-center justify-center transition-all ml-1"
              style={{ background: isDark ? "#26262b" : "#111827", color: "#fff" }}>
              <Square size={11} fill="currentColor" />
            </motion.button>
          ) : (
            <motion.button whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.9 }}
              onClick={onSend} disabled={!value.trim() || thinking || disabled || sendDisabled}
              aria-label="Send message"
              className="h-11 w-11 rounded-xl flex items-center justify-center transition-all ml-1"
              style={{ background: value.trim() && !thinking ? "#1F06AC" : (isDark ? "#1f1f1f" : "#e5e7eb"),
                color: value.trim() && !thinking ? "white" : t2 }}>
              <Send size={14} />
            </motion.button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Conversation history item ─────────────────────────────────────────────────

function HistoryStatus({ loading, error, count, query, onRetry, color }: {
  loading: boolean; error: string | null; count: number; query: string;
  onRetry: () => void; color: string;
}) {
  return <>
    {!loading && !error && count > 0 && <p role="status" className="sr-only">{count} conversations loaded{query.trim() ? ` for ${query.trim()}` : ""}.</p>}
    {loading && <p role="status" className="px-3 py-4 text-center text-xs" style={{ color }}>Loading conversation history…</p>}
    {error && <div role="alert" className="px-3 py-4 text-center text-xs" style={{ color }}>
      <p>{error}</p>
      <button onClick={onRetry} disabled={loading} aria-label="Retry conversation history"
        className="mt-2 rounded-lg border border-current px-3 py-2 font-semibold">Retry</button>
    </div>}
    {(loading || error) && count > 0 && <p className="px-3 pb-2 text-xs" style={{ color }}>Showing previously loaded conversations.</p>}
    {!loading && !error && count === 0 && <p role="status" className="px-3 py-8 text-center text-xs" style={{ color }}>
      {query.trim() ? "No conversations match this search." : "No conversations yet."}
    </p>}
  </>;
}

// The conversation-history list, rendered only inside the modal drawer that
// the top-right menu button opens. It used to exist a second time as a
// persistent desktop rail with a hard-coded dark palette, which ignored the
// page theme and left wide screens with history permanently on screen and no
// menu button to open or dismiss it. One surface now: theme-driven colours,
// and inline row actions whose own element is the focus-return target for the
// nested rename/delete dialog.
function ConversationHistoryList({
  conversations, activeId, loading, error, onRetry, query, onQuery, onNew, onSelect,
  onRename, onDelete, pagination, isDark, t1, t2, border, onClose,
}: {
  conversations: Conversation[]; activeId: string | null; loading: boolean;
  error: string | null; onRetry: () => void;
  query: string; onQuery: (value: string) => void;
  onNew: () => void; onSelect: (id: string) => void;
  // A row action passes the element that opened it, so focus can return there
  // once the nested rename/delete dialog closes.
  onRename: (id: string, trigger: HTMLButtonElement | null) => void;
  onDelete: (id: string, trigger: HTMLButtonElement | null) => void;
  isDark: boolean; t1: string; t2: string; border: string;
  pagination?: React.ReactNode;
  onClose?: () => void;
}) {
  return (
    <div data-rev-history="" style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", minWidth: 0 }}>
      <div className="flex items-center justify-between px-5 pt-5 pb-4"
        style={{ borderBottom: `1px solid ${border}` }}>
        <div className="flex items-center gap-2.5">
          <img src={revIntellLogo} alt="" className="w-6 h-6 object-contain" />
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: "0.82rem", fontWeight: 750, color: t1 }}>Rev Intelligence</p>
            <p style={{ margin: 0, fontSize: "0.62rem", color: t2 }}>Read-only workspace</p>
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close conversation history"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg" style={{ color: t1 }}>
          <X size={16} />
        </button>
      </div>

      <div className="px-4 pt-4 pb-3">
        <button onClick={onNew}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[0.84rem] font-bold text-white transition-opacity hover:opacity-90"
          style={{ background: "linear-gradient(135deg,#1F06AC,#17057F)", boxShadow: "0 4px 14px rgba(31,6,172,0.2)" }}>
          <Plus size={16} />New conversation
        </button>
      </div>

      <div className="px-4 pb-3">
        <div className="flex items-center gap-2 rounded-xl px-3"
          style={{ background: isDark ? "#1b1b23" : "#f5f6fa", border: `1px solid ${border}` }}>
          <Search size={15} color={t2} />
          <input value={query} onChange={event => onQuery(event.target.value)}
            placeholder="Search conversations" aria-label="Search conversations"
            className="w-full min-w-0 bg-transparent py-2.5 text-[0.78rem] outline-none" style={{ color: t1 }} />
          {query && <button onClick={() => onQuery("")} aria-label="Clear search"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md" style={{ color: t2 }}>
            <X size={14} />
          </button>}
        </div>
      </div>

      <div aria-busy={loading} className="flex-1 overflow-y-auto px-2 pb-3 [scrollbar-width:thin]">
        <HistoryStatus loading={loading} error={error} count={conversations.length} query={query}
          onRetry={onRetry} color={t2} />
        {conversations.map((conversation) => {
          const active = activeId === conversation.id;
          return (
            <div key={conversation.id} className="group relative">
              <button aria-current={active ? "page" : undefined} onClick={() => onSelect(conversation.id)}
                className="w-full text-left rounded-lg pl-2.5 pr-24 py-2 transition-colors"
                style={{
                  background: active ? (isDark ? "rgba(31,6,172,0.45)" : "rgba(31,6,172,0.10)") : "transparent",
                  borderLeft: `2px solid ${active ? "#7B6BFF" : "transparent"}`,
                }}>
                <p className="truncate" style={{ margin: 0, fontSize: "0.76rem", color: active ? (isDark ? "#FFFFFF" : "#1F06AC") : t1 }}>
                  {conversation.title || "Untitled conversation"}
                </p>
                <p style={{ margin: "1px 0 0", fontSize: "0.62rem", color: t2 }}>
                  {new Date(conversation.last_activity_at).toLocaleDateString([], { month: "short", day: "numeric" })}
                  {conversation.message_count ? ` · ${conversation.message_count} messages` : ""}
                </p>
              </button>
              <div className="absolute right-1 top-1 flex gap-0.5">
                <button onClick={event => onRename(conversation.id, event.currentTarget)} aria-label="Rename conversation"
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-md"
                  style={{ background: "transparent", border: "none", color: t2, cursor: "pointer", padding: 3 }}>
                  <Pencil size={13} />
                </button>
                <button onClick={event => onDelete(conversation.id, event.currentTarget)} aria-label="Delete conversation"
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-md"
                  style={{ background: "transparent", border: "none", color: t2, cursor: "pointer", padding: 3 }}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          );
        })}
        {pagination}
      </div>

      <div className="px-5 py-3" style={{ borderTop: `1px solid ${border}` }}>
        <p className="m-0 text-[0.66rem] leading-relaxed" style={{ color: t2 }}>
          Rev observes and explains your store. It cannot change prices, orders, discounts, themes or settings, and it never sends campaigns.
        </p>
      </div>
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
  const [findingContext, setFindingContext] = useState<FindingContext | null>(null);
  const [findingLoading, setFindingLoading] = useState(false);
  const [findingError, setFindingError] = useState<string | null>(null);
  const [findingRetryDraft, setFindingRetryDraft] = useState<{
    messageId: string; recoverInPlace: boolean; requiresImage: boolean;
    attachmentUnknown: boolean; persistenceUnknown: boolean;
  } | null>(null);

  const [thinking,       setThinking]       = useState(false);
  const [menuOpen,       setMenuOpen]       = useState(false);
  const [copied,         setCopied]         = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError,   setHistoryError]   = useState<string | null>(null);
  const [historyMore, setHistoryMore] = useState(false);
  const [historyMoreLoading, setHistoryMoreLoading] = useState(false);
  const [historyMoreError, setHistoryMoreError] = useState<string | null>(null);
  const historyOffset = useRef(0);
  const historyPagePending = useRef(false);
  const [messagesMore, setMessagesMore] = useState(false);
  const [messagesMoreLoading, setMessagesMoreLoading] = useState(false);
  const [messagesMoreError, setMessagesMoreError] = useState<string | null>(null);
  const messagesOffset = useRef(0);
  const messagesPagePending = useRef(false);
  const reducedMotion = useReducedMotion();
  const [convLoading,    setConvLoading]    = useState(false);
  const [convError,      setConvError]      = useState<string | null>(null);
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
  const [evidenceFor, setEvidenceFor] = useState<string | null>(null);
  const [focusedEvidenceId, setFocusedEvidenceId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [storeContext, setStoreContext] = useState<StoreContext>(UNKNOWN_STORE);

  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef  = useRef<AbortController | null>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);
  const historyRequestRef = useRef(0);
  const conversationRequestRef = useRef(0);
  const turnRequestRef = useRef(0);
  const turnPendingRef = useRef(false);
  const draftSubmissionRef = useRef<{
    id: string; message: string; conversationId: string | null; findingId?: string;
  } | null>(null);
  const searchQueryRef = useRef("");
  const findingRequestRef = useRef(0);
  const inputEditedRef = useRef(false);
  const dialogReturnRef = useRef<HTMLElement | null>(null);
  const copyRequestRef = useRef(0);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set right before we navigate() to a conversation we just created ourselves,
  // so the URL-sync effect below doesn't redundantly re-fetch and clobber the
  // (already correct) optimistic messages with a fresh server round trip.
  const justCreatedIdRef = useRef<string | null>(null);
  const justCreatedFindingRef = useRef<string | null>(null);
  // REV-RESUME-001 gates: an explicit "New conversation" choice opts the bare
  // route out of continuity until the next send/selection; the resumed flag
  // keeps one mount to a single continuity redirect.
  const newChatIntentRef = useRef(false);
  const resumedBareRouteRef = useRef(false);

  const loadFinding = useCallback(async (id: string) => {
    const request = ++findingRequestRef.current;
    setFindingContext(null);
    setFindingError(null);
    if (!id) {
      setFindingLoading(false);
      setFindingError(cleanError("INVALID_FINDING_ID"));
      return;
    }
    setFindingLoading(true);
    try {
      const result = await api.get<{ success: boolean; data: { finding: any; priority_finding?: any } }>(`/rev/findings/${encodeURIComponent(id)}`);
      if (request !== findingRequestRef.current) return;
      const finding = result.data.data?.finding;
      const priority = result.data.data?.priority_finding;
      if (!result.data.success || !finding || typeof finding.id !== "string" || finding.id.toLowerCase() !== id.toLowerCase() || typeof finding.title !== "string" || !finding.title.trim()) {
        throw new Error("Finding details are unavailable.");
      }
      setFindingContext({ id, title: finding.title, description: typeof finding.description === "string" ? finding.description : "",
        lifecycleState: typeof finding.status === "string" ? finding.status : undefined,
        currentValidity: typeof finding.current_validity === "string" ? finding.current_validity : finding.evidence?.verified === true ? "recorded_source_verified" : "evidence_unverified",
        evidenceQuality: priority?.confidence?.classification,
        reportingPeriod: priority?.reporting_period || null,
        confidence: priority?.confidence?.classification,
        limitations: Array.isArray(priority?.limitations) ? priority.limitations : [],
        evidenceReferences: Array.isArray(priority?.evidence?.references) ? priority.evidence.references.map((ref: any) => ref.id).filter((ref: unknown) => typeof ref === "string") : [],
      });
      if (!inputEditedRef.current) setInput(`Help me investigate this finding: ${finding.title}. Explain the observed change, limitations and supported next steps.`);
    } catch (error) {
      if (request !== findingRequestRef.current) return;
      const code = responseErrorCode(error) || (error instanceof ApiError && [403, 404].includes(error.status) ? "FINDING_NOT_FOUND" : undefined);
      setFindingError(code && FINDING_ERRORS.includes(code) ? cleanError(code) : "Finding details could not be loaded. Please try again.");
    } finally {
      if (request === findingRequestRef.current) setFindingLoading(false);
    }
  }, []);

  // Scroll discipline: follow the stream only while the merchant is pinned to
  // the bottom. Reading an older answer must not be hijacked by new frames.
  // Scrolling away reveals a "Back to latest" pill (ChatGPT-UI study §6):
  // leaving the stream is free, rejoining it is one click.
  const scrollBoxRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const handleScrollBoxScroll = () => {
    const box = scrollBoxRef.current;
    if (!box) return;
    const distance = box.scrollHeight - box.scrollTop - box.clientHeight;
    pinnedRef.current = distance < 80;
    // Hysteresis: the pill appears past 160px and the pinned auto-follow
    // resumes under 80px, so a small overscroll never flickers the pill.
    setShowJumpToLatest(prev => (prev ? distance > 80 : distance > 160));
  };
  const jumpToLatest = useCallback(() => {
    pinnedRef.current = true;
    setShowJumpToLatest(false);
    bottomRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth" });
  }, [reducedMotion]);
  useEffect(() => {
    if (!messagesPagePending.current && pinnedRef.current) bottomRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth" });
  }, [messages, thinking, reducedMotion]);

  // ── Load store context ────────────────────────────────────────────────────
  // The registered backend route is /stores (plural). A failed request is
  // deliberately represented as unverifiable, never as a disconnected store.
  const loadStoreContext = useCallback(async () => {
    try {
      const res = await api.get<StoreListResponse>("/stores");
      setStoreContext(storeContextFromResponse(res.data));
    } catch {
      setStoreContext({ ...UNKNOWN_STORE, loaded: true, loadError: true });
    }
  }, []);

  useEffect(() => { void loadStoreContext(); }, [loadStoreContext]);

  // ── Load conversations list ───────────────────────────────────────────────
  const loadConversations = useCallback(async (searchText = searchQueryRef.current, append = false) => {
    const query = searchText.trim().slice(0, 80);
    if (query !== searchQueryRef.current.trim().slice(0, 80) || (append && historyPagePending.current)) return;
    const request = ++historyRequestRef.current;
    historyPagePending.current = true;
    const offset = append ? historyOffset.current : 0;
    if (append) {
      setHistoryMoreLoading(true);
      setHistoryMoreError(null);
    } else {
      setHistoryLoading(true);
      setHistoryError(null);
      setHistoryMore(false);
      setHistoryMoreLoading(false);
      setHistoryMoreError(null);
    }
    try {
      const res = await api.get<{ success: boolean; data: Conversation[] }>(
        `/rev/conversations${append ? `?limit=${HISTORY_PAGE_SIZE}&offset=${offset}${query ? `&q=${encodeURIComponent(query)}` : ""}` : query ? `?q=${encodeURIComponent(query)}` : ""}`,
      );
      if (request !== historyRequestRef.current) return;
      if (res.data.success !== true || !Array.isArray(res.data.data)) throw new Error('Invalid conversation history response.');
      const page = res.data.data;
      historyOffset.current = offset + page.length;
      setHistoryMore(page.length === HISTORY_PAGE_SIZE);
      setConversations(previous => [...new Map([...(append ? previous : []), ...page].map(item => [item.id, item])).values()]);
    } catch {
      if (request === historyRequestRef.current) {
        if (append) setHistoryMoreError("More conversations could not be loaded. Please try again.");
        else setHistoryError("Conversation history is unavailable. Please try again.");
      }
    } finally {
      if (request === historyRequestRef.current) {
        historyPagePending.current = false;
        setHistoryLoading(false);
        setHistoryMoreLoading(false);
      }
    }
  }, []);

  // ── Load specific conversation ────────────────────────────────────────────
  const loadConversation = useCallback(async (convId: string, append = false) => {
    if (append && messagesPagePending.current) return;
    const request = ++conversationRequestRef.current;
    messagesPagePending.current = true;
    const offset = append ? messagesOffset.current : 0;
    if (append) {
      setMessagesMoreLoading(true);
      setMessagesMoreError(null);
    } else {
      setConvNotFound(false);
      setConvError(null);
      setConvLoading(true);
      setMessagesMore(false);
      setMessagesMoreError(null);
    }

    try {
      const res = await api.get<{
        success: boolean;
        data: {
          messages: Array<{
            id: string; role: string; content: unknown;
            created_at: string; has_error?: boolean;
            feedback_rating?: string | null;
          }>;
        };
      }>(`/rev/conversation/${encodeURIComponent(convId)}${append ? `?limit=${MESSAGE_PAGE_SIZE}&offset=${offset}` : ""}`);

      if (request !== conversationRequestRef.current) return;
      const msgs = res.data.data?.messages;
      if (res.data.success !== true || !Array.isArray(msgs)) throw new Error('Invalid conversation response.');

      const parsed: Message[] = msgs.map((m: any) => {
        let content: string | RevResponse = "";
        const payload = m.role === "rev" ? normaliseRevAnswer(m.content) : undefined;
        const raw = m.content;
        if (payload) {
          content = payload.text;
        } else if (typeof raw === "object" && raw !== null) {
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
            if ("response_type" in parsed2) { content = parsed2 as RevResponse; }
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
          persistence: "persisted",
          feedback: m.feedback_rating === "up" || m.feedback_rating === "down" ? m.feedback_rating : undefined,
          // Rehydrated Rev turns stay ratable even when the persisted content
          // predates message_id in payloads: the thread row IS the message.
          payload: payload && !payload.message_id ? { ...payload, message_id: m.id } : payload,
        };
      });

      messagesOffset.current = offset + msgs.length;
      setMessagesMore(msgs.length === MESSAGE_PAGE_SIZE);
      setMessages(previous => [...new Map([...(append ? previous : []), ...parsed].map(item => [item.id, item])).values()]);
      if (!append && !findingId) {
        const persistedFinding = [...parsed].reverse().find(message => message.payload?.selected_finding)?.payload?.selected_finding;
        setFindingContext(persistedFinding ? {
          id: persistedFinding.finding_id, title: persistedFinding.title,
          description: "", lifecycleState: persistedFinding.lifecycle_state,
          currentValidity: persistedFinding.current_validity,
          evidenceQuality: persistedFinding.evidence_quality,
        } : null);
      }
    } catch (err: any) {
      if (request !== conversationRequestRef.current) return;
      if (append) {
        setMessagesMoreError("More messages could not be loaded. Please try again.");
      } else if (err?.status === 404 || err?.status === 403) {
        setConvNotFound(true);
      } else {
        setConvError("This conversation could not be loaded. Please try again.");
      }
    } finally {
      if (request === conversationRequestRef.current) {
        messagesPagePending.current = false;
        setConvLoading(false);
        setMessagesMoreLoading(false);
      }
    }
  }, [findingId]);

  // ── URL → state sync (on mount and when URL changes) ─────────────────────
  // Run on mount (to handle refresh) and whenever the URL conversationId changes.
  // Do NOT gate on activeId — on refresh they start equal so the check would skip loading.
  const resetThread = useCallback(() => {
    copyRequestRef.current += 1;
    if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = null;
    setCopied(false);
    conversationRequestRef.current += 1;
    turnRequestRef.current += 1;
    turnPendingRef.current = false;
    abortRef.current?.abort();
    abortRef.current = null;
    justCreatedIdRef.current = null;
    justCreatedFindingRef.current = null;
    findingRequestRef.current += 1;
    inputEditedRef.current = false;
    setFindingContext(null);
    setFindingLoading(false);
    setFindingError(null);
    setFindingRetryDraft(null);
    setThinking(false);
    setConvLoading(false);
    setConvNotFound(false);
    setConvError(null);
    setMessages([]);
    messagesPagePending.current = false;
    messagesOffset.current = 0;
    setMessagesMore(false);
    setMessagesMoreLoading(false);
    setMessagesMoreError(null);
    setEvidenceFor(null);
    setImageAttachment(null);
    setAttachmentError(null);
    setCopyError(null);
    setInput("");
  }, []);

  useLayoutEffect(() => {
    // Any concrete conversation in the URL ends a pending new-chat intent.
    if (urlConvId) newChatIntentRef.current = false;
    // Adoption of a newly created thread keeps its optimistic turn and stream.
    if (urlConvId && justCreatedIdRef.current === urlConvId && justCreatedFindingRef.current === findingId) {
      justCreatedIdRef.current = null;
      justCreatedFindingRef.current = null;
      setActiveId(urlConvId);
      return;
    }
    resetThread();
    if (urlConvId) {
      setActiveId(urlConvId);
      void loadConversation(urlConvId);
    } else {
      setActiveId(null);
    }
    if (findingId !== null) void loadFinding(findingId);
  }, [urlConvId, findingId, resetThread, loadConversation, loadFinding]);

  // ── Landing continuity (REV-RESUME-001) ───────────────────────────────────
  // A bare route is not amnesia. Rev threads are evidence-bound business
  // investigations, so a merchant returning from Command Center — or a new
  // tab, or Back — lands in their most recent conversation instead of a blank
  // slate. The history list is already server-sorted by last_activity_at DESC,
  // so row one is the resume target. `replace` keeps the browser Back button
  // pointing at wherever they came from (no history-entry loop). Explicit
  // "New conversation" intent, finding deep links, and empty or failed
  // history all opt out; nothing is ever invented or pre-filled.
  useEffect(() => {
    if (urlConvId || findingId !== null) return;
    if (newChatIntentRef.current || resumedBareRouteRef.current) return;
    const target = conversations[0];
    if (!target) return;
    resumedBareRouteRef.current = true;
    navigate(`/dashboard/rev-intell/${target.id}`, { replace: true });
  }, [conversations, urlConvId, findingId, navigate]);

  useLayoutEffect(() => () => {
    copyRequestRef.current += 1;
    if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    historyRequestRef.current += 1;
    conversationRequestRef.current += 1;
    turnRequestRef.current += 1;
    findingRequestRef.current += 1;
    abortRef.current?.abort();
  }, []);

  const changeSearch = useCallback((value: string) => {
    searchQueryRef.current = value;
    historyRequestRef.current += 1;
    historyPagePending.current = false;
    setHistoryMore(false);
    setHistoryMoreLoading(false);
    setHistoryMoreError(null);
    setHistoryLoading(true);
    setHistoryError(null);
    setSearchQuery(value);
  }, []);

  // Sidebar search is server-side (titles and message content) and debounced.
  useEffect(() => {
    const handle = window.setTimeout(() => { void loadConversations(searchQuery); }, 250);
    return () => window.clearTimeout(handle);
  }, [searchQuery, loadConversations]);

  // The history drawer is modal: the workspace behind it cannot scroll. Escape
  // is deliberately NOT handled here — the drawer is a Radix dialog, which
  // closes only the topmost layer, so Escape inside a nested rename/delete
  // dialog closes that dialog and leaves the drawer (and the row button focus
  // must return to) mounted. A window-level Escape listener closed the drawer
  // underneath the nested dialog and destroyed that focus return.
  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [menuOpen]);

  // ── New chat ──────────────────────────────────────────────────────────────
  const newChat = useCallback(() => {
    newChatIntentRef.current = true;
    resetThread();
    setActiveId(null);
    setMenuOpen(false);
    setEvidenceFor(null);
    setInput("");
    setMessages([]);
    setConvNotFound(false);
    navigate("/dashboard/rev-intell");
  }, [navigate, resetThread]);

  // ── Navigate to conversation ──────────────────────────────────────────────
  const openConversation = useCallback((convId: string) => {
    resetThread();
    setMenuOpen(false);
    setEvidenceFor(null);
    navigate(`/dashboard/rev-intell/${convId}`);
    if (convId === urlConvId && findingId === null) void loadConversation(convId);
    // URL change triggers the useEffect above which loads the conversation
  }, [navigate, urlConvId, findingId, resetThread, loadConversation]);

  // ── Turn normalisation ────────────────────────────────────────────────────
  // Node returns the persisted, bounded turn. We keep both the legacy
  // RevResponse (for the existing sections renderer) and the evidence-bearing
  // payload so verified facts, hypotheses and unknowns are never dropped.
  function normaliseTurn(data: any): { content: string | RevResponse; payload?: RevAnswerPayload } {
    const responseType = (data?.response_type || "analysis") as ResponseType;
    const revResponse: RevResponse = {
      response_type: responseType,
      text: data?.text ?? data?.response?.text,
      situation: data?.response?.situation ?? data?.situation,
      insight: data?.response?.insight ?? data?.insight,
      implication: data?.response?.implication ?? data?.implication,
      recommendation: data?.response?.recommendation ?? data?.recommendation,
      confidence: data?.response?.confidence ?? (
        data?.confidence_score !== undefined
          ? { score: data.confidence_score, basis: data.confidence_basis || "" }
          : undefined
      ),
      actions: data?.response?.actions || data?.actions || [],
      agents_used: data?.meta?.agents_used || data?.agents_used || [],
      warnings: data?.response?.warnings || data?.warnings || [],
    };
    const payload = normaliseRevAnswer(data);
    return { content: revResponse, payload };
  }

  // ── Send message (streamed) ───────────────────────────────────────────────
  // Streams plan/step/evidence frames so the merchant watches the
  // investigation happen; the final frame is the persisted, validated turn.
  // Image turns fall back to the non-streaming endpoint, which is the only
  // path that carries attachments — never silently drop an attachment.
  const send = useCallback(async (text: string) => {
    const trimmedLen = text.trim().length;
    if (!trimmedLen || trimmedLen > MAX_QUESTION_LENGTH || turnPendingRef.current || convLoading || convError || convNotFound || findingLoading || findingError || messagesMore || messagesPagePending.current || (findingId !== null && !findingContext)) return;
    if ((findingRetryDraft?.requiresImage || findingRetryDraft?.attachmentUnknown) && !imageAttachment) return;
    const turn = ++turnRequestRef.current;
    turnPendingRef.current = true;
    pinnedRef.current = true;
    const isCurrent = () => turn === turnRequestRef.current;
    const topicChange = EXPLICIT_FINDING_TOPIC_CHANGE.test(text);
    const turnFindingId = topicChange ? undefined : findingContext?.id;
    if (topicChange) setFindingContext(null);
    const findingRejected = (code?: string) => {
      if (isCurrent() && turnFindingId && code && FINDING_ERRORS.includes(code)) setFindingError(cleanError(code));
    };
    let turnConversationId = activeId;
    const adoptConversation = (id?: string | null) => {
      if (!isCurrent() || !id || id === turnConversationId) return;
      turnConversationId = id;
      conversationRequestRef.current += 1;
      justCreatedIdRef.current = id;
      justCreatedFindingRef.current = turnFindingId ?? null;
      setActiveId(id);
      navigate(`/dashboard/rev-intell/${id}${turnFindingId ? `?finding=${encodeURIComponent(turnFindingId)}` : ""}`, { replace: true });
    };
    const trimmed = text.trim();
    const previousSubmission = draftSubmissionRef.current;
    const submissionId = previousSubmission
      && previousSubmission.message === trimmed
      && previousSubmission.conversationId === activeId
      && previousSubmission.findingId === turnFindingId
      ? previousSubmission.id : crypto.randomUUID();
    // Retained only while acceptance is unknown. An explicit edit, accepted
    // response, or intentional new turn gets its own idempotency scope.
    draftSubmissionRef.current = {
      id: submissionId, message: trimmed, conversationId: activeId, findingId: turnFindingId,
    };

    inputEditedRef.current = true;
    // Acceptance is authoritative. The draft and attachment remain available
    // until the server has persisted the question (meta for SSE, a successful
    // JSON envelope for image turns), including across retry/navigation races.
    setFindingRetryDraft(null);
    if (inputRef.current) inputRef.current.style.height = "auto";
    const sid = `r${Date.now()}-${turn}`;
    setMessages(prev => {
      const placeholder: Message = { id: sid, role: "rev", content: "", timestamp: new Date(), isStreaming: true, steps: [], persistence: "unknown", imageAssisted: Boolean(imageAttachment) };
      const question: Message = { id: `u${Date.now()}-${turn}`, role: "user", content: trimmed, timestamp: new Date() };
      const index = findingRetryDraft?.recoverInPlace ? prev.findIndex(message => message.id === findingRetryDraft.messageId) : -1;
      if (index === prev.length - 1 && index > 0 && prev[index].persistence === "not-persisted") {
        return prev.map((message, position) => position === index ? placeholder
          : position === index - 1 && message.role === "user" ? { ...message, content: trimmed } : message);
      }
      return [...prev, question, placeholder];
    });
    setThinking(true);

    const patch = (updater: (message: Message) => Message) => {
      if (isCurrent()) setMessages(prev => isCurrent() ? prev.map(message => (message.id === sid ? updater(message) : message)) : prev);
    };
    const upsertStep = (step: InvestigationStep) => {
      patch(message => {
        const steps = message.steps ? [...message.steps] : [];
        const index = steps.findIndex(existing => existing.id === step.id || existing.tool === step.tool);
        if (index >= 0) steps[index] = { ...steps[index], ...step };
        else steps.push(step);
        return { ...message, steps };
      });
    };

    const capturedImage = imageAttachment;
    const acceptDraft = () => {
      if (!isCurrent()) return;
      draftSubmissionRef.current = null;
      setInput("");
      if (inputRef.current) inputRef.current.style.height = "auto";
      if (capturedImage) setImageAttachment(null);
    };

    if (capturedImage) {
      try {
        const body: Record<string, unknown> = { message: trimmed, request_id: submissionId };
        if (activeId) body.conversation_id = activeId;
        if (turnFindingId) body.finding_id = turnFindingId;
        body.image_base64 = capturedImage.base64;
        body.image_media_type = capturedImage.mediaType;

        const res = await api.post<any>("/rev/chat", body);
        if (!isCurrent()) return;
        const data = (res as any)?.data ?? (res as any);
        if (!data?.success) {
          const persisted = typeof data?.conversation_id === "string";
          if (persisted) { acceptDraft(); adoptConversation(data.conversation_id); }
          findingRejected(data?.error?.code);
          patch(message => ({
            ...message, isStreaming: false, hasError: true,
            errorCode: data?.error?.code,
            persistence: persisted ? "persisted" : FINDING_ERRORS.includes(data?.error?.code) ? "not-persisted" : "unknown",
            content: cleanError(data?.error?.code, data?.error?.message),
          }));
        } else {
          acceptDraft();
          adoptConversation(data.conversation_id);
          void loadConversations();
          const { content, payload } = normaliseTurn(data);
          patch(message => ({ ...message, isStreaming: false, content, payload, persistence: "persisted" }));
        }
      } catch (err) {
        const code = responseErrorCode(err);
        const failedTurn = err instanceof ApiError ? err.body as { conversation_id?: unknown } | undefined : undefined;
        const persisted = typeof failedTurn?.conversation_id === "string";
        if (persisted) { acceptDraft(); adoptConversation(failedTurn.conversation_id as string); }
        findingRejected(code);
        const msg = code ? cleanError(code) : err instanceof ApiError
          ? cleanError(String((err as any).status), err.message)
          : "Rev is taking a moment. Please try again shortly.";
        patch(message => ({ ...message, isStreaming: false, hasError: true, errorCode: code, content: msg,
          persistence: persisted ? "persisted" : code && FINDING_ERRORS.includes(code) ? "not-persisted" : "unknown" }));
      } finally {
        if (isCurrent()) {
          turnPendingRef.current = false;
          setThinking(false);
        }
      }
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    let finalRejected = false;

    try {
      const result = await streamRevAnswer({
        message: trimmed,
        requestId: submissionId,
        conversationId: activeId,
        findingId: turnFindingId,
        signal: controller.signal,
        handlers: {
          onMeta: ({ conversation_id }) => {
            acceptDraft();
            adoptConversation(conversation_id);
            if (conversation_id) patch(message => ({ ...message, persistence: "persisted" }));
          },
          onPlan: (plan) => {
            if (plan.steps?.length) patch(message => ({ ...message, steps: plan.steps }));
          },
          onStep: upsertStep,
          onEvidence: (evidence) => {
            patch(message => ({
              ...message,
              payload: {
                ...(message.payload ?? { read_only: true, response_type: "analysis", text: "" }),
                evidence,
              } as RevAnswerPayload,
            }));
          },
          onFinal: (payload) => {
            if (!isCurrent()) return;
            if (payload.success === false) {
              finalRejected = true;
              const code = (payload as RevAnswerPayload & { error?: { code?: string } }).error?.code;
              findingRejected(code);
              patch(message => ({ ...message, isStreaming: false, hasError: true, errorCode: code, content: cleanError(code), payload: undefined,
                persistence: message.persistence !== "persisted" && code && FINDING_ERRORS.includes(code) ? "not-persisted" : message.persistence }));
              return;
            }
            acceptDraft();
            adoptConversation(payload.conversation_id);
            const { content, payload: normalised } = normaliseTurn(payload);
            patch(message => ({
              ...message,
              isStreaming: false,
              persistence: "persisted",
              content,
              payload: normalised,
              steps: payload.investigation?.steps?.length ? payload.investigation.steps : message.steps,
            }));
          },
        },
      });

      if (!isCurrent()) return;
      if (!finalRejected) adoptConversation(result.conversationId);
      patch(message => {
        if (message.hasError) return { ...message, isStreaming: false };
        if (controller.signal.aborted) return { ...message, isStreaming: false, cancelled: true };
        if (message.payload) return { ...message, isStreaming: false };
        return {
          ...message, isStreaming: false, hasError: true,
          content: result.completed
            ? "Rev finished without returning an answer. Please try again."
            : "This response was interrupted. You can generate it again.",
        };
      });
      void loadConversations();
    } catch (err) {
      if (controller.signal.aborted) {
        patch(message => ({ ...message, isStreaming: false, cancelled: true }));
      } else {
        const code = responseErrorCode(err) ?? "";
        findingRejected(code);
        const msg = err instanceof RevStreamError
          ? cleanError(err.code, err.message)
          : err instanceof ApiError
            ? cleanError(String((err as any).status), err.message)
            : "Rev is taking a moment. Please try again shortly.";
        patch(message => ({ ...message, isStreaming: false, hasError: true, errorCode: code, content: msg,
          persistence: message.persistence !== "persisted" && FINDING_ERRORS.includes(code) ? "not-persisted" : message.persistence }));
      }
    } finally {
      if (isCurrent()) {
        if (abortRef.current === controller) abortRef.current = null;
        turnPendingRef.current = false;
        setThinking(false);
        if (topicChange && findingId) {
          navigate(turnConversationId ? `/dashboard/rev-intell/${turnConversationId}` : "/dashboard/rev-intell", { replace: true });
        }
      }
    }
  }, [activeId, convLoading, convError, convNotFound, findingId, findingContext, findingLoading, findingError, findingRetryDraft, navigate, imageAttachment, loadConversations, messagesMore]);

  // ── Stop generation ───────────────────────────────────────────────────────
  const stopGeneration = useCallback(() => {
    turnRequestRef.current += 1;
    turnPendingRef.current = false;
    abortRef.current?.abort();
    abortRef.current = null;
    setThinking(false);
    setMessages(previous => previous.map(message => message.isStreaming ? { ...message, isStreaming: false, cancelled: true } : message));
  }, []);

  // Finding requests append new turns on the server. Only confirmed rejected,
  // unpersisted attempts can be recovered in place in the local thread.
  const handleRetry = useCallback(async (source?: Message) => {
    if (turnPendingRef.current || convLoading || convError || convNotFound || findingLoading || findingError || messagesMore) return;
    const previous = source ?? [...messages].reverse().find(message => message.role === "rev");
    if (!previous) return;
    const index = messages.findIndex(message => message.id === previous?.id);
    const question = messages.slice(0, index).reverse().find(message => message.role === "user")?.content;
    if (typeof question !== "string" || !question.trim()) return;
    setFindingRetryDraft({
      messageId: previous.id,
      recoverInPlace: previous?.persistence === "not-persisted" && index === messages.length - 1,
      requiresImage: previous?.imageAssisted === true,
      attachmentUnknown: previous?.imageAssisted === undefined,
      persistenceUnknown: previous?.persistence !== "persisted" && previous?.persistence !== "not-persisted",
    });
    inputEditedRef.current = true;
    setInput(question);
    inputRef.current?.focus();
  }, [convLoading, convError, convNotFound, findingLoading, findingError, messages, messagesMore]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
  };
  const resize = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    inputEditedRef.current = true;
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 150) + "px";
  };
  const copy = async (text: string) => {
    const request = ++copyRequestRef.current;
    if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = null;
    setCopied(false);
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(text);
      if (request !== copyRequestRef.current) return;
      setCopied(true);
      copyTimerRef.current = setTimeout(() => {
        if (request !== copyRequestRef.current) return;
        setCopied(false);
        copyTimerRef.current = null;
      }, 2000);
    } catch {
      if (request === copyRequestRef.current) setCopyError("The answer could not be copied. Select the text and copy it manually.");
    }
  };

  // ── Answer feedback (ChatGPT-UI study §5: thumbs in the action dock) ───────
  // Optimistic with an honest revert: if the write does not land, the UI must
  // not claim it did. Clicking the active rating clears it — the backend row
  // only ever holds an explicit current choice.
  const submitFeedback = useCallback(async (msg: Message, rating: "up" | "down") => {
    const messageId = typeof msg.payload?.message_id === "string" && msg.payload.message_id
      ? msg.payload.message_id
      : null;
    if (!messageId) return;
    const previous = msg.feedback ?? null;
    const next = previous === rating ? null : rating;
    setMessages(list => list.map(item => (item.id === msg.id ? { ...item, feedback: next } : item)));
    try {
      await api.post("/rev/message-feedback", { message_id: messageId, rating: next });
    } catch {
      setMessages(list => list.map(item => (item.id === msg.id ? { ...item, feedback: previous } : item)));
    }
  }, []);

  // ── Read aloud (ChatGPT-UI study §5: TTS in the action dock) ───────────────
  // Feature-detected: the button exists only where the platform can actually
  // speak. Speech never survives a new turn or leaving the page.
  const speechSupported = typeof window !== "undefined" && "speechSynthesis" in window
    && typeof window.SpeechSynthesisUtterance !== "undefined";
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const stopSpeech = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeakingId(null);
  }, []);
  const toggleReadAloud = useCallback((msg: Message) => {
    if (!speechSupported) return;
    if (speakingId === msg.id) {
      stopSpeech();
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new window.SpeechSynthesisUtterance(answerCopyText(msg));
    const clear = () => setSpeakingId(current => (current === msg.id ? null : current));
    utterance.onend = clear;
    utterance.onerror = clear;
    setSpeakingId(msg.id);
    window.speechSynthesis.speak(utterance);
  }, [speechSupported, speakingId, stopSpeech]);
  // A new turn never talks over the merchant: speech stops when Rev starts.
  useEffect(() => { if (thinking) stopSpeech(); }, [thinking, stopSpeech]);
  // Never leave the page speaking.
  useEffect(() => () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setAttachmentError(null);
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setAttachmentError("Choose a JPEG, PNG, WebP or GIF image under 5 MB. Other files and videos are not supported.");
      return;
    }
    const request = conversationRequestRef.current;
    const reader = new FileReader();
    reader.onload = () => {
      if (request !== conversationRequestRef.current) return;
      const preview = typeof reader.result === "string" ? reader.result : "";
      if (!preview.includes(",")) { setAttachmentError("This image could not be read. Please try again."); return; }
      setImageAttachment({ base64: preview.split(",")[1], mediaType: file.type, preview, name: file.name });
    };
    reader.onerror = () => { if (request === conversationRequestRef.current) setAttachmentError("This image could not be read. Please try again."); };
    reader.readAsDataURL(file);
  };
  const removeAttachment = () => setImageAttachment(null);

  const deleteConv = async (id: string) => {
    if (deletingConvId) return;
    const request = conversationRequestRef.current;
    setDeletingConvId(id);
    setDeleteError(null);
    try {
      await api.delete(`/rev/conversation/${encodeURIComponent(id)}`);
      void loadConversations();
      setConversations(prev => prev.filter(c => c.id !== id));
      setDeleteConfirmId(null);
      if (activeId === id && request === conversationRequestRef.current) newChat();
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
      void loadConversations();
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
  const t4   = t2;

  const inputProps = {
    inputRef, value: input, onChange: resize, onKeyDown: handleKey,
    onSend: () => send(input), onFile: handleFile,
    thinking,
    disabled: findingLoading || Boolean(findingError) || messagesMore || messagesMoreLoading,
    sendDisabled: Boolean((findingRetryDraft?.requiresImage || findingRetryDraft?.attachmentUnknown) && !imageAttachment),
    onStop: stopGeneration,
    card, border: bdr, t1, t2, isDark,
  };

  const hasMessages = messages.length > 0;
  const starters = useMemo(() => buildStarters(storeContext), [storeContext]);

  return (
    <MotionConfig reducedMotion="user">
    <style>{`
      .rev-workspace :is(button,input):focus-visible, [data-rev-modal] :is(button,input):focus-visible { outline: 2px solid ${workspaceDesign.color.focus}; outline-offset: 3px; }
      @media (prefers-reduced-motion: reduce) { .rev-workspace *, [data-rev-modal], [data-rev-modal] * { animation: none !important; transition: none !important; scroll-behavior: auto !important; } }
    `}</style>
    <div className="rev-workspace relative flex overflow-hidden"
      style={{ height: "calc(100dvh - var(--topbar-h, 64px))", margin: "-20px -20px 0", background: bg }}>

      <div className="flex flex-col flex-1 min-w-0 h-full">

      <div className="absolute left-4 top-4 z-30">
        <button type="button" onClick={() => navigate(commandCenterReturnRoute(searchParams.toString() ? `?${searchParams}` : ""))}
          className="flex min-h-11 items-center gap-2 rounded-xl border px-3 text-xs font-semibold transition-colors hover:opacity-80"
          style={{ background: card, borderColor: bdr, color: t1 }} aria-label="Return to Command Center">
          <ArrowLeft size={16} aria-hidden="true" /><span className="hidden sm:inline">Command Center</span>
        </button>
      </div>

      {/* Hamburger (mobile) */}
      <div className="absolute top-4 right-4 z-30">
        <button onClick={() => setMenuOpen(v => !v)}
          aria-label={menuOpen ? "Close conversation history" : "Open conversation history"} aria-expanded={menuOpen}
          className="flex items-center justify-center w-9 h-9 rounded-xl transition-all hover:opacity-80"
          style={{ background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)", color: t2 }}>
          {menuOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>


      {(findingId !== null || findingContext) && <section aria-label="Finding context"
        className="mx-4 mt-4 max-h-[28dvh] shrink-0 overflow-y-auto rounded-xl border px-4 py-3 pr-14 lg:pr-4" style={{ background: card, borderColor: bdr, color: t1 }}>
        {findingLoading && <p role="status" className="text-sm" style={{ color: t2 }}>Loading finding details…</p>}
        {findingContext && <>
          <p className="mb-1 text-xs font-semibold" style={{ color: t2 }}>Finding to investigate</p>
          <h2 className="text-sm font-semibold">{findingContext.title}</h2>
          {findingContext.description && <p className="mt-1 line-clamp-2 text-xs" style={{ color: t2 }}>{findingContext.description}</p>}
          {(findingContext.confidence || findingContext.reportingPeriod) && <p className="mt-1 text-xs" style={{ color: t2 }}>
            {findingContext.confidence ? `${findingContext.confidence.replaceAll("_", " ")} confidence` : "Confidence unavailable"}
            {findingContext.reportingPeriod?.start && findingContext.reportingPeriod?.end ? ` · ${findingContext.reportingPeriod.start} to ${findingContext.reportingPeriod.end} (${findingContext.reportingPeriod.timezone})` : " · Reporting period unavailable"}
          </p>}
          {findingContext.limitations?.[0] && <p className="mt-1 text-xs" style={{ color: t2 }}>Limit: {findingContext.limitations[0]}</p>}
          {(findingContext.currentValidity !== "current_evidence_verified" && findingContext.currentValidity !== "recorded_source_verified" || ["resolved", "dismissed", "invalidated", "superseded"].includes(findingContext.lifecycleState || "")) &&
            <p role="status" className="mt-2 rounded-lg border px-2 py-1 text-xs" style={{ borderColor: bdr, color: t2 }}>
              {findingContext.lifecycleState === "resolved" ? "Resolved finding — historical context, not a current priority." :
                findingContext.lifecycleState === "dismissed" ? "Dismissed finding — historical context, not a current priority." :
                "Stale or historical finding — Rev will revalidate it before offering current advice."}
            </p>}
          {!findingError && <p className="mt-2 text-xs" style={{ color: t2 }}>Rev will verify this finding against your workspace records when you send. You can edit the question first.</p>}
        </>}
        {findingError && <div role="alert" className="text-sm">
          <p>{findingError}</p>
          <button onClick={() => void loadFinding(findingId ?? findingContext?.id ?? "")} className="mt-2 rounded-lg border px-3 py-2 text-xs font-semibold"
            style={{ borderColor: bdr }} aria-label="Retry finding">Retry finding</button>
        </div>}
      </section>}
        {findingRetryDraft && <div role="status" aria-label="Question recovery" className="max-h-[25dvh] shrink-0 overflow-y-auto px-4 py-2 text-xs" style={{ color: t1 }}>
          <p>{findingRetryDraft.recoverInPlace
            ? "This request was rejected before it was saved. Send to retry this question."
            : findingRetryDraft.persistenceUnknown
              ? "The previous request may have been saved. Sending again creates a new question and keeps the earlier attempt. Check conversation history if needed."
              : "Sending again creates a new question and keeps the earlier messages."}</p>
          {findingRetryDraft.requiresImage && <p className="mt-1">Reattach the original image before sending this question again.</p>}
          {findingRetryDraft.attachmentUnknown && <>
            <p className="mt-1">Attachments are not restored from history. Reattach any image used for this question, or explicitly continue with text only.</p>
            <button className="mt-2 rounded-lg border px-3 py-2 font-semibold" style={{ borderColor: bdr }}
              onClick={() => setFindingRetryDraft(current => current ? { ...current, attachmentUnknown: false } : null)}>Continue with text only</button>
          </>}
        </div>}
      {attachmentError && <p role="alert" className="px-4 py-2 text-sm" style={{ color: isDark ? "#fca5a5" : "#b91c1c" }}>{attachmentError}</p>}

      {/* Main content */}
      <div className="flex-1 min-h-0 relative">
      <div ref={scrollBoxRef} onScroll={handleScrollBoxScroll} data-testid="rev-scroll-box" className="absolute inset-0 overflow-y-auto" style={{ scrollbarWidth: "none" }}>

        {/* Conversation loading */}
        {convLoading && (
          <div role="status" className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-3">
              <div className="w-6 h-6 rounded-full border-2 border-t-transparent border-[#1F06AC] animate-spin" />
              <p className="text-[0.8rem]" style={{ color: t2 }}>Loading conversation...</p>
            </div>
          </div>
        )}

        {/* Conversation not found */}
        {convNotFound && !convLoading && (
          <div role="alert" className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-[1rem] font-semibold mb-2" style={{ color: t1 }}>Conversation not found</p>
              <p className="text-[0.85rem] mb-4" style={{ color: t2 }}>This conversation doesn't exist or you don't have access.</p>
              <button onClick={newChat}
                className="px-4 py-2 rounded-xl text-[0.85rem] font-semibold text-white"
                style={{ background: "#1F06AC" }}>
                Start new chat
              </button>
            </div>
          </div>
        )}

        {convError && !convLoading && <div role="alert" className="flex h-full items-center justify-center px-6">
          <div className="text-center" style={{ color: t1 }}>
            <p className="mb-4 text-sm">{convError}</p>
            <button onClick={() => activeId && void loadConversation(activeId)} aria-label="Retry conversation"
              className="rounded-xl px-4 py-2 text-sm font-semibold text-white" style={{ background: "#1F06AC" }}>Retry</button>
          </div>
        </div>}

        {activeId && !hasMessages && !convLoading && !convNotFound && !convError && (
          <p role="status" className="px-6 py-8 text-center text-sm" style={{ color: t2 }}>No messages in this conversation yet.</p>
        )}

        {/* Welcome screen */}
        {!hasMessages && !convLoading && !convNotFound && !activeId && (
          <div className="flex flex-col items-center justify-start min-h-full px-6 pt-10 lg:pt-16 pb-6 max-w-2xl mx-auto w-full">
            <motion.div initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5 }} className="mb-6">
              <OrbHero size={90} />
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }} className="text-center mb-8">
              <h2 className="text-[1.55rem] font-bold mb-1" style={{ color: isDark ? "#b4a8ff" : "#1F06AC" }}>
                Hello, {firstName}
              </h2>
              <h3 className="text-[1.75rem] font-extrabold tracking-tight mb-3" style={{ color: t1 }}>
                {storeContext.loadError
                  ? "I couldn't verify your store connection"
                  : storeContext.connected
                    ? `What do you want to know about ${storeLabel(storeContext)}?`
                    : "How can I help your revenue today?"}
              </h3>
              <p className="text-[0.88rem] max-w-md mx-auto leading-relaxed" style={{ color: t2 }}>
                I explain your available store data, investigate findings,
                and suggest next steps for you to review.
              </p>
            </motion.div>

            {/* Data-health states. A confident answer built on an incomplete or
                stale feed misleads the merchant, so say so before they ask. */}
            {storeContext.loaded && !storeContext.loadError && !storeContext.connected && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="w-full mb-5 flex items-start gap-3 p-3.5 rounded-xl"
                style={{ background: "rgba(220,38,38,0.07)", border: "1px solid rgba(220,38,38,0.25)" }}>
                <AlertCircle size={17} className="mt-0.5 flex-shrink-0" style={{ color: "#dc2626" }} />
                <div>
                  <p className="text-[0.8rem] font-semibold mb-0.5" style={{ color: t1 }}>
                    No store connected
                  </p>
                  <p className="text-[0.75rem] leading-snug" style={{ color: t2 }}>
                    Rev answers from your real Shopify data. Connect a store and finish the
                    first sync before asking about revenue, products or customers.
                  </p>
                </div>
              </motion.div>
            )}

            {storeContext.loaded && storeContext.loadError && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="w-full mb-5 flex items-start gap-3 p-3.5 rounded-xl"
                style={{ background: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.28)" }}>
                <AlertCircle size={17} className="mt-0.5 flex-shrink-0" style={{ color: "#d97706" }} />
                <div className="min-w-0 flex-1">
                  <p className="text-[0.8rem] font-semibold mb-0.5" style={{ color: t1 }}>
                    Store connection couldn't be verified
                  </p>
                  <p className="text-[0.75rem] leading-snug" style={{ color: t2 }}>
                    This status check failed. It does not mean your Shopify store is disconnected.
                  </p>
                  <button type="button" onClick={() => void loadStoreContext()}
                    className="mt-2 rounded-md text-xs font-semibold underline underline-offset-2"
                    style={{ color: isDark ? "#b4a8ff" : "#1F06AC" }}>
                    Retry connection check
                  </button>
                </div>
              </motion.div>
            )}

            {storeContext.connected && isSyncIncomplete(storeContext) && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="w-full mb-5 flex items-start gap-3 p-3.5 rounded-xl"
                style={{ background: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.28)" }}>
                <AlertCircle size={17} className="mt-0.5 flex-shrink-0" style={{ color: "#d97706" }} />
                <div>
                  <p className="text-[0.8rem] font-semibold mb-0.5" style={{ color: t1 }}>
                    Initial sync in progress
                  </p>
                  <p className="text-[0.75rem] leading-snug" style={{ color: t2 }}>
                    {storeLabel(storeContext)} is connected but its first sync has not
                    completed. Answers may be incomplete until it finishes.
                  </p>
                </div>
              </motion.div>
            )}

            {storeContext.connected && !isSyncIncomplete(storeContext) && hasWebhookGap(storeContext) && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="w-full mb-5 flex items-start gap-3 p-3.5 rounded-xl"
                style={{ background: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.28)" }}>
                <AlertCircle size={17} className="mt-0.5 flex-shrink-0" style={{ color: "#d97706" }} />
                <div>
                  <p className="text-[0.8rem] font-semibold mb-0.5" style={{ color: t1 }}>
                    Incomplete webhook coverage
                  </p>
                  <p className="text-[0.75rem] leading-snug" style={{ color: t2 }}>
                    {storeContext.webhooksRegistered ?? 0} of {storeContext.webhooksRequired ?? 0} required
                    Shopify webhooks are registered, so recent changes may not appear yet.
                  </p>
                </div>
              </motion.div>
            )}

            {storeContext.connected && !isSyncIncomplete(storeContext) && !hasWebhookGap(storeContext)
              && isSyncStale(storeContext) && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="w-full mb-5 flex items-start gap-3 p-3.5 rounded-xl"
                style={{ background: "rgba(31,6,172,0.06)", border: `1px solid ${bdr}` }}>
                <AlertCircle size={17} className="mt-0.5 flex-shrink-0" style={{ color: "#1F06AC" }} />
                <div>
                  <p className="text-[0.8rem] font-semibold mb-0.5" style={{ color: t1 }}>
                    Data may be out of date
                  </p>
                  <p className="text-[0.75rem] leading-snug" style={{ color: t2 }}>
                    The last successful sync of {storeLabel(storeContext)} was{" "}
                    {new Date(storeContext.lastSyncedAt as string).toLocaleString()}. Rev discloses
                    freshness with every answer.
                  </p>
                </div>
              </motion.div>
            )}

            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }} className="w-full mb-7">
              {imageAttachment && (
                <div className="flex items-center gap-3 mb-2 px-1">
                  <div className="relative">
                    <img src={imageAttachment.preview} alt="attachment"
                      className="h-14 w-14 rounded-xl object-cover border"
                      style={{ borderColor: bdr }} />
                    <button onClick={removeAttachment} aria-label="Remove attachment"
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold"
                      style={{ background: "#dc2626" }}>×</button>
                  </div>
                  <span className="text-[0.75rem]" style={{ color: t2 }}>{imageAttachment.name.slice(0, 40)}</span>
                </div>
              )}
              <InputToolbar {...inputProps} placeholder="Ask me anything about your business..." />
            </motion.div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 w-full">
              {STARTERS.map((s, i) => (
                <motion.button key={s.label}
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 + i * 0.05 }}
                  onClick={() => send(s.sub)}
                  disabled={findingLoading || Boolean(findingError)}
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
        {hasMessages && !convLoading && !convNotFound && !convError && (
          <div className="w-full max-w-2xl mx-auto px-4 pt-14 pb-4 lg:pt-6">
            {messages.map(msg => (
              <Bubble key={msg.id} msg={msg} onCopy={copy}
                actionsDisabled={thinking || messagesMore || messagesMoreLoading}
                onRetry={() => void handleRetry(msg)} onSend={send}
                retryLabel={msg.persistence === "not-persisted" && msg === messages[messages.length - 1] ? "Try again" : "Ask again"}
                onOpenEvidence={(messageId) => setEvidenceFor(current => (current === messageId ? null : messageId))}
                evidenceOpen={evidenceFor === msg.id}
                onFeedback={submitFeedback}
                speechSupported={speechSupported}
                speaking={speakingId === msg.id}
                onReadAloud={toggleReadAloud}
                isDark={isDark} t1={t1} t2={t2} />
            ))}
            {messagesMore && <p role="status" className="mt-3 text-xs" style={{ color: t2 }}>Showing the start of this conversation. Load the remaining messages before continuing.</p>}
            <LoadMore available={messagesMore} loading={messagesMoreLoading} error={messagesMoreError} onLoad={() => activeId && void loadConversation(activeId, true)} label="Load more messages" />
            <div ref={bottomRef} />
          </div>
        )}
      </div>
      <JumpToLatest visible={showJumpToLatest} onClick={jumpToLatest} dark={isDark} />
      </div>

      {/* Sticky input — active conversation */}
      {(hasMessages || activeId) && !convLoading && !convNotFound && !convError && (
        <div className="shrink-0 px-4 pb-4 pt-2 border-t" style={{ borderColor: bdr, background: bg }}>
          <div className="max-w-2xl mx-auto">
            {/* Image attachment preview */}
            {imageAttachment && (
              <div className="flex items-center gap-3 mb-2 px-1">
                <div className="relative group/img">
                  <img src={imageAttachment.preview} alt="attachment"
                    className="h-14 w-14 rounded-xl object-cover border"
                    style={{ borderColor: bdr }} />
                  <button onClick={removeAttachment} aria-label="Remove attachment"
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold"
                    style={{ background: "#dc2626" }}>×</button>
                </div>
                <span className="text-[0.75rem]" style={{ color: t2 }}>{imageAttachment.name.slice(0, 40)}</span>
              </div>
            )}
            <InputToolbar {...inputProps} placeholder="Ask Rev anything..." disabled={thinking || findingLoading || Boolean(findingError) || messagesMore || messagesMoreLoading} />
            <p className="text-center text-[0.63rem] mt-2" style={{ color: t4 }}>
              Rev Intelligence · Powered by your store data · Responses grounded in evidence
            </p>
          </div>
        </div>
      )}

      </div>
      {/* The single history drawer, for touch and narrow viewports.
          It must be a Radix ModalSurface, not a bare positioned div: the dialog
          primitive is what aria-hides the workspace behind it. Without that the
          desktop rail stays reachable while the drawer is open, and a merchant
          offered a failing history sees two independent retry controls for the
          same request. Escape and focus restoration come from the same layer,
          which is what lets a rename/delete dialog open on top of the drawer and
          return focus to the row that launched it. */}
      {createPortal(
        <AnimatePresence>
          {menuOpen && (
            <motion.div className="fixed inset-0 z-[170] flex justify-end" role="presentation">
              <motion.div className="absolute inset-0"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
                style={{ background: "rgba(8,10,18,0.38)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
                onClick={() => setMenuOpen(false)} />
              <ModalSurface onClose={() => setMenuOpen(false)} aria-label="Conversation history"
                role="dialog" aria-modal="true"
                initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
                transition={{ type: "spring", stiffness: 360, damping: 36 }}
                className="relative z-10 h-full w-[min(390px,calc(100vw-12px))] max-w-full overflow-hidden shadow-2xl"
                style={{ background: isDark ? "#111116" : "#ffffff", borderLeft: `1px solid ${bdr}`, boxShadow: "-18px 0 56px rgba(0,0,0,0.24)" }}>
                <ConversationHistoryList onClose={() => setMenuOpen(false)}
                  conversations={conversations} activeId={activeId}
                  loading={historyLoading} error={historyError}
                  onRetry={() => void loadConversations()}
                  query={searchQuery} onQuery={changeSearch}
                  onNew={newChat} onSelect={openConversation}
                  onRename={(id, trigger) => { dialogReturnRef.current = trigger; renameConv(id); }}
                  onDelete={(id, trigger) => { dialogReturnRef.current = trigger; setDeleteConfirmId(id); }}
                  pagination={<LoadMore available={historyMore} loading={historyMoreLoading} error={historyMoreError} onLoad={() => void loadConversations(undefined, true)} label="Load more conversations" />}
                  isDark={isDark} t1={t1} t2={t2} border={bdr} />
              </ModalSurface>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Evidence drawer — verified facts, calculations and limits for one turn. */}
      {createPortal(
        <AnimatePresence>
          {(() => {
            const message = messages.find(entry => entry.id === evidenceFor);
            const open = Boolean(message?.payload);
            return open && message?.payload ? (
              <motion.div key="rev-evidence" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0 z-[180] flex justify-end">
                <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.35)" }}
                  onClick={() => setEvidenceFor(null)} />
                <ModalSurface onClose={() => setEvidenceFor(null)}
                  initial={{ x: 32, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 32, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  role="dialog" aria-modal="true" aria-label="Investigation evidence"
                  className="relative h-full w-full max-w-[460px] shadow-2xl overflow-hidden"
                  style={{ background: card, borderLeft: `1px solid ${bdr}` }}>
                  <EvidencePanel
                    key={`${message.id}:${focusedEvidenceId ?? "all"}`}
                    focusEvidenceId={focusedEvidenceId}
                    evidence={message.payload.evidence}
                    facts={message.payload.facts}
                    comparisonFacts={message.payload.comparison_facts}
                    hypotheses={message.payload.hypotheses}
                    unknowns={message.payload.unknowns}
                    recommendations={message.payload.recommendations}
                    dark={isDark}
                    asSheet
                    onClose={() => { setEvidenceFor(null); setFocusedEvidenceId(null); }}
                  />
                </ModalSurface>
              </motion.div>
            ) : null;
          })()}
        </AnimatePresence>,
        document.body
      )}

      {/* Rename dialog uses the same viewport-centered mobile UX as deletion. */}
      {createPortal(
        <AnimatePresence>
          {renameModalId && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[200] flex items-center justify-center p-4">
              <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.5)" }}
                onClick={() => { if (renameStatus === "idle") setRenameModalId(null); }} />
              <ModalSurface returnFocusTo={dialogReturnRef.current} onClose={() => { if (renameStatus === "idle") setRenameModalId(null); }} initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                transition={{ duration: 0.15 }}
                role="dialog" aria-modal="true" aria-labelledby="rev-rename-title"
                className="relative z-10 w-full max-w-sm max-h-[90dvh] overflow-y-auto rounded-2xl p-6 shadow-2xl"
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
                      className="min-h-11 px-4 py-2 rounded-xl text-[0.82rem] font-medium disabled:opacity-50"
                      style={{ color: t2, background: isDark ? "#1f1f1f" : "#f3f4f6", fontFamily: "inherit" }}>
                      Cancel
                    </button>
                    <button type="submit" disabled={!renameValue.trim() || renameStatus !== "idle"}
                      className="min-w-[100px] min-h-11 px-4 py-2 rounded-xl text-[0.82rem] font-bold text-white flex items-center justify-center gap-2 disabled:cursor-wait"
                      style={{ background: renameStatus === "idle" ? "#1F06AC" : renameStatus === "saved" ? "#16a34a" : "#9ca3af", fontFamily: "inherit" }}>
                      {renameStatus === "saving" ? <><RefreshCw size={14} className="animate-spin" />Saving...</> : renameStatus === "saved" ? "Saved ✓" : "Save"}
                    </button>
                  </div>
                </form>
              </ModalSurface>
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
              <ModalSurface hasDescription returnFocusTo={dialogReturnRef.current} onClose={() => { if (!deletingConvId) setDeleteConfirmId(null); }} initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                transition={{ duration: 0.15 }}
                role="alertdialog" aria-modal="true" aria-labelledby="rev-delete-title"
                className="relative z-10 w-full max-w-sm max-h-[90dvh] overflow-y-auto rounded-2xl p-6 shadow-2xl"
                style={{ background: card, border: `1px solid ${bdr}` }}>
                <p id="rev-delete-title" className="text-[0.9rem] font-bold mb-2" style={{ color: t1 }}>Delete conversation?</p>
                <DialogPrimitive.Description className="text-[0.82rem] mb-6" style={{ color: t2 }}>
                  This conversation will be permanently deleted and cannot be recovered.
                </DialogPrimitive.Description>
                {deleteError && <p role="alert" className="text-[0.78rem] mb-3 text-red-500">{deleteError}</p>}
                <div className="flex gap-2 justify-end">
                  <button type="button" disabled={!!deletingConvId}
                    onClick={() => { setDeleteConfirmId(null); setDeleteError(null); }}
                    className="min-h-11 px-4 py-2 rounded-xl text-[0.82rem] font-medium disabled:opacity-50"
                    style={{ color: t2, background: isDark ? "#1f1f1f" : "#f3f4f6", fontFamily: "inherit" }}>
                    Cancel
                  </button>
                  <button type="button" disabled={!!deletingConvId}
                    onClick={() => deleteConv(deleteConfirmId)}
                    className="min-w-[98px] min-h-11 px-4 py-2 rounded-xl text-[0.82rem] font-bold text-white flex items-center justify-center gap-2 disabled:cursor-wait"
                    style={{ background: deletingConvId ? "#9ca3af" : "#dc2626", fontFamily: "inherit" }}>
                    {deletingConvId ? <><RefreshCw size={14} className="animate-spin" />Deleting...</> : "Delete"}
                  </button>
                </div>
              </ModalSurface>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {copyError && <p role="alert" className="fixed bottom-6 left-4 right-4 z-50 rounded-xl border p-3 text-sm" style={{ background: card, color: t1 }}>{copyError}</p>}
      {/* Copy toast */}
        {copied && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            role="status" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 rounded-full text-[0.8rem] shadow-lg"
            style={{ background: card, border: `1px solid ${bdr}`, color: t1 }}>
            <Copy size={12} />Copied
          </motion.div>
        )}
    </div>
    </MotionConfig>
  );
}
