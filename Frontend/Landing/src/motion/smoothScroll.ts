import Lenis from "lenis";

/**
 * Smooth, weighted scrolling for the landing page (mouse wheel and trackpad).
 *
 * Only for fine pointers and when the visitor has not asked for reduced
 * motion: touch devices keep their native momentum scrolling, which is
 * already smooth and which visitors expect. The page scrolls natively under
 * the hood (Lenis eases window.scrollTo), so CSS scroll-driven animations,
 * IntersectionObservers, the browser's find-in-page and the scrollbar all keep
 * working.
 *
 * - In-page links (#pricing, #faq...) glide instead of jumping. The click's
 *   composed path is read, so links inside the sections' shadow roots work;
 *   the page's scroll-padding-top keeps targets clear of the fixed nav, and
 *   the URL hash still updates.
 * - Anything marked data-lenis-prevent (the waitlist modal) and any nested
 *   scroll area scroll natively.
 * - While the page is locked (the modal sets body overflow: hidden) the
 *   smoothing pauses.
 */

declare global {
  interface Window {
    __rlLenis?: Lenis;
  }
}

// From lenis/dist/lenis.css, inlined so the embed stays one script.
const LENIS_CSS = `html.lenis,html.lenis body{height:auto}
.lenis:not(.lenis-autoToggle).lenis-stopped{overflow:clip}
.lenis [data-lenis-prevent]{overscroll-behavior:contain}
.lenis.lenis-smooth iframe{pointer-events:none}`;

export function startSmoothScroll(): Lenis | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  if (window.__rlLenis) return window.__rlLenis;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return null;

  if (!document.querySelector("style[data-rl-lenis]")) {
    const style = document.createElement("style");
    style.dataset.rlLenis = "";
    style.textContent = LENIS_CSS;
    document.head.appendChild(style);
  }

  const lenis = new Lenis({
    // Weighted but responsive: settles in roughly half a second.
    lerp: 0.12,
    wheelMultiplier: 1,
    // Handled below: Lenis' own anchor handling lets the browser's instant
    // jump win.
    anchors: false,
    allowNestedScroll: true,
    stopInertiaOnNavigate: true,
    autoRaf: true,
  });
  window.__rlLenis = lenis;

  // Pause while something locks the page (the waitlist modal sets
  // body overflow: hidden while it is open).
  const sync = () => {
    if (document.body.style.overflow === "hidden") lenis.stop();
    else lenis.start();
  };
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ["style"] });

  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.composedPath().find((n): n is HTMLAnchorElement => n instanceof HTMLAnchorElement && !!n.getAttribute("href"));
    if (!link || link.target === "_blank") return;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin || url.pathname !== window.location.pathname || !url.hash || url.hash === "#") return;
    const target = document.getElementById(decodeURIComponent(url.hash.slice(1)));
    if (!target) return;
    event.preventDefault();
    lenis.scrollTo(target, { duration: 1.1, easing: (t) => 1 - Math.pow(1 - t, 4) });
    history.pushState(null, "", url.hash);
  });

  return lenis;
}
