import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import type { CallActivity } from "@/lib/revLiveCall";
import { bounceTransform, createOrbMotion, kickOrb, nucleusOffset, stepOrbMotion } from "@/lib/revOrbMotion";
import { getRevOrbRenderer } from "@/components/rev/revOrbGL";
import callStill from "@/assets/rev-orb/rev-orb-call.webp";

// Voice visuals for live calls with Rev. Both read audio levels from a ref on
// animation frames and write styles directly (no React re-render per frame),
// and both respect prefers-reduced-motion.
//
// RevLiveOrb   full-screen call stage: the Rev Intelligence plasma orb drawn
//              live on the GPU (revOrbGL.ts). Nothing to download, and the
//              shared renderer is prewarmed before the call opens.
//              - Rev speaking: the orb turns into an amoeba (flowing
//                pseudopodia, streaming endoplasm, drifting nucleus, vacuoles)
//                and bounces on his syllables.
//              - Merchant speaking: cyan ripples expand with their voice.
//              - Connecting / checking the store / thinking: an orbit arc
//                sweeps around the orb and the plasma speeds up.
//              - Listening: slow breathing. Muted: the plasma greys and slows.
//              Reduced motion or no WebGL: the still frame, nothing moves.
// RevLiveBars  compact four-bar meter for the in-chat call bar.

type Levels = React.MutableRefObject<{ input: number; output: number }>;

const ORB_CSS = `
@keyframes rv-orb-breathe { 0%,100% { transform: scale(1); } 50% { transform: scale(1.03); } }
@keyframes rv-orb-spin { to { transform: rotate(360deg); } }
.rv-orb-breathe { animation: rv-orb-breathe 4.2s cubic-bezier(.45,0,.55,1) infinite; }
.rv-orb-orbit { animation: rv-orb-spin 2.4s linear infinite; }
@media (prefers-reduced-motion: reduce) {
  .rv-orb-breathe, .rv-orb-orbit { animation: none !important; }
}
`;

// The still is the orb on black with the sphere spanning 97% of the frame;
// clipping just inside it removes the black (same as RevOrbLoader).
const SPHERE_CLIP = "circle(47.5% at 50% 50%)";
// The GL canvas overhangs the stage so pseudopodia and the halo have room.
// With ORB_RADIUS 0.69 the resting sphere matches the still's footprint.
const CANVAS_OVERHANG = "-12%";
// Zero-byte stand-in for the few milliseconds before the first GPU frame.
const PLACEHOLDER =
  "radial-gradient(circle at 50% 50%, #f2f9ff 0%, #9fe0ff 8%, #3f86ef 22%, #163a8f 44%, #13357f 64%, #2f6fd0 82%, #8fd4ff 95%, transparent 96.5%)";

type Surface = "pending" | "gl" | "still";

