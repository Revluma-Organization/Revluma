import { useEffect, type RefObject } from "react";

const prefersMotion = () =>
  typeof window.matchMedia !== "function" || !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Pointer parallax for the hero: writes --px / --py (-1..1, pointer position
 * relative to the section's centre) on the section. Scene layers translate by
 * those values times their depth (see .hv-layer in motion.css). Only for fine
 * pointers and when the visitor has not asked for reduced motion.
 */
export function usePointerParallax(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window.matchMedia !== "function") return;
    if (!prefersMotion() || !window.matchMedia("(pointer: fine)").matches) return;

    let frame = 0;
    let x = 0;
    let y = 0;
    const apply = () => {
      frame = 0;
      el.style.setProperty("--px", x.toFixed(3));
      el.style.setProperty("--py", y.toFixed(3));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const onMove = (event: PointerEvent) => {
      const box = el.getBoundingClientRect();
      x = Math.max(-1, Math.min(1, ((event.clientX - box.left) / box.width) * 2 - 1));
      y = Math.max(-1, Math.min(1, ((event.clientY - box.top) / box.height) * 2 - 1));
      schedule();
    };
    const onLeave = () => {
      x = 0;
      y = 0;
      schedule();
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref]);
}

/**
 * Adds `is-live` to the element once 40% of it is on screen, which
 * starts the hero scene's entrance (it is paused until then, so on phones it
 * plays when the visitor scrolls down to it rather than off screen).
 */
export function useStartWhenVisible(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      el.classList.add("is-live");
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          el.classList.add("is-live");
          observer.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
}

/**
 * Scroll-linked depth: writes --sp (0..1) on the element, its own progress
 * from "in place" (0) to "scrolled off the top" (1). motion.css turns
 * that into layered translate/scale/opacity so the hero's parts leave at
 * different speeds. Works per element, so on phones the scene (which sits
 * below the copy) only starts moving once the visitor has scrolled to it.
 */
export function useScrollProgress(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !prefersMotion()) return;

    let frame = 0;
    let last = -1;
    const apply = () => {
      frame = 0;
      const box = el.getBoundingClientRect();
      const view = window.innerHeight || 1;
      // Starts once the element's centre rises above 45% of the screen height,
      // so nothing moves on load; ends when it has scrolled off the top.
      const start = view * 0.45;
      const travelled = start - (box.top + box.height / 2);
      const progress = Math.max(0, Math.min(1, travelled / (start + box.height / 2)));
      const rounded = Math.round(progress * 1000) / 1000;
      if (rounded !== last) {
        last = rounded;
        el.style.setProperty("--sp", String(rounded));
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };

    apply();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref]);
}
