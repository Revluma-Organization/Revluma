import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import type { OrbFrame, RevOrbRenderer } from "./revOrbGL";

const reduced = vi.hoisted(() => ({ value: false }));
vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>();
  return { ...actual, useReducedMotion: () => reduced.value };
});

const gl = vi.hoisted(() => ({
  renderer: null as RevOrbRenderer | null,
}));
vi.mock("./revOrbGL", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./revOrbGL")>();
  return { ...actual, getRevOrbRenderer: () => gl.renderer };
});

import { RevLiveOrb } from "./RevLiveVisuals";

function fakeRenderer({ ready = true } = {}) {
  const canvas = document.createElement("canvas");
  const frames: OrbFrame[] = [];
  const state = { ready, lost: false };
  const renderer: RevOrbRenderer = {
    canvas,
    ready: () => state.ready && !state.lost,
    lost: () => state.lost,
    resize: vi.fn(),
    draw: (frame) => { if (!state.ready || state.lost) return false; frames.push({ ...frame }); return true; },
  };
  return { renderer, frames, state };
}

let queue: FrameRequestCallback[] = [];
let clock = 0;
function advance(count: number, ms = 16) {
  act(() => {
    for (let i = 0; i < count; i++) {
      clock += ms;
      const due = queue;
      queue = [];
      due.forEach((cb) => cb(clock));
    }
  });
}

const levels = (input = 0, output = 0) => ({ current: { input, output } });
const surface = (container: HTMLElement) => container.querySelector("[data-rev-live-orb]")!.getAttribute("data-rev-orb-surface");

