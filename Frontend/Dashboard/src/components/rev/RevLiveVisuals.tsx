import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";
import type { CallActivity } from "@/lib/revLiveCall";

// Voice visuals for live calls with Rev. Both read audio levels from a ref on
// animation frames and write transforms directly (no React re-render per
// frame), and both respect prefers-reduced-motion: levels then step at a low
// rate with no idle breathing or rotation.
//
// RevLiveOrb   full-screen orb. Rev speaking: the core swells with Rev's voice.
//              Merchant speaking: a ring expands with their voice. Checking the
//              store or thinking: a slow shimmer. Listening: gentle breathing.
// RevLiveBars  compact four-bar meter for the in-chat call bar.

type Levels = React.MutableRefObject<{ input: number; output: number }>;

const ORB_CSS = `
@keyframes rv-orb-breathe { 0%,100% { transform: scale(1); } 50% { transform: scale(1.035); } }
@keyframes rv-orb-spin { to { transform: rotate(360deg); } }
@keyframes rv-orb-shimmer { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
.rv-orb-breathe { animation: rv-orb-breathe 4.2s cubic-bezier(.45,0,.55,1) infinite; }
.rv-orb-spin { animation: rv-orb-spin 9s linear infinite; }
.rv-orb-spin-fast { animation: rv-orb-spin 2.8s linear infinite; }
.rv-orb-shimmer { animation: rv-orb-shimmer 1.6s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .rv-orb-breathe, .rv-orb-spin, .rv-orb-spin-fast, .rv-orb-shimmer { animation: none !important; }
}
`;

export function RevLiveOrb({ levelsRef, activity, size = 220, isDark, muted = false }: {
  levelsRef: Levels; activity: CallActivity; size?: number; isDark: boolean; muted?: boolean;
}) {
  const coreRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const activityRef = useRef(activity);
  activityRef.current = activity;

  useEffect(() => {
    let raf = 0;
    let last = 0;
    let core = 0;
    let ring = 0;
    const step = (time: number) => {
      raf = requestAnimationFrame(step);
      if (reduce && time - last < 200) return;
      last = time;
      const { input, output } = levelsRef.current;
      const mode = activityRef.current;
      const targetCore = mode === "rev" ? output : 0;
      const targetRing = mode === "user" ? input : 0;
      const ease = reduce ? 1 : 0.22;
      core += (targetCore - core) * ease;
      ring += (targetRing - ring) * ease;
      if (coreRef.current) coreRef.current.style.transform = `scale(${1 + core * 0.16})`;
      if (glowRef.current) glowRef.current.style.transform = `scale(${1 + core * 0.3 + ring * 0.12})`;
      if (ringRef.current) {
        ringRef.current.style.transform = `scale(${1.04 + ring * 0.3})`;
        ringRef.current.style.opacity = String(Math.min(1, ring * 2.2));
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [levelsRef, reduce]);

  const brand = isDark
    ? "conic-gradient(from 210deg, #6F66FF, #B4A8FF, #8F86FF, #E2DDFF, #6F66FF)"
    : "conic-gradient(from 210deg, #2B13CF, #6F66FF, #B4A8FF, #4B36E8, #2B13CF)";
  const waiting = activity === "checking" || activity === "thinking";

  return (
    <div aria-hidden="true" data-rev-live-orb={activity} className="relative" style={{ width: size, height: size }}>
      <style>{ORB_CSS}</style>
      <div ref={glowRef} className="absolute inset-0 rounded-full"
        style={{ background: isDark ? "radial-gradient(circle, rgba(111,102,255,0.45), transparent 68%)"
          : "radial-gradient(circle, rgba(43,19,207,0.28), transparent 68%)", filter: "blur(18px)",
          transition: "opacity 300ms ease", opacity: muted ? 0.35 : 1 }} />
      <div ref={ringRef} className="absolute inset-[6%] rounded-full"
        style={{ border: `2px solid ${isDark ? "rgba(180,168,255,0.65)" : "rgba(43,19,207,0.45)"}`, opacity: 0 }} />
      <div className={activity === "listening" && !muted ? "absolute inset-[10%] rv-orb-breathe" : "absolute inset-[10%]"}>
        <div ref={coreRef} className="absolute inset-0 overflow-hidden rounded-full"
          style={{ boxShadow: isDark ? "inset 0 0 40px rgba(255,255,255,0.18)" : "inset 0 0 40px rgba(255,255,255,0.35), 0 20px 50px -18px rgba(43,19,207,0.55)",
            filter: muted ? "grayscale(0.85) opacity(0.6)" : undefined, transition: "filter 240ms ease" }}>
          <div className={`absolute -inset-1/4 ${waiting ? "rv-orb-spin-fast" : "rv-orb-spin"}`} style={{ background: brand }} />
          <div className={`absolute inset-0 rounded-full ${waiting ? "rv-orb-shimmer" : ""}`}
            style={{ background: "radial-gradient(circle at 32% 28%, rgba(255,255,255,0.75), rgba(255,255,255,0) 46%)" }} />
        </div>
      </div>
    </div>
  );
}

const BAR_WEIGHTS = [0.55, 1, 0.8, 0.45];

export function RevLiveBars({ levelsRef, activity, color, idleColor }: {
  levelsRef: Levels; activity: CallActivity; color: string; idleColor: string;
}) {
  const barsRef = useRef<Array<HTMLSpanElement | null>>([]);
  const reduce = useReducedMotion();
  const activityRef = useRef(activity);
  activityRef.current = activity;

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const smooth = BAR_WEIGHTS.map(() => 0);
    const step = (time: number) => {
      raf = requestAnimationFrame(step);
      if (time - last < (reduce ? 200 : 50)) return;
      last = time;
      const { input, output } = levelsRef.current;
      const mode = activityRef.current;
      const level = mode === "rev" ? output : mode === "user" ? input : 0;
      BAR_WEIGHTS.forEach((weight, index) => {
        const jitter = reduce ? 1 : 0.75 + Math.random() * 0.5;
        const target = Math.min(1, level * weight * jitter * 1.6);
        smooth[index] += (target - smooth[index]) * (reduce ? 1 : 0.45);
        const bar = barsRef.current[index];
        if (bar) {
          bar.style.transform = `scaleY(${0.22 + smooth[index] * 0.78})`;
          bar.style.background = smooth[index] > 0.05 ? color : idleColor;
        }
      });
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [levelsRef, reduce, color, idleColor]);

  return (
    <span aria-hidden="true" data-rev-live-bars="" className="flex h-5 items-center gap-[3px]">
      {BAR_WEIGHTS.map((_, index) => (
        <span key={index} ref={node => { barsRef.current[index] = node; }}
          className="block h-full w-[3px] origin-center rounded-full"
          style={{ background: idleColor, transform: "scaleY(0.22)" }} />
      ))}
    </span>
  );
}
