// Motion model for the full-screen Rev voice orb (RevLiveOrb). Pure and
// frame-rate independent so it can be unit tested and stepped from any rAF.
//
// - amoeba: 0 = the round Rev Intelligence orb, 1 = fully amoeboid. Rises
//   while Rev speaks (louder = more pseudopodia), relaxes back when he stops.
// - energy: smoothed output level; drives membrane ripple and core pulse.
// - speed / phase: plasma time. Speed changes are integrated into phase so the
//   animation never jumps when the moment changes.
// - bounce: an underdamped spring kicked by Rev's syllable onsets (squash and
//   stretch is derived from its velocity).

import type { CallActivity } from "@/lib/revLiveCall";

export interface OrbMotion {
  phase: number;
  amoeba: number;
  energy: number;
  speed: number;
  bounce: number;
  bounceVelocity: number;
  slowOutput: number;
  lastKickAt: number;
}

export interface OrbMotionInput {
  /** Seconds since the previous step (clamped internally). */
  dt: number;
  /** Timestamp in ms (performance.now / rAF time). */
  now: number;
  activity: CallActivity;
  /** Rev's output level, 0..1. */
  output: number;
  /** Connecting, checking the store or thinking. */
  waiting: boolean;
  muted: boolean;
}

/** Phase wraps here to keep shader float precision high on long calls. */
export const PHASE_WRAP = 3600;
// ~2 Hz, damping ratio ~0.35: a visible hop with one or two smaller rebounds.
const SPRING_K = 170;
const SPRING_C = 9;
const BOUNCE_LIMIT = 0.1;

export function createOrbMotion(): OrbMotion {
  return { phase: 0, amoeba: 0, energy: 0, speed: 1, bounce: 0, bounceVelocity: 0, slowOutput: 0, lastKickAt: -Infinity };
}

/** How amoeboid the orb should be right now. */
export function amoebaTarget(activity: CallActivity, output: number): number {
  return activity === "rev" ? 0.45 + 0.55 * Math.min(1, Math.max(0, output) * 1.8) : 0;
}

/** Plasma speed for the moment (1 = the logo's own pace). Rev's voice wins over mute. */
export function speedTarget(activity: CallActivity, output: number, waiting: boolean, muted: boolean): number {
  if (activity === "rev") return 1 + Math.min(1, Math.max(0, output) * 1.6) * 1.4;
  if (muted) return 0.5;
  if (waiting) return 1.8;
  return 0.9;
}

const approach = (value: number, target: number, rate: number, dt: number) =>
  value + (target - value) * (1 - Math.exp(-rate * dt));

export function stepOrbMotion(state: OrbMotion, input: OrbMotionInput): OrbMotion {
  const dt = Math.min(0.1, Math.max(0, input.dt));
  const output = input.activity === "rev" ? Math.max(0, Math.min(1, input.output)) : 0;

  const amoeba = amoebaTarget(input.activity, output);
  state.amoeba = approach(state.amoeba, amoeba, amoeba > state.amoeba ? 6 : 2.5, dt);
  state.energy = approach(state.energy, output, 14, dt);
  state.speed = approach(state.speed, speedTarget(input.activity, output, input.waiting, input.muted), 3, dt);
  state.phase = (state.phase + dt * state.speed) % PHASE_WRAP;

  // Syllable onset: output jumps above its slow average.
  const rise = output - state.slowOutput;
  if (rise > 0.1 && input.now - state.lastKickAt > 190) {
    state.bounceVelocity += Math.min(1.5, 0.55 + rise * 4.5);
    state.lastKickAt = input.now;
  }
  state.slowOutput = approach(state.slowOutput, output, 5, dt);

  // Semi-implicit Euler in small substeps: stable at any frame rate.
  let remaining = dt;
  while (remaining > 0) {
    const h = Math.min(remaining, 1 / 120);
    state.bounceVelocity += (-SPRING_K * state.bounce - SPRING_C * state.bounceVelocity) * h;
    state.bounce += state.bounceVelocity * h;
    remaining -= h;
  }
  state.bounce = Math.max(-BOUNCE_LIMIT, Math.min(BOUNCE_LIMIT, state.bounce));
  return state;
}

/** Entrance hop when the call screen opens. */
export function kickOrb(state: OrbMotion, velocity = 0.9): OrbMotion {
  state.bounceVelocity += velocity;
  return state;
}

/** CSS transform for the bounce: hop up, stretch along the motion, squash on landing. */
export function bounceTransform(state: OrbMotion): string {
  const stretch = Math.max(-0.06, Math.min(0.06, state.bounceVelocity * 0.045));
  const landing = Math.max(0, -state.bounce) * 0.5;
  const sy = 1 + stretch - landing;
  const sx = 1 - stretch * 0.8 + landing * 0.8;
  return `translate3d(0, ${(-state.bounce * 100).toFixed(2)}%, 0) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
}

/** Where the nucleus has drifted to inside the cell (unit-sphere coordinates). */
export function nucleusOffset(state: OrbMotion): [number, number] {
  const p = state.phase;
  const reach = 0.16 * state.amoeba;
  return [
    reach * (0.7 * Math.sin(p * 0.37 + 1.3) + 0.3 * Math.sin(p * 0.23)),
    reach * (0.7 * Math.cos(p * 0.31) + 0.3 * Math.sin(p * 0.17 + 2)),
  ];
}
