import type { CSSProperties } from "react";

/**
 * Entrance pace for the hero. Delays are written at the original (PR #436)
 * timings; TEMPO stretches them to match the slower durations in motion.css.
 */
export const TEMPO = 1.6;

/** Entrance delay for one element (read by the m-* classes in motion.css). */
export const at = (ms: number) => ({ "--d": `${Math.round(ms * TEMPO)}ms` }) as CSSProperties;
