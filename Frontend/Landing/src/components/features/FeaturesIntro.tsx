import { useEffect, useRef, type PointerEvent, type RefObject } from "react";
import { ArrowDown } from "lucide-react";
import { FEATURES } from "@/content";
import { useReveal } from "@/useReveal";
import video from "@/assets/features-signals.mp4";
import videoSmall from "@/assets/features-signals-sm.mp4";
import poster from "@/assets/features-signals-poster.jpg";
import { vars } from "./primitives";

/**
 * Intro of "What Revluma does": a dark, cinematic panel. Behind the copy runs
 * a looping video of store signals being connected (links form, pulses travel
 * to a core, anomalies ping amber / red); see scripts/render-signals-video.py.
 *
 * The video only loads and plays while the panel is near the viewport, and
 * never with reduced motion or Save-Data (the poster frame is shown instead).
 * Everything else here is CSS: the panel opens, the headline rises word by
 * word, the accent shimmers, signal chips float, a light runs round the
 * border and a soft spotlight follows the pointer.
 */

function prefersStill() {
  const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
  return reduce || saveData;
}

function useAmbientVideo(ref: RefObject<HTMLVideoElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined" || prefersStill()) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (el.preload !== "auto") el.preload = "auto";
          el.play().catch(() => {
            /* autoplay blocked: the poster stays */
          });
        } else {
          el.pause();
        }
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
}

function Words({ text, start }: { text: string; start: number }) {
  const words = text.split(" ");
  return (
    <>
      {words.map((word, i) => (
        <span key={i}>
          <span className="fx-hero__word" style={vars({ "--w": start + i })}>
            {word}
          </span>
          {i < words.length - 1 ? " " : null}
        </span>
      ))}
    </>
  );
}

export function FeaturesIntro() {
  const panel = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  useReveal(panel);
  useAmbientVideo(videoRef);

  const leadWords = FEATURES.headline.lead.split(" ").length;

  // Spotlight: pointer position as CSS variables, no React re-render.
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || !panel.current) return;
    const box = panel.current.getBoundingClientRect();
    panel.current.style.setProperty("--mx", `${event.clientX - box.left}px`);
    panel.current.style.setProperty("--my", `${event.clientY - box.top}px`);
  };

  const jumpTo = (id: string) => {
    const host = panel.current?.getRootNode() as Document | ShadowRoot | undefined;
    const target = host?.getElementById?.(`feature-${id}`)?.closest(".fx-show");
    const smooth = typeof window.matchMedia === "function" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
  };

  return (
    <div ref={panel} className="fx-hero" onPointerMove={onPointerMove}>
      <div className="fx-hero__media" aria-hidden="true">
        <video ref={videoRef} muted loop playsInline preload="none" poster={poster} disablePictureInPicture tabIndex={-1}>
          <source src={videoSmall} type="video/mp4" media="(max-width: 767px)" />
          <source src={video} type="video/mp4" />
        </video>
      </div>
      <div className="fx-hero__shade" aria-hidden="true" />
      <div className="fx-hero__grid" aria-hidden="true" />
      <div className="fx-hero__spot" aria-hidden="true" />
      <div className="fx-hero__ring" aria-hidden="true">
        <i />
      </div>

      <ul className="fx-hero__signals" aria-hidden="true">
        {FEATURES.signals.map((signal, i) => (
          <li key={signal.label} className={`fx-hero__signal fx-hero__signal--${i + 1} fx-tone--${signal.tone}`} style={vars({ "--s": i })}>
            <span className="fx-hero__signal-inner">
              <i />
              {signal.label}
            </span>
          </li>
        ))}
      </ul>

      <div className="fx-hero__content">
        <p className="fx-hero__eyebrow">
          <i aria-hidden="true" />
          {FEATURES.eyebrow}
        </p>
        <h2 id="features-title" className="fx-hero__title">
          <span className="block">
            <Words text={FEATURES.headline.lead} start={0} />
          </span>
          <span className="fx-hero__accent block">
            <Words text={FEATURES.headline.accent} start={leadWords} />
          </span>
        </h2>
        <p className="fx-hero__body">{FEATURES.description}</p>

        <nav className="fx-hero__steps" aria-label="What Revluma does">
          {FEATURES.items.map((item, i) => (
            <button key={item.id} type="button" className="fx-hero__step" style={vars({ "--s": i })} onClick={() => jumpTo(item.id)}>
              <span className="fx-hero__step-num">{String(i + 1).padStart(2, "0")}</span>
              {item.step}
              <ArrowDown size={13} aria-hidden="true" className="fx-hero__step-arrow" />
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
