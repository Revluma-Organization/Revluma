/**
 * Pointer micro-interactions for the landing sections, wired with one
 * delegated, passive pointermove listener per section root (a shadow root in
 * the embed, the document in the dev app) and at most one style write per
 * animation frame.
 *
 * - [data-spot]      a soft light follows the pointer across the card
 *                    (writes --mx / --my; the glow itself is CSS).
 * - [data-magnetic]  the element leans a few pixels towards the pointer and
 *                    springs back when it leaves (writes --mgx / --mgy, used
 *                    by the `translate` property so it composes with any
 *                    transform-based entrance).
 * - [data-tilt]      the element tilts in 3D under the pointer, with a sheen
 *                    that follows it (writes --rx / --ry / --gx / --gy).
 *
 * Only for hover-capable fine pointers and when the visitor has not asked for
 * reduced motion; otherwise nothing is attached and the CSS stays at rest.
 */

const MAGNET_PULL = 0.22;
const MAGNET_MAX = 7; // px
const TILT_MAX = 7; // deg

const wired = new WeakSet<Document | ShadowRoot>();

export function canHoverAnimate(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function enhanceInteractions(root: Document | ShadowRoot): void {
  if (wired.has(root) || !canHoverAnimate()) return;
  wired.add(root);

  let frame = 0;
  let x = 0;
  let y = 0;
  let target: Element | null = null;
  let magnet: HTMLElement | null = null;
  let tilt: HTMLElement | null = null;

  const release = (el: HTMLElement | null, props: string[]) => {
    if (el) for (const p of props) el.style.removeProperty(p);
  };

  const apply = () => {
    frame = 0;
    const t = target;
    if (!t) return;

    const spot = t.closest<HTMLElement>("[data-spot]");
    if (spot) {
      const r = spot.getBoundingClientRect();
      spot.style.setProperty("--mx", `${(x - r.left).toFixed(1)}px`);
      spot.style.setProperty("--my", `${(y - r.top).toFixed(1)}px`);
    }

    const m = t.closest<HTMLElement>("[data-magnetic]");
    if (m !== magnet) {
      release(magnet, ["--mgx", "--mgy"]);
      magnet = m;
    }
    if (m) {
      const r = m.getBoundingClientRect();
      const clamp = (v: number) => Math.max(-MAGNET_MAX, Math.min(MAGNET_MAX, v));
      m.style.setProperty("--mgx", `${clamp((x - (r.left + r.width / 2)) * MAGNET_PULL).toFixed(2)}px`);
      m.style.setProperty("--mgy", `${clamp((y - (r.top + r.height / 2)) * MAGNET_PULL).toFixed(2)}px`);
    }

    const tl = t.closest<HTMLElement>("[data-tilt]");
    if (tl !== tilt) {
      release(tilt, ["--rx", "--ry", "--gx", "--gy"]);
      tilt = tl;
    }
    if (tl) {
      const r = tl.getBoundingClientRect();
      const px = Math.max(0, Math.min(1, (x - r.left) / r.width));
      const py = Math.max(0, Math.min(1, (y - r.top) / r.height));
      tl.style.setProperty("--rx", `${((0.5 - py) * TILT_MAX * 2).toFixed(2)}deg`);
      tl.style.setProperty("--ry", `${((px - 0.5) * TILT_MAX * 2).toFixed(2)}deg`);
      tl.style.setProperty("--gx", `${(px * 100).toFixed(1)}%`);
      tl.style.setProperty("--gy", `${(py * 100).toFixed(1)}%`);
    }
  };

  root.addEventListener(
    "pointermove",
    (event) => {
      const e = event as PointerEvent;
      if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
      x = e.clientX;
      y = e.clientY;
      target = e.target instanceof Element ? e.target : null;
      if (!frame) frame = requestAnimationFrame(apply);
    },
    { passive: true },
  );

  // Leaving the section altogether: let everything spring back.
  root.addEventListener(
    "pointerout",
    (event) => {
      const next = (event as PointerEvent).relatedTarget as Node | null;
      if (next && root.contains(next)) return;
      target = null;
      release(magnet, ["--mgx", "--mgy"]);
      release(tilt, ["--rx", "--ry", "--gx", "--gy"]);
      magnet = null;
      tilt = null;
    },
    { passive: true },
  );
}