describe("RevLiveOrb", () => {
  beforeEach(() => {
    reduced.value = false;
    gl.renderer = null;
    queue = [];
    clock = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { queue.push(cb); return queue.length; });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("draws the orb live on the GPU in the shared canvas, with no video to download", () => {
    const { renderer, frames } = fakeRenderer();
    gl.renderer = renderer;
    const { container } = render(<RevLiveOrb levelsRef={levels()} activity="listening" isDark />);
    const root = container.querySelector("[data-rev-live-orb]")!;
    expect(root.getAttribute("data-rev-live-orb")).toBe("listening");
    expect(root.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector("video")).toBeNull();
    // Placeholder until the first GPU frame lands.
    expect(container.querySelector('[data-rev-orb="placeholder"]')).toBeTruthy();
    expect(container.querySelector("[data-rev-orb-host]")!.contains(renderer.canvas)).toBe(true);

    advance(2);
    expect(frames.length).toBeGreaterThan(0);
    expect(surface(container)).toBe("gl");
    expect(container.querySelector('[data-rev-orb="placeholder"]')).toBeNull();
    expect(renderer.resize).toHaveBeenCalled();
  });

  it("keeps the placeholder while the shader is still linking", () => {
    const { renderer, frames, state } = fakeRenderer({ ready: false });
    gl.renderer = renderer;
    const { container } = render(<RevLiveOrb levelsRef={levels()} activity="listening" isDark />);
    advance(5);
    expect(frames).toHaveLength(0);
    expect(surface(container)).toBe("pending");
    state.ready = true;
    advance(1);
    expect(surface(container)).toBe("gl");
  });

  it("turns into an amoeba while Rev speaks and back into the round orb after", () => {
    const { renderer, frames } = fakeRenderer();
    gl.renderer = renderer;
    const ref = levels(0, 0.8);
    const { rerender } = render(<RevLiveOrb levelsRef={ref} activity="rev" isDark />);
    advance(40);
    const speaking = frames[frames.length - 1];
    expect(speaking.amoeba).toBeGreaterThan(0.8);
    expect(speaking.energy).toBeGreaterThan(0.5);

    ref.current = { input: 0, output: 0 };
    rerender(<RevLiveOrb levelsRef={ref} activity="listening" isDark />);
    advance(200);
    expect(frames[frames.length - 1].amoeba).toBeLessThan(0.01);
  });

  it("bounces the orb on Rev's syllables", () => {
    const { renderer } = fakeRenderer();
    gl.renderer = renderer;
    const ref = levels(0, 0);
    const { container } = render(<RevLiveOrb levelsRef={ref} activity="rev" isDark />);
    const bounce = container.querySelector<HTMLElement>("[data-rev-orb-bounce]")!;
    let highest = 0;
    for (let i = 0; i < 60; i++) {
      ref.current = { input: 0, output: i % 8 < 4 ? 0.9 : 0.1 };
      advance(1);
      const y = Number(bounce.style.transform.match(/translate3d\(0, (-?[\d.]+)%/)?.[1] ?? 0);
      highest = Math.min(highest, y);
    }
    expect(highest).toBeLessThan(-3);
  });

  it("ripples with the merchant's voice, not Rev's", () => {
    const { renderer } = fakeRenderer();
    gl.renderer = renderer;
    const ref = levels(0, 0.8);
    const { container, rerender } = render(<RevLiveOrb levelsRef={ref} activity="rev" isDark />);
    advance(20);
    const ripples = () => [...container.querySelectorAll<HTMLElement>("[data-rev-live-ripple]")];
    expect(ripples().every((r) => Number(r.style.opacity) === 0)).toBe(true);
    ref.current = { input: 0.8, output: 0 };
    rerender(<RevLiveOrb levelsRef={ref} activity="user" isDark />);
    advance(30);
    expect(Number(ripples()[0].style.opacity)).toBeGreaterThan(0.5);
  });

  it("greys the plasma when the merchant is muted", () => {
    const { renderer, frames } = fakeRenderer();
    gl.renderer = renderer;
    render(<RevLiveOrb levelsRef={levels()} activity="listening" isDark muted />);
    advance(60);
    expect(frames[frames.length - 1].muted).toBeGreaterThan(0.95);
  });

  it("releases the shared canvas on unmount so the next call reuses the warm renderer", () => {
    const { renderer } = fakeRenderer();
    gl.renderer = renderer;
    const { unmount } = render(<RevLiveOrb levelsRef={levels()} activity="listening" isDark />);
    expect(renderer.canvas.parentNode).not.toBeNull();
    unmount();
    expect(renderer.canvas.parentNode).toBeNull();
  });

  it("falls back to the still frame without WebGL and when the context is lost", () => {
    const { container, unmount } = render(<RevLiveOrb levelsRef={levels()} activity="rev" isDark />);
    expect(surface(container)).toBe("still");
    expect(container.querySelector<HTMLImageElement>('img[data-rev-orb="still"]')!.getAttribute("src")).toMatch(/rev-orb-call.*\.webp/);
    unmount();

    const { renderer, state } = fakeRenderer();
    gl.renderer = renderer;
    const lost = render(<RevLiveOrb levelsRef={levels()} activity="rev" isDark />);
    advance(2);
    expect(surface(lost.container)).toBe("gl");
    state.lost = true;
    advance(1);
    expect(surface(lost.container)).toBe("still");
  });

  it("uses the still frame and no GPU work under reduced motion", () => {
    reduced.value = true;
    const { renderer, frames } = fakeRenderer();
    gl.renderer = renderer;
    const { container } = render(<RevLiveOrb levelsRef={levels(0, 1)} activity="rev" isDark />);
    advance(10);
    expect(frames).toHaveLength(0);
    expect(renderer.canvas.parentNode).toBeNull();
    const still = container.querySelector<HTMLImageElement>('img[data-rev-orb="still"]')!;
    expect(still.getAttribute("alt")).toBe("");
  });

  it("accepts a CSS length for the stage size", () => {
    const { container } = render(<RevLiveOrb levelsRef={levels()} activity="rev" isDark={false} size="18rem" />);
    const root = container.querySelector<HTMLElement>("[data-rev-live-orb]")!;
    expect(root.style.width).toBe("18rem");
    expect(root.style.height).toBe("18rem");
  });

  it("shows the orbit while connecting, checking the store or thinking, and not while talking", () => {
    const cases: Array<[Parameters<typeof RevLiveOrb>[0]["activity"], boolean, boolean]> = [
      ["listening", true, true], ["checking", false, true], ["thinking", false, true],
      ["rev", false, false], ["user", false, false], ["listening", false, false],
    ];
    for (const [activity, connecting, waiting] of cases) {
      const { container, unmount } = render(<RevLiveOrb levelsRef={levels()} activity={activity} connecting={connecting} isDark />);
      expect(container.querySelector("[data-rev-live-orb]")!.hasAttribute("data-rev-live-orb-waiting")).toBe(waiting);
      expect(container.querySelector<HTMLElement>("[data-rev-live-orbit]")!.className.includes("rv-orb-orbit")).toBe(waiting);
      unmount();
    }
  });

  it("breathes only while idly listening", () => {
    const listening = render(<RevLiveOrb levelsRef={levels()} activity="listening" isDark />);
    expect(listening.container.querySelector(".rv-orb-breathe")).toBeTruthy();
    listening.unmount();
    const speaking = render(<RevLiveOrb levelsRef={levels()} activity="rev" isDark />);
    expect(speaking.container.querySelector(".rv-orb-breathe")).toBeNull();
  });
});
