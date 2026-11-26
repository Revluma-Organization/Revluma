import { useEffect, useRef, useState } from "react";
import { FOOTER } from "@/content";
import orb from "@/assets/rev-orb.png";
import avif760 from "@/assets/footer/footer-scene-760.avif";
import avif1120 from "@/assets/footer/footer-scene-1120.avif";
import avif1584 from "@/assets/footer/footer-scene-1584.avif";
import webp760 from "@/assets/footer/footer-scene-760.webp";
import webp1120 from "@/assets/footer/footer-scene-1120.webp";
import webp1584 from "@/assets/footer/footer-scene-1584.webp";

/**
 * The footer's scene: a small e-commerce world (storefront, warehouse,
 * delivery, shop) with the bold "Revluma" wordmark, and Rev's eye in the sky.
 * The eye looks at one part of the store at a time, draws a line of sight and
 * names the Shopify data it stands for; it blinks, and it follows the cursor
 * while the visitor moves over the footer. It only animates while on screen,
 * and stays still with reduced motion. Purely decorative (aria-hidden).
 */

const { eye: EYE, targets: TARGETS } = FOOTER.watch;
const SCAN_MS = 2300;

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

type Point = { x: number; y: number };

export function FooterScene() {
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [active, setActive] = useState(-1);
  const [pointer, setPointer] = useState<Point | null>(null);
  const [blink, setBlink] = useState(false);

  // Track the stage size so lines of sight and the gaze are in pixels.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Scan, blink and follow the cursor, only while the scene is on screen.
  useEffect(() => {
    const el = stage.current;
    if (!el || reducedMotion() || typeof IntersectionObserver === "undefined") return;
    let i = 0;
    let visible = false;
    let scanTimer: ReturnType<typeof setTimeout> | undefined;
    let blinkTimer: ReturnType<typeof setTimeout> | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    const scan = () => {
      setActive(i);
      i = (i + 1) % TARGETS.length;
      scanTimer = setTimeout(scan, SCAN_MS);
    };
    const doBlink = () => {
      setBlink(true);
      setTimeout(() => setBlink(false), 220);
      blinkTimer = setTimeout(doBlink, 3000 + Math.random() * 3500);
    };
    const stop = () => [scanTimer, blinkTimer, idleTimer].forEach((t) => clearTimeout(t));
    const start = () => {
      stop();
      scan();
      blinkTimer = setTimeout(doBlink, 2500);
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible) start();
        else stop();
      },
      { threshold: 0.15 },
    );
    io.observe(el);

    const area = el.closest("footer") ?? el;
    const onMove = (event: Event) => {
      if (!visible) return;
      const e = event as PointerEvent;
      const r = el.getBoundingClientRect();
      clearTimeout(scanTimer);
      clearTimeout(idleTimer);
      setActive(-1);
      setPointer({ x: e.clientX - r.left, y: e.clientY - r.top });
      idleTimer = setTimeout(() => {
        setPointer(null);
        scan();
      }, 1800);
    };
    area.addEventListener("pointermove", onMove);

    return () => {
      stop();
      io.disconnect();
      area.removeEventListener("pointermove", onMove);
    };
  }, []);

  // Where the eye looks: the cursor, the current target, or down at the store.
  const eyeX = EYE.x * size.w;
  const eyeY = EYE.y * size.h;
  const eyeW = Math.min(150, Math.max(size.w < 640 ? 62 : 84, size.w * 0.104));
  const focus: Point = pointer ?? (active >= 0 ? { x: TARGETS[active].x * size.w, y: TARGETS[active].y * size.h } : { x: eyeX, y: size.h });
  const dx = focus.x - eyeX;
  const dy = focus.y - eyeY;
  const dist = Math.hypot(dx, dy) || 1;
  const reach = Math.min(1, dist / (eyeW * 1.8));
  const iris = { x: (dx / dist) * 30 * reach, y: (dy / dist) * 14 * reach };

  return (
    <div ref={stage} className="ft-scene" aria-hidden="true">
      <picture>
        <source type="image/avif" srcSet={`${avif760} 760w, ${avif1120} 1120w, ${avif1584} 1584w`} sizes="100vw" />
        <source type="image/webp" srcSet={`${webp760} 760w, ${webp1120} 1120w, ${webp1584} 1584w`} sizes="100vw" />
        <img src={webp1584} alt="" width={1584} height={672} loading="lazy" decoding="async" className="ft-scene__img" />
      </picture>

      {size.w > 0 ? (
        <svg className="ft-sight" viewBox={`0 0 ${size.w} ${size.h}`}>
          {TARGETS.map((t, n) => (
            <line key={t.label} className={n === active ? "is-on" : undefined} x1={eyeX} y1={eyeY + eyeW * 0.2} x2={t.x * size.w} y2={t.y * size.h} />
          ))}
        </svg>
      ) : null}

      {TARGETS.map((t, n) => (
        <span key={t.label} className={`ft-mark${n === active ? " is-on" : ""}`} style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%` }}>
          <span className="ft-ring" />
          <span className="ft-chip">
            <i />
            {t.label}
          </span>
        </span>
      ))}

      <div className={`ft-eye${blink ? " is-blink" : ""}`} style={{ left: `${EYE.x * 100}%`, top: `${EYE.y * 100}%`, width: eyeW }}>
        <svg viewBox="0 0 150 84">
          <defs>
            <linearGradient id="ft-sclera" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="1" stopColor="#ece8ff" />
            </linearGradient>
            <clipPath id="ft-almond">
              <path d="M4 42 C 34 4, 116 4, 146 42 C 116 80, 34 80, 4 42 Z" />
            </clipPath>
          </defs>
          <g className="ft-eye__lid">
            <path d="M4 42 C 34 4, 116 4, 146 42 C 116 80, 34 80, 4 42 Z" fill="url(#ft-sclera)" />
            <g clipPath="url(#ft-almond)">
              <g className="ft-eye__iris" style={{ transform: `translate(${iris.x}px, ${iris.y}px)` }}>
                <image href={orb} x="44" y="11" width="62" height="62" />
                <circle cx="75" cy="42" r="10" fill="#0c0a1d" />
                <circle cx="80" cy="37" r="3.2" fill="#fff" opacity="0.9" />
              </g>
            </g>
            <path d="M4 42 C 34 4, 116 4, 146 42 C 116 80, 34 80, 4 42 Z" fill="none" stroke="#2b13cf" strokeWidth="3" />
          </g>
        </svg>
      </div>
    </div>
  );
}
