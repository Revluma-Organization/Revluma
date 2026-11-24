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
        if (entries.some((entry) => entry.isIntersecting)) {
          el.classList.add("is-in");
          observer.disconnect();
        }
      },
      { threshold: 0.25, rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
}
