import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Check, X } from "lucide-react";

// Recording bar shown in place of the composer toolbar while the merchant
// dictates (ChatGPT voice-input study, ui-ux-pro-max "voice-first" checklist):
//
//   [ X cancel ]  ▁▂▅▇▅▂▁ live waveform ▁▂▃  0:07  [ ✓ done ]
//
// - The waveform is drawn on a canvas from a Web Audio AnalyserNode, so it
//   reacts to the merchant's actual voice. Bars enter on the right and scroll
//   left; silence draws as a row of dots. Without a mic stream (permission for
//   the waveform unavailable) it falls back to pulses driven by recognised words.
// - Listening state is unmistakable: brand-coloured bars, a live timer and a
//   pulsing dot. Under prefers-reduced-motion the bars update in place at a
//   low rate instead of scrolling.
// - Both actions are 44 px targets with clear labels; Escape also cancels.

const BAR_W = 2;
const GAP = 3;
const SAMPLE_MS = 55;

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function Waveform({ stream, activityRef, color, idleColor }: {
  stream: MediaStream | null; activityRef: React.MutableRefObject<number>;
  color: string; idleColor: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try { ctx = canvas.getContext("2d"); } catch { ctx = null; }
    if (!ctx) return;

    let audio: AudioContext | null = null;
    let readLevel: (() => number) | null = null;
    if (stream) {
      try {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctor) {
          audio = new Ctor();
          const source = audio.createMediaStreamSource(stream);
          const analyser = audio.createAnalyser();
          analyser.fftSize = 1024;
          analyser.smoothingTimeConstant = 0.6;
          source.connect(analyser);
          const buffer = new Uint8Array(analyser.fftSize);
          readLevel = () => {
            analyser.getByteTimeDomainData(buffer);
            let sum = 0;
            for (let i = 0; i < buffer.length; i += 1) { const v = (buffer[i] - 128) / 128; sum += v * v; }
            // Perceptual curve: normal speech (RMS ~0.02 - 0.2) fills the bar range.
            return Math.min(1, Math.pow(Math.sqrt(sum / buffer.length) * 5, 0.7));
          };
          void audio.resume?.();
        }
      } catch { readLevel = null; }
    }

    const levels: number[] = [];
    let lastActivity = activityRef.current;
    let pulse = 0;
    let last = 0;
    let raf = 0;
    const interval = reduce ? 220 : SAMPLE_MS;

    const sample = () => {
      if (readLevel) return readLevel();
      // Fallback: each recognised word burst produces a short pulse.
      if (activityRef.current !== lastActivity) { lastActivity = activityRef.current; pulse = 0.85; }
      pulse *= 0.78;
      return pulse * (0.6 + Math.random() * 0.4);
    };

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < interval) return;
      last = now;
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) return;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      const capacity = Math.max(1, Math.floor(width / (BAR_W + GAP)));
      const level = sample();
      if (reduce) { levels.length = 0; for (let i = 0; i < capacity; i += 1) levels.push(level); }
      else { levels.push(level); while (levels.length > capacity) levels.shift(); }

      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, width, height);
      const mid = height / 2;
      for (let i = 0; i < capacity; i += 1) {
        const value = levels[levels.length - capacity + i];
        const x = width - (capacity - i) * (BAR_W + GAP) + GAP;
        const active = value !== undefined && value > 0.04;
        const barH = active ? Math.max(BAR_W, value * (height - 2)) : BAR_W;
        ctx!.fillStyle = active ? color : idleColor;
        ctx!.beginPath();
        if (typeof ctx!.roundRect === "function") ctx!.roundRect(x, mid - barH / 2, BAR_W, barH, BAR_W / 2);
        else ctx!.rect(x, mid - barH / 2, BAR_W, barH);
        ctx!.fill();
      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      void audio?.close().catch(() => undefined);
    };
  }, [stream, activityRef, color, idleColor, reduce]);

  return <canvas ref={canvasRef} aria-hidden="true" data-rev-waveform="" className="block h-8 w-full" />;
}

export function RevDictationBar({ startedAt, stream, activityRef, starting, onCancel, onDone, isDark, t2 }: {
  startedAt: number | null; stream: MediaStream | null;
  activityRef: React.MutableRefObject<number>; starting: boolean;
  onCancel: () => void; onDone: () => void; isDark: boolean; t2: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  // Escape cancels from anywhere while dictating.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); onCancel(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const brand = isDark ? "#B4A8FF" : "#2B13CF";
  const idle = isDark ? "rgba(245,245,245,0.22)" : "rgba(12,10,29,0.18)";

  return (
    <motion.div data-rev-dictation="" role="group" aria-label="Voice input"
      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="flex items-center gap-2 px-2.5 pb-2.5">
      <button type="button" onClick={onCancel} aria-label="Cancel voice input" title="Cancel (Esc)"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6F66FF] dark:hover:bg-white/10"
        style={{ color: t2 }}>
        <X size={18} strokeWidth={2.2} />
      </button>
      <div className="min-w-0 flex-1">
        <Waveform stream={stream} activityRef={activityRef} color={brand} idleColor={idle} />
      </div>
      <span className="flex shrink-0 items-center gap-1.5 text-[0.78rem] tabular-nums" style={{ color: t2 }}>
        <span aria-hidden="true" className="rv-rec-dot h-1.5 w-1.5 rounded-full" style={{ background: "#E5484D" }} />
        {starting || !startedAt ? "Starting…" : formatElapsed(now - startedAt)}
      </span>
      <motion.button type="button" onClick={onDone} aria-label="Stop voice input and keep text" title="Done"
        whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.92 }}
        className="ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6F66FF] focus-visible:ring-offset-2"
        style={{ background: "#1F06AC", boxShadow: "0 6px 16px -6px rgba(31,6,172,0.55)",
          ["--tw-ring-offset-color" as string]: isDark ? "#0D0D0D" : "#ffffff" }}>
        <Check size={18} strokeWidth={2.6} />
      </motion.button>
    </motion.div>
  );
}
