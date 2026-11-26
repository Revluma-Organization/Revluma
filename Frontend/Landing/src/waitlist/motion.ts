/** True when the visitor asked for less motion; every animation here checks it or is CSS-gated. */
export function reducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function scrollBehavior(): ScrollBehavior {
  return reducedMotion() ? "auto" : "smooth";
}
