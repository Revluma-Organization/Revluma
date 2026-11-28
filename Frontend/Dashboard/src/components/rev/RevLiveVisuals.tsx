import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";
import type { CallActivity } from "@/lib/revLiveCall";
import callMp4 from "@/assets/rev-orb/rev-orb-call.mp4";
import callStill from "@/assets/rev-orb/rev-orb-call.webp";

// Voice visuals for live calls with Rev. Both read audio levels from a ref on
// animation frames and write styles directly (no React re-render per frame),
// and both respect prefers-reduced-motion.
//
// RevLiveOrb   full-screen call stage built on the Rev Intelligence logo: the
//              glass plasma orb video (scripts/rev-orb, `call` job), clipped to
//              a circle so it works on light and dark surfaces.
//              - Rev speaking: the sphere swells, flares and its plasma runs
//                faster with Rev's voice.
//              - Merchant speaking: cyan ripples expand with their voice.
//              - Connecting / checking the store / thinking: an orbit arc
//                sweeps around the sphere and the plasma speeds up.
//              - Listening: slow breathing. Muted: the plasma dims and slows.
//              Reduced motion: the still frame, no breathing, orbit or speed-up.
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

// The sphere spans 97% of the frame; clipping just inside it removes the
// encoded black background and its antialiased edge (same as RevOrbLoader).
const SPHERE_CLIP = "circle(47.5% at 50% 50%)";

