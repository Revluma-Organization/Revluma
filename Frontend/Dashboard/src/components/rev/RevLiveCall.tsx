import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { AudioLines, Maximize2, MessageSquareText, Mic, MicOff, PhoneOff } from "lucide-react";
import { RevLiveBars, RevLiveOrb } from "@/components/rev/RevLiveVisuals";
import { activityLabel, formatCallTime, tidyTranscript, type TranscriptEntry } from "@/lib/revLiveCall";
import type { RevLiveCall } from "@/lib/useRevLiveCall";

// Live voice call UI (ChatGPT Voice study):
// - In chat (default): the conversation stays on screen with a live
//   transcript, and the composer becomes a call bar: who has the floor, a
//   voice meter, the timer, mute, full screen and End.
// - Full screen: a focused orb view with live captions; "Show chat" returns.
// Both use 44 px+ targets with labels, visible focus rings, one polite status
// region for call-level changes (not every speaking turn), and honour
// prefers-reduced-motion.

const EASE = [0.22, 1, 0.36, 1] as const;

function remainingLabel(seconds: number | null): string | null {
  if (seconds === null) return null;
  if (seconds < 60) return `${seconds}s left today`;
  return `${Math.ceil(seconds / 60)} min left today`;
}

function callStatusText(call: RevLiveCall): string {
  if (call.phase === "starting" || call.phase === "connecting") return "Starting a voice call with Rev.";
  if (call.phase === "reconnecting") return "Reconnecting the call.";
  if (call.phase === "live") return call.muted ? "Call connected. You're muted." : "Call connected. Rev is listening.";
  if (call.phase === "ending") return "Ending the call.";
  return "";
}