export function RevLiveOrb({ levelsRef, activity, size = 220, isDark, muted = false, connecting = false }: {
  levelsRef: Levels;
  activity: CallActivity;
  /** Pixels, or any CSS length (e.g. "min(300px, 64vw, 40vh)"). */
  size?: number | string;
  isDark: boolean;
  muted?: boolean;
  /** Call not live yet (starting, connecting, reconnecting). */
  connecting?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const bounceRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const auraRef = useRef<HTMLDivElement>(null);
  const rippleRefs = useRef<Array<HTMLDivElement | null>>([]);
  const reduce = Boolean(useReducedMotion());
  const [surface, setSurface] = useState<Surface>("pending");
  const waiting = connecting || activity === "checking" || activity === "thinking";
  const live = useRef({ activity, waiting, muted, isDark });
  live.current = { activity, waiting, muted, isDark };

  useEffect(() => {
    if (reduce) return;
    const host = hostRef.current;
    const renderer = host ? getRevOrbRenderer() : null;
    if (!host || !renderer) {
      setSurface("still");
      return;
    }
    // One shared canvas: its context and compiled program survive between calls.
    host.appendChild(renderer.canvas);
    let cssSize = host.clientWidth;
    const observer = typeof ResizeObserver === "undefined" ? null
      : new ResizeObserver(([entry]) => { cssSize = entry.contentRect.width; });
    observer?.observe(host);

    const motion = kickOrb(createOrbMotion());
    let raf = 0;
    let last = 0;
    let shown = false;
    let quality = 1;
    let samples = 0;
    let total = 0;
    let voice = 0;
    let mutedMix = live.current.muted ? 1 : 0;

    const step = (time: number) => {
      raf = requestAnimationFrame(step);
      const dt = last ? (time - last) / 1000 : 1 / 60;
      last = time;
      const { input, output } = levelsRef.current;
      const { activity: mode, waiting: busy, muted: silenced, isDark: dark } = live.current;
      stepOrbMotion(motion, { dt, now: time, activity: mode, output, waiting: busy, muted: silenced });
      const ease = 1 - Math.exp(-Math.min(dt, 0.1) * 12);
      voice += ((mode === "user" && !silenced ? input : 0) - voice) * ease;
      mutedMix += ((silenced ? 1 : 0) - mutedMix) * ease * 0.5;

      if (bounceRef.current) bounceRef.current.style.transform = bounceTransform(motion);
      if (shadowRef.current) {
        const lift = Math.max(0, motion.bounce);
        shadowRef.current.style.transform = `scale(${(1 - lift * 2.5).toFixed(3)})`;
        shadowRef.current.style.opacity = (1 - lift * 5).toFixed(3);
      }
      if (auraRef.current) auraRef.current.style.transform = `scale(${(1 + motion.energy * 0.25 + voice * 0.18).toFixed(3)})`;
      rippleRefs.current.forEach((ripple, index) => {
        if (!ripple) return;
        // Capped so the outer ripple stays clear of the activity label below.
        const spread = Math.min(1, voice * 1.4) * (0.12 + index * 0.08);
        ripple.style.transform = `scale(${1.02 + spread})`;
        ripple.style.opacity = String(Math.min(1, voice * (2.4 - index * 0.9)));
      });

      if (renderer.lost()) {
        if (shown) { shown = false; setSurface("still"); }
        return;
      }
      if (!renderer.ready()) return; // still linking in parallel: placeholder stays up

      // Adaptive resolution: if frames run slow, render fewer pixels (never below half).
      if (dt < 0.25) { total += dt; samples += 1; }
      if (samples === 45) {
        if (total / samples > 0.024 && quality > 0.55) quality = Math.max(0.5, quality * 0.8);
        total = 0;
        samples = 0;
      }
      renderer.resize(cssSize || host.clientWidth, Math.min(window.devicePixelRatio || 1, 2) * quality);
      const drawn = renderer.draw({
        phase: motion.phase, amoeba: motion.amoeba, energy: motion.energy, muted: mutedMix,
        glow: dark ? 0.55 : 0.4, nucleus: nucleusOffset(motion),
      });
      if (drawn && !shown) { shown = true; setSurface("gl"); }
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
      if (renderer.canvas.parentNode === host) host.removeChild(renderer.canvas);
    };
  }, [levelsRef, reduce]);

  const shownSurface: Surface = reduce ? "still" : surface;
  const length = typeof size === "number" ? `${size}px` : size;
  const glow = isDark ? "rgba(79,168,255,0.50)" : "rgba(26,79,230,0.26)";
  const rippleColor = isDark ? "rgba(146,220,255,0.70)" : "rgba(26,79,230,0.42)";

  return (
    <div aria-hidden="true" data-rev-live-orb={activity} data-rev-live-orb-waiting={waiting ? "" : undefined}
      data-rev-orb-surface={shownSurface} className="relative" style={{ width: length, height: length }}>
      <style>{ORB_CSS}</style>
      {/* Aura: the orb's own light spilling onto the page. */}
      <div ref={auraRef} className="absolute -inset-[14%] rounded-full"
        style={{ background: `radial-gradient(circle, ${glow} 0%, transparent 62%)`, filter: "blur(22px)",
          opacity: muted ? 0.35 : 1, transition: "opacity 300ms ease" }} />
      {/* Ground shadow: shrinks and fades as the orb hops. */}
      <div ref={shadowRef} className="absolute left-[24%] right-[24%] -bottom-[3%] h-[9%]" style={{
        background: `radial-gradient(closest-side, ${isDark ? "rgba(79,168,255,0.28)" : "rgba(26,79,230,0.30)"}, transparent)`,
        filter: "blur(4px)" }} />
      {/* Merchant voice: two ripples, the outer one lagging behind. */}
      {[0, 1].map((index) => (
        <div key={index} ref={(node) => { rippleRefs.current[index] = node; }} data-rev-live-ripple=""
          className="absolute inset-[4%] rounded-full" style={{ border: `${index ? 1 : 2}px solid ${rippleColor}`, opacity: 0 }} />
      ))}
      {/* Waiting: an orbit arc sweeps around the orb. */}
      <div data-rev-live-orbit="" className={`absolute inset-[1%] rounded-full ${waiting ? "rv-orb-orbit" : ""}`}
        style={{
          background: `conic-gradient(from 0deg, transparent 0deg, transparent 250deg, ${isDark ? "rgba(146,220,255,0.95)" : "rgba(26,79,230,0.85)"} 350deg, transparent 360deg)`,
          WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px))",
          mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px))",
          opacity: waiting ? 1 : 0, transition: "opacity 300ms ease",
        }} />
      <div className={`absolute inset-0 ${activity === "listening" && !muted && !waiting ? "rv-orb-breathe" : ""}`}>
        <div ref={bounceRef} data-rev-orb-bounce="" className="absolute inset-0"
          style={{ willChange: reduce ? undefined : "transform", transformOrigin: "50% 100%" }}>
          {shownSurface === "still" ? (
            <img src={callStill} alt="" draggable={false} data-rev-orb="still" decoding="async"
              className="absolute inset-[5%] h-[90%] w-[90%] object-cover"
              style={{ clipPath: SPHERE_CLIP, WebkitClipPath: SPHERE_CLIP, pointerEvents: "none",
                filter: muted ? "grayscale(0.85) brightness(0.75)" : undefined }} />
          ) : shownSurface === "pending" ? (
            <div data-rev-orb="placeholder" className="absolute inset-[7.2%] rounded-full" style={{ background: PLACEHOLDER }} />
          ) : null}
          {!reduce && <div ref={hostRef} data-rev-orb-host="" className="absolute" style={{ inset: CANVAS_OVERHANG }} />}
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