/** Target plasma speed for the current moment (1 = the logo's own pace). */
function playbackTarget(mode: CallActivity, output: number, waiting: boolean, muted: boolean): number {
  if (muted) return 0.5;
  if (waiting) return 1.8;
  if (mode === "rev") return 1 + Math.min(1, output * 1.6) * 1.4;
  return 0.9;
}

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
  const sphereRef = useRef<HTMLDivElement>(null);
  const flareRef = useRef<HTMLDivElement>(null);
  const auraRef = useRef<HTMLDivElement>(null);
  const rippleRefs = useRef<Array<HTMLDivElement | null>>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const reduce = useReducedMotion();
  const waiting = connecting || activity === "checking" || activity === "thinking";
  const live = useRef({ activity, waiting, muted });
  live.current = { activity, waiting, muted };

  // React sets `muted` as a property only; mobile Safari decides autoplay from
  // the attribute, so make it explicit. If autoplay is refused, the poster stays.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = true;
    video.defaultMuted = true;
    video.setAttribute("muted", "");
    try {
      const playing = video.play();
      if (playing && typeof playing.catch === "function") playing.catch(() => undefined);
    } catch {
      /* media playback unavailable: the poster remains */
    }
  }, [reduce]);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    let lastRateAt = 0;
    let core = 0;
    let voice = 0;
    let rate = 1;
    const step = (time: number) => {
      raf = requestAnimationFrame(step);
      if (reduce && time - last < 200) return;
      last = time;
      const { input, output } = levelsRef.current;
      const { activity: mode, waiting: busy, muted: silenced } = live.current;
      const ease = reduce ? 1 : 0.22;
      core += ((mode === "rev" ? output : 0) - core) * ease;
      voice += ((mode === "user" && !silenced ? input : 0) - voice) * ease;
      if (!reduce) {
        if (sphereRef.current) sphereRef.current.style.transform = `scale(${1 + core * 0.12})`;
        if (flareRef.current) flareRef.current.style.opacity = String(Math.min(0.85, core * 1.5));
        if (auraRef.current) auraRef.current.style.transform = `scale(${1 + core * 0.28 + voice * 0.18})`;
        rippleRefs.current.forEach((ripple, index) => {
          if (!ripple) return;
          // Capped so the outer ripple stays within ~6% beyond the stage and
          // never reaches the activity label below it.
          const spread = Math.min(1, voice * 1.4) * (0.12 + index * 0.08);
          ripple.style.transform = `scale(${1.02 + spread})`;
          ripple.style.opacity = String(Math.min(1, voice * (2.4 - index * 0.9)));
        });
        // Plasma speed follows the moment. playbackRate is applied in coarse
        // steps a few times a second: per-frame changes stutter in some browsers.
        rate += (playbackTarget(mode, output, busy, silenced) - rate) * 0.08;
        const video = videoRef.current;
        if (video && time - lastRateAt > 120) {
          const stepped = Math.round(rate * 10) / 10;
          if (Math.abs(video.playbackRate - stepped) >= 0.1) video.playbackRate = stepped;
          lastRateAt = time;
        }
      } else if (auraRef.current) {
        auraRef.current.style.opacity = String(0.7 + Math.min(0.3, (core + voice) * 0.6));
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [levelsRef, reduce]);

  const length = typeof size === "number" ? `${size}px` : size;
  const glow = isDark ? "rgba(79,168,255,0.55)" : "rgba(26,79,230,0.30)";
  const rippleColor = isDark ? "rgba(146,220,255,0.70)" : "rgba(26,79,230,0.42)";
  const media: React.CSSProperties = {
    position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover",
    clipPath: SPHERE_CLIP, WebkitClipPath: SPHERE_CLIP, pointerEvents: "none",
    filter: muted ? "grayscale(0.85) brightness(0.75)" : undefined, transition: "filter 260ms ease",
  };

  return (
    <div aria-hidden="true" data-rev-live-orb={activity} data-rev-live-orb-waiting={waiting ? "" : undefined}
      className="relative" style={{ width: length, height: length }}>
      <style>{ORB_CSS}</style>
      {/* Aura: the orb's own cyan-blue light spilling onto the page. */}
      <div ref={auraRef} className="absolute -inset-[14%] rounded-full"
        style={{ background: `radial-gradient(circle, ${glow} 0%, transparent 62%)`, filter: "blur(22px)",
          opacity: muted ? 0.35 : 1, transition: "opacity 300ms ease" }} />
      {/* Merchant voice: two ripples, the outer one lagging behind. */}
      {[0, 1].map((index) => (
        <div key={index} ref={(node) => { rippleRefs.current[index] = node; }} data-rev-live-ripple=""
          className="absolute inset-[4%] rounded-full" style={{ border: `${index ? 1 : 2}px solid ${rippleColor}`, opacity: 0 }} />
      ))}
      {/* Waiting: an orbit arc sweeps around the sphere. */}
      <div data-rev-live-orbit="" className={`absolute inset-[1%] rounded-full ${waiting ? "rv-orb-orbit" : ""}`}
        style={{
          background: `conic-gradient(from 0deg, transparent 0deg, transparent 250deg, ${isDark ? "rgba(146,220,255,0.95)" : "rgba(26,79,230,0.85)"} 350deg, transparent 360deg)`,
          WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px))",
          mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px))",
          opacity: waiting ? 1 : 0, transition: "opacity 300ms ease",
        }} />
      <div className={`absolute inset-[5%] ${activity === "listening" && !muted && !waiting ? "rv-orb-breathe" : ""}`}>
        <div ref={sphereRef} className="absolute inset-0" style={{ willChange: reduce ? undefined : "transform" }}>
          {/* Grounding shadow for light surfaces (clip-path would cut a box-shadow). */}
          <div className="absolute inset-[3%] rounded-full" style={{
            boxShadow: isDark ? "0 0 60px -6px rgba(79,168,255,0.45)" : "0 28px 60px -22px rgba(26,79,230,0.55), 0 0 0 1px rgba(26,79,230,0.06)" }} />
          {reduce ? (
            <img src={callStill} alt="" draggable={false} data-rev-orb="still" style={media} />
          ) : (
            <video ref={videoRef} autoPlay muted loop playsInline preload="auto" poster={callStill}
              tabIndex={-1} disablePictureInPicture data-rev-orb="call-video" style={media}>
              <source src={callMp4} type="video/mp4" />
            </video>
          )}
          {/* Rev's voice flares the core. */}
          <div ref={flareRef} className="absolute inset-[2.5%] rounded-full" style={{
            background: "radial-gradient(circle at 50% 50%, rgba(214,240,255,0.75) 0%, rgba(111,208,255,0.35) 28%, transparent 62%)",
            opacity: 0, pointerEvents: "none" }} />
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
