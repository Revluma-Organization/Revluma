// Rev "preparing a response" indicator: a dot-matrix ripple.
//
// A 7 x 7 grid, clipped to a circle, where a soft pulse travels outward from
// the centre dot and fades at the rim (reference: the dot-matrix ripple the
// user picked). Pure SVG + CSS, so it is crisp at any size, costs no media
// download, and takes its colour from the theme role `brand` (indigo on the
// light workspace, a lighter indigo on pure black in dark mode).
//
// UX notes (ui-ux-pro-max: Feedback / Loading Indicators, Animation):
//   - One small animated element per view; fixed box, so no layout shift.
//   - role="status" with a polite live region; the animation is aria-hidden.
//   - Long waits are explained: a quiet caption appears after `hintAfterMs`.
//   - prefers-reduced-motion: the ripple stops and a static matrix remains.
import { useEffect, useState } from "react";

const GRID = 7;
const CENTER = (GRID - 1) / 2;
// Dots outside this radius are dropped, giving the round silhouette.
const RIM = 3.2;

type Dot = { cx: number; cy: number; r: number; delay: number };

/** Grid geometry in a 0..GRID viewBox. Exported for tests. */
export const REV_DOTS: Dot[] = (() => {
  const dots: Dot[] = [];
  for (let row = 0; row < GRID; row += 1) {
    for (let col = 0; col < GRID; col += 1) {
      const distance = Math.hypot(col - CENTER, row - CENTER);
      if (distance > RIM) continue;
      const falloff = 1 - distance / (RIM + 0.8);
      dots.push({
        cx: col + 0.5,
        cy: row + 0.5,
        // Centre dots are larger than rim dots, as in the reference.
        r: Number((0.2 + 0.25 * falloff).toFixed(3)),
        // The ripple reaches the rim 0.72s after it leaves the centre.
        delay: Number(((distance / RIM) * 0.72).toFixed(3)),
      });
    }
  }
  return dots;
})();

export function RevDotLoader({
  size = 36,
  accessibleLabel = "Rev is preparing a response",
  hint = "Still working on it",
  hintAfterMs = 8000,
  showHint = true,
}: {
  size?: number;
  /** Screen-reader status text. */
  accessibleLabel?: string;
  /** Quiet caption shown when the wait runs long. */
  hint?: string;
  hintAfterMs?: number;
  /** Turn the caption off, e.g. once live investigation steps are visible. */
  showHint?: boolean;
}) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!showHint) return undefined;
    const timer = window.setTimeout(() => setSlow(true), hintAfterMs);
    return () => window.clearTimeout(timer);
  }, [showHint, hintAfterMs]);

  return (
    <div role="status" aria-live="polite" aria-label={accessibleLabel} data-rev-dot-loader=""
      className="flex items-center gap-3 py-0.5">
      <svg aria-hidden="true" focusable="false" width={size} height={size}
        viewBox={`0 0 ${GRID} ${GRID}`} className="rv-dots shrink-0 text-brand">
        {REV_DOTS.map(dot => (
          <circle key={`${dot.cx}-${dot.cy}`} cx={dot.cx} cy={dot.cy} r={dot.r} fill="currentColor"
            style={{ animationDelay: `${dot.delay}s` }} />
        ))}
      </svg>
      {showHint && slow && (
        <span className="rv-dots-hint text-[0.8rem] text-ink-muted">{hint}</span>
      )}
    </div>
  );
}

export default RevDotLoader;
