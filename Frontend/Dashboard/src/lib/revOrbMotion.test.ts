import { describe, expect, it } from "vitest";
import {
  PHASE_WRAP, amoebaTarget, bounceTransform, createOrbMotion, kickOrb, nucleusOffset, speedTarget, stepOrbMotion,
  type OrbMotionInput,
} from "./revOrbMotion";

const input = (over: Partial<OrbMotionInput> = {}): OrbMotionInput =>
  ({ dt: 1 / 60, now: 0, activity: "listening", output: 0, waiting: false, muted: false, ...over });

function run(frames: number, over: (frame: number) => Partial<OrbMotionInput>, state = createOrbMotion()) {
  for (let f = 0; f < frames; f++) stepOrbMotion(state, input({ now: (f * 1000) / 60, ...over(f) }));
  return state;
}

describe("revOrbMotion", () => {
  it("only turns amoeboid while Rev speaks, more with a louder voice", () => {
    expect(amoebaTarget("listening", 1)).toBe(0);
    expect(amoebaTarget("user", 1)).toBe(0);
    expect(amoebaTarget("thinking", 1)).toBe(0);
    expect(amoebaTarget("rev", 0)).toBeCloseTo(0.45);
    expect(amoebaTarget("rev", 1)).toBe(1);
    expect(amoebaTarget("rev", 0.2)).toBeGreaterThan(amoebaTarget("rev", 0.1));
  });

  it("morphs into the amoeba quickly and relaxes back into the round orb", () => {
    const state = run(30, () => ({ activity: "rev", output: 0.7 }));
    expect(state.amoeba).toBeGreaterThan(0.8);
    run(150, () => ({ activity: "listening" }), state);
    expect(state.amoeba).toBeLessThan(0.01);
  });

  it("picks a plasma speed per moment, with Rev's voice winning over mute", () => {
    expect(speedTarget("listening", 0, false, false)).toBeCloseTo(0.9);
    expect(speedTarget("checking", 0, true, false)).toBeCloseTo(1.8);
    expect(speedTarget("listening", 0, false, true)).toBeCloseTo(0.5);
    expect(speedTarget("rev", 1, false, true)).toBeCloseTo(2.4);
  });

  it("integrates speed into phase without jumps and wraps for float precision", () => {
    const state = createOrbMotion();
    const before = state.phase;
    stepOrbMotion(state, input({ dt: 1 / 60 }));
    expect(state.phase - before).toBeGreaterThan(0);
    expect(state.phase - before).toBeLessThan(0.05);
    state.phase = PHASE_WRAP - 0.001;
    stepOrbMotion(state, input({ dt: 1 / 60 }));
    expect(state.phase).toBeLessThan(1);
  });

  it("bounces on Rev's syllables and settles when he stops", () => {
    let peak = 0;
    const state = createOrbMotion();
    run(240, (f) => {
      peak = Math.max(peak, state.bounce);
      // ~4 syllables a second.
      return { activity: "rev", output: Math.sin((f / 60) * Math.PI * 8) > 0 ? 0.8 : 0.1 };
    }, state);
    expect(peak).toBeGreaterThan(0.04);
    expect(peak).toBeLessThanOrEqual(0.1);
    run(180, () => ({ activity: "listening" }), state);
    expect(Math.abs(state.bounce)).toBeLessThan(0.002);
  });

  it("does not bounce for the merchant's voice or while idle", () => {
    const state = run(240, (f) => ({ activity: "user", output: f % 20 < 10 ? 1 : 0 }));
    expect(state.bounce).toBe(0);
    expect(state.amoeba).toBe(0);
  });

  it("stays stable when frames stall (backgrounded tab)", () => {
    const state = kickOrb(createOrbMotion(), 1.5);
    stepOrbMotion(state, input({ dt: 5 }));
    expect(Number.isFinite(state.bounce)).toBe(true);
    expect(Math.abs(state.bounce)).toBeLessThanOrEqual(0.1);
  });

  it("hops up, stretches along the motion and squashes on landing", () => {
    const rising = { ...createOrbMotion(), bounce: 0.05, bounceVelocity: 1 };
    expect(bounceTransform(rising)).toMatch(/^translate3d\(0, -5\.00%, 0\) scale\(0\.96\d*, 1\.04\d*\)$/);
    const landed = { ...createOrbMotion(), bounce: -0.04, bounceVelocity: 0 };
    const [, sx, sy] = bounceTransform(landed).match(/scale\(([\d.]+), ([\d.]+)\)/)!.map(Number);
    expect(sx).toBeGreaterThan(1);
    expect(sy).toBeLessThan(1);
  });

  it("keeps the nucleus centred on the round orb and lets it drift in the amoeba", () => {
    expect(nucleusOffset(createOrbMotion())).toEqual([0, 0]);
    const [x, y] = nucleusOffset({ ...createOrbMotion(), amoeba: 1, phase: 7 });
    expect(Math.hypot(x, y)).toBeGreaterThan(0);
    expect(Math.hypot(x, y)).toBeLessThanOrEqual(0.16);
  });
});