export function RevLiveCallBar({ call, isDark, card, border, t1, t2 }: {
  call: RevLiveCall; isDark: boolean; card: string; border: string; t1: string; t2: string;
}) {
  const brand = isDark ? "#B4A8FF" : "#2B13CF";
  const idle = isDark ? "rgba(245,245,245,0.22)" : "rgba(12,10,29,0.18)";
  const connecting = call.phase === "starting" || call.phase === "connecting" || call.phase === "reconnecting";
  const left = remainingLabel(call.remainingSeconds);
  const hover = "transition-colors hover:bg-black/5 dark:hover:bg-white/10";
  const ring = "focus-visible:rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6F66FF]";

  return (
    <motion.div data-rev-live-call="chat" role="group" aria-label="Voice call with Rev"
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: EASE }}
      className="rev-composer flex items-center gap-2 rounded-[26px] py-2.5 pl-3 pr-2.5"
      style={{ background: card, border: `1px solid ${border}`,
        boxShadow: isDark ? "0 10px 30px rgba(0,0,0,0.35)" : "0 1px 2px rgba(16,24,40,0.04), 0 10px 28px -12px rgba(16,24,40,0.14)" }}>
      <span className="sr-only" role="status" aria-live="polite">{callStatusText(call)}</span>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
        style={{ background: isDark ? "rgba(180,168,255,0.1)" : "rgba(43,19,207,0.06)" }}>
        {connecting
          ? <span className="rv-rec-dot h-2 w-2 rounded-full" style={{ background: brand }} aria-hidden="true" />
          : <RevLiveBars levelsRef={call.levelsRef} activity={call.activity} color={brand} idleColor={idle} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 truncate text-[0.88rem] font-semibold" style={{ color: t1 }} data-rev-live-activity={call.activity}>
          {activityLabel(call.phase, call.activity, call.muted)}
        </p>
        <p className="m-0 truncate text-[0.72rem] tabular-nums" style={{ color: t2 }}>
          {call.startedAt ? formatCallTime(call.elapsedMs) : "Voice call"}{left ? ` · ${left}` : ""}
        </p>
      </div>
      <button type="button" onClick={call.toggleMute} disabled={call.phase === "ending"}
        aria-label={call.muted ? "Unmute microphone" : "Mute microphone"} aria-pressed={call.muted}
        title={call.muted ? "Unmute" : "Mute"}
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full disabled:opacity-50 ${hover} ${ring}`}
        style={{ color: call.muted ? (isDark ? "#fca5a5" : "#b91c1c") : t1 }}>
        {call.muted ? <MicOff size={18} /> : <Mic size={18} />}
      </button>
      <button type="button" onClick={() => call.setView("full")} disabled={call.phase === "ending"}
        aria-label="Full screen call view" title="Full screen"
        className={`hidden h-11 w-11 shrink-0 items-center justify-center rounded-full min-[380px]:flex disabled:opacity-50 ${hover} ${ring}`}
        style={{ color: t1 }}>
        <Maximize2 size={17} />
      </button>
      <motion.button type="button" onClick={() => call.end("hangup")} disabled={call.phase === "ending"}
        whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.95 }}
        aria-label="End call" title="End call"
        className={`ml-0.5 flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-full px-4 text-[0.84rem] font-semibold text-white disabled:opacity-60 ${ring} focus-visible:ring-offset-2`}
        style={{ background: "#E5484D", boxShadow: "0 6px 16px -6px rgba(229,72,77,0.6)",
          ["--tw-ring-offset-color" as string]: isDark ? "#0D0D0D" : "#ffffff" }}>
        <PhoneOff size={16} />
        <span>End</span>
      </motion.button>
    </motion.div>
  );
}

export function RevLiveCallStage({ call, isDark }: { call: RevLiveCall; isDark: boolean }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const muteRef = useRef<HTMLButtonElement>(null);
  const bg = isDark ? "#000000" : "#fbfaf8";
  const t1 = isDark ? "#F5F5F5" : "#0c0a1d";
  const t2 = isDark ? "#A3A3A3" : "#5b5872";
  const line = isDark ? "#262626" : "#E8E6E1";
  const caption = [...call.transcript].reverse().find(entry => tidyTranscript(entry.text));
  const left = remainingLabel(call.remainingSeconds);
  const { setView } = call;

  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null;
    muteRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setView("chat"); return; }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled])")];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (returnTo && document.contains(returnTo)) returnTo.focus();
    };
  }, [setView]);

  const control = "flex h-14 w-14 items-center justify-center rounded-full transition-[transform,background-color] active:scale-95 focus-visible:rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6F66FF] focus-visible:ring-offset-2 disabled:opacity-50";
  const secondary = { background: isDark ? "rgba(255,255,255,0.08)" : "rgba(12,10,29,0.06)", color: t1,
    ["--tw-ring-offset-color" as string]: bg };

  return createPortal(
    <motion.div ref={dialogRef} data-rev-modal="" data-rev-live-call="full" role="dialog" aria-modal="true"
      aria-label="Voice call with Rev"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22, ease: EASE }}
      className="fixed inset-0 z-[160] flex flex-col" style={{ background: bg, color: t1 }}>
      <div className="flex items-center justify-between px-4 pt-[max(16px,env(safe-area-inset-top))] sm:px-6">
        <div className="flex items-center gap-2 text-[0.92rem] font-semibold">
          <AudioLines size={18} aria-hidden="true" style={{ color: isDark ? "#B4A8FF" : "#2B13CF" }} />
          Rev
          <span className="rounded-full px-2 py-0.5 text-[0.68rem] font-medium" style={{ border: `1px solid ${line}`, color: t2 }}>Voice</span>
        </div>
        <p className="m-0 text-[0.8rem] tabular-nums" style={{ color: t2 }}>
          {call.startedAt ? formatCallTime(call.elapsedMs) : ""}{left ? ` · ${left}` : ""}
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-7 px-6">
        <motion.div initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.4, ease: EASE }}>
          <RevLiveOrb levelsRef={call.levelsRef} activity={call.activity} isDark={isDark} muted={call.muted}
            connecting={call.phase === "starting" || call.phase === "connecting" || call.phase === "reconnecting"} size="min(300px, 64vw, 40vh)" />
        </motion.div>
        <div className="flex max-w-xl flex-col items-center gap-2 text-center">
          <p className="m-0 text-[1.05rem] font-semibold" data-rev-live-activity={call.activity}>
            {activityLabel(call.phase, call.activity, call.muted)}
          </p>
          <span className="sr-only" role="status" aria-live="polite">{callStatusText(call)}</span>
          <p className="m-0 line-clamp-3 min-h-[4.5em] text-[0.95rem] leading-relaxed" style={{ color: t2 }} data-rev-live-caption="">
            {caption ? tidyTranscript(caption.text) : "Talk to Rev like you would to a person. Ask about sales, orders, products or anything in your store."}
          </p>
        </div>
      </div>

      <div className="flex items-end justify-center gap-6 px-6 pb-[max(28px,env(safe-area-inset-bottom))] pt-4 sm:gap-8">
        <div className="flex flex-col items-center gap-1.5">
          <button ref={muteRef} type="button" onClick={call.toggleMute} disabled={call.phase === "ending"}
            aria-label={call.muted ? "Unmute microphone" : "Mute microphone"} aria-pressed={call.muted}
            className={control} style={call.muted ? { ...secondary, background: isDark ? "rgba(229,72,77,0.18)" : "rgba(229,72,77,0.12)", color: isDark ? "#fca5a5" : "#b91c1c" } : secondary}>
            {call.muted ? <MicOff size={22} /> : <Mic size={22} />}
          </button>
          <span className="text-[0.72rem]" style={{ color: t2 }} aria-hidden="true">{call.muted ? "Unmute" : "Mute"}</span>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <button type="button" onClick={() => call.end("hangup")} disabled={call.phase === "ending"}
            aria-label="End call" className={`${control} h-16 w-16 text-white`}
            style={{ background: "#E5484D", boxShadow: "0 10px 26px -10px rgba(229,72,77,0.7)", ["--tw-ring-offset-color" as string]: bg }}>
            <PhoneOff size={24} />
          </button>
          <span className="text-[0.72rem]" style={{ color: t2 }} aria-hidden="true">End</span>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <button type="button" onClick={() => call.setView("chat")} aria-label="Show chat and transcript"
            className={control} style={secondary}>
            <MessageSquareText size={22} />
          </button>
          <span className="text-[0.72rem]" style={{ color: t2 }} aria-hidden="true">Chat</span>
        </div>
      </div>
    </motion.div>,
    document.body,
  );
}

export function RevLiveTranscriptLine({ entry, isDark, t1, t2 }: {
  entry: TranscriptEntry; isDark: boolean; t1: string; t2: string;
}) {
  const text = tidyTranscript(entry.text);
  if (!text) return null;
  const pending = !entry.final;
  if (entry.speaker === "user") {
    return (
      <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16, ease: "easeOut" }}
        className="rev-turn flex flex-col items-end gap-1 mb-5" data-rev-transcript="user">
        <div className="flex max-w-[85%] items-start gap-2 rounded-3xl px-4 py-2.5 text-[0.94rem] leading-relaxed break-words [overflow-wrap:anywhere] sm:max-w-[70%]"
          style={{ background: isDark ? "rgba(255,255,255,0.06)" : "#F1EFFC", color: t1, opacity: pending ? 0.75 : 1 }}>
          <Mic size={13} className="mt-[5px] shrink-0" aria-hidden="true" style={{ color: t2 }} />
          <span><span className="sr-only">You said: </span>{text}</span>
        </div>
      </motion.div>
    );
  }
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16, ease: "easeOut" }}
      className="rev-turn flex items-start gap-2 mb-5" data-rev-transcript="rev">
      <AudioLines size={14} className="mt-[5px] shrink-0" aria-hidden="true" style={{ color: isDark ? "#B4A8FF" : "#2B13CF" }} />
      <p className="m-0 text-[0.94rem] leading-relaxed break-words [overflow-wrap:anywhere]" style={{ color: t1, opacity: pending ? 0.8 : 1 }}>
        <span className="sr-only">Rev said: </span>{text}{entry.interrupted ? "…" : ""}
        {entry.interrupted && <span className="ml-1.5 text-[0.72rem]" style={{ color: t2 }}>(interrupted)</span>}
      </p>
    </motion.div>
  );
}
