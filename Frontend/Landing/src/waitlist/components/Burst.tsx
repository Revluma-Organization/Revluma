import { useEffect, useRef } from "react";
import { reducedMotion } from "../motion";

const COLORS = ["#2b13cf", "#7460ff", "#b4abff", "#f5b300", "#0c0a1d", "#47cd89"];

type Piece = { x: number; y: number; vx: number; vy: number; spin: number; angle: number; w: number; h: number; color: string; life: number };

/**
 * A one-off burst of brand-coloured confetti behind the success tick. Canvas
 * only, about 1.8 seconds, then it removes itself from the frame loop. Skipped
 * entirely for reduced motion; it is decoration, never information.
 */
export function Burst() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    // jsdom (unit tests) has no canvas; skip quietly rather than log "not implemented".
    if (!el || reducedMotion() || /jsdom/i.test(navigator.userAgent)) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;

    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const { width, height } = el.getBoundingClientRect();
    el.width = width * ratio;
    el.height = height * ratio;
    ctx.scale(ratio, ratio);

    const originX = width / 2;
    const originY = Math.min(110, height * 0.3);
    const pieces: Piece[] = Array.from({ length: 90 }, (_, i) => {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.25;
      const speed = 5 + Math.random() * 7;
      return {
        x: originX,
        y: originY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        spin: (Math.random() - 0.5) * 0.4,
        angle: Math.random() * Math.PI,
        w: 5 + Math.random() * 5,
        h: 8 + Math.random() * 6,
        color: COLORS[i % COLORS.length],
        life: 0,
      };
    });

    let frame = 0;
    const start = performance.now();
    const draw = (now: number) => {
      const t = now - start;
      ctx.clearRect(0, 0, width, height);
      for (const p of pieces) {
        p.vy += 0.22;
        p.vx *= 0.985;
        p.vy *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.angle += p.spin;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - t / 1800);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillStyle = p.color;
        // Squash on one axis to fake the paper turning over.
        ctx.fillRect(-p.w / 2, (-p.h / 2) * Math.cos(p.angle * 2), p.w, p.h * Math.cos(p.angle * 2));
        ctx.restore();
      }
      frame = t < 1800 ? requestAnimationFrame(draw) : 0;
      if (!frame) ctx.clearRect(0, 0, width, height);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return <canvas ref={canvas} className="wl-burst" aria-hidden="true" />;
}
