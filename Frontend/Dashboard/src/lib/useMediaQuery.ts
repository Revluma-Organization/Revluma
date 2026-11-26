import { useEffect, useState } from "react";

/**
 * Phase 5E — reactive media-query match for the Rev workspace layout.
 * The investigation workspace shows a persistent history rail at
 * min-width 1024px and the modal history drawer below it. SSR-safe: false
 * until the effect runs (and in environments without matchMedia).
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

export default useMediaQuery;
