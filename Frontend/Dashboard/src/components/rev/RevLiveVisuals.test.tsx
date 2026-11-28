import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const reduced = vi.hoisted(() => ({ value: false }));
vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>();
  return { ...actual, useReducedMotion: () => reduced.value };
});

import { RevLiveOrb } from "./RevLiveVisuals";

const levels = () => ({ current: { input: 0, output: 0 } });

describe("RevLiveOrb", () => {
  beforeEach(() => {
    reduced.value = false;
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  });

  it("renders the Rev Intelligence plasma orb video, muted for autoplay and hidden from assistive tech", () => {
    const { container } = render(<RevLiveOrb levelsRef={levels()} activity="listening" isDark />);
    const root = container.querySelector("[data-rev-live-orb]")!;
    expect(root.getAttribute("data-rev-live-orb")).toBe("listening");
    expect(root.getAttribute("aria-hidden")).toBe("true");
    const video = container.querySelector<HTMLVideoElement>('video[data-rev-orb="call-video"]')!;
    expect(video).toBeTruthy();
    expect(video.hasAttribute("muted")).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.getAttribute("playsinline")).not.toBeNull();
    expect(video.getAttribute("poster")).toMatch(/rev-orb-call/);
    expect(video.querySelector("source")!.getAttribute("src")).toMatch(/rev-orb-call.*\.mp4/);
    expect(video.style.clipPath).toContain("circle(");
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
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
      const root = container.querySelector("[data-rev-live-orb]")!;
      expect(root.hasAttribute("data-rev-live-orb-waiting")).toBe(waiting);
      const orbit = container.querySelector<HTMLElement>("[data-rev-live-orbit]")!;
      expect(orbit.className.includes("rv-orb-orbit")).toBe(waiting);
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

  it("dims the plasma when the merchant is muted", () => {
    const { container } = render(<RevLiveOrb levelsRef={levels()} activity="listening" isDark muted />);
    const video = container.querySelector<HTMLVideoElement>("video")!;
    expect(video.style.filter).toContain("grayscale");
    expect(container.querySelector(".rv-orb-breathe")).toBeNull();
  });

  it("uses the still frame and no video under reduced motion", () => {
    reduced.value = true;
    const { container } = render(<RevLiveOrb levelsRef={levels()} activity="rev" isDark />);
    expect(container.querySelector("video")).toBeNull();
    const still = container.querySelector<HTMLImageElement>('img[data-rev-orb="still"]')!;
    expect(still.getAttribute("src")).toMatch(/rev-orb-call.*\.webp/);
    expect(still.getAttribute("alt")).toBe("");
  });

  it("swells with Rev's voice and ripples with the merchant's on animation frames", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    const ref = { current: { input: 0, output: 0.8 } };
    const { container, rerender } = render(<RevLiveOrb levelsRef={ref} activity="rev" isDark />);
    for (let i = 0; i < 30; i++) frames.shift()?.(i * 16);
    const sphere = container.querySelector<HTMLElement>("[data-rev-live-orb] .rv-orb-breathe, [data-rev-live-orb] > .absolute.inset-\\[5\\%\\]")!
      .firstElementChild as HTMLElement;
    expect(sphere.style.transform).toMatch(/scale\(1\.0[5-9]|scale\(1\.1/);
    const ripples = () => [...container.querySelectorAll<HTMLElement>("[data-rev-live-ripple]")];
    expect(ripples().every(r => Number(r.style.opacity) === 0)).toBe(true);

    ref.current = { input: 0.8, output: 0 };
    rerender(<RevLiveOrb levelsRef={ref} activity="user" isDark />);
    for (let i = 30; i < 60; i++) frames.shift()?.(i * 16);
    expect(Number(ripples()[0].style.opacity)).toBeGreaterThan(0.5);
    expect(sphere.style.transform).toMatch(/scale\(1(\.00\d*)?\)/);
    vi.unstubAllGlobals();
  });
});
