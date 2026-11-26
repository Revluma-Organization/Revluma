import { useEffect, type RefObject } from "react";

/**
 * Adds `is-in` to the element the first time a quarter of it (or 160px, for
 * tall elements on short screens) is on screen. Scroll-in reveals in the
 * landing sections key off that class; with reduced motion the CSS ignores it
 * and everything is simply shown.
 */
export function useReveal(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      el.classList.add("is-in");
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        // Tall elements (stacked pricing / reviews on phones) never reach 25%
        // until well after their first card is on screen, so 160px also counts.
        if (entries.some((entry) => entry.isIntersecting && (entry.intersectionRatio >= 0.25 || entry.intersectionRect.height >= 160))) {
          el.classList.add("is-in");
          observer.disconnect();
        }
      },
      { threshold: [0, 0.05, 0.1, 0.15, 0.2, 0.25], rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
}
