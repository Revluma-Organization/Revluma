import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RevOrb, RevOrbVideo } from "./RevOrb";

function mockReducedMotion(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? matches : false,
    media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe("RevOrb", () => {
  it("renders the animated transparent orb with a still source for reduced motion", () => {
    const { container } = render(<RevOrb size={32} alt="Rev" />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("alt")).toBe("Rev");
    expect(img.getAttribute("src")).toMatch(/rev-orb\.webp/);
    expect(img.getAttribute("width")).toBe("32");
    const still = container.querySelector("source")!;
    expect(still.getAttribute("media")).toBe("(prefers-reduced-motion: reduce)");
    expect(still.getAttribute("srcset")).toMatch(/rev-orb\.png/);
  });

  it("is decorative when no accessible name is given", () => {
    const { container } = render(<RevOrb size={24} />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("alt")).toBe("");
    expect(img.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("RevOrbVideo", () => {
  it("plays a muted inline H.264 loop, screen-blended so its black background disappears", () => {
    mockReducedMotion(false);
    const { container } = render(<RevOrbVideo size={24} />);
    const video = container.querySelector("video")!;
    expect(video).toBeTruthy();
    expect(video.autoplay).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.hasAttribute("playsinline")).toBe(true);
    expect(video.getAttribute("aria-hidden")).toBe("true");
    expect(video.style.mixBlendMode).toBe("screen");
    const sources = [...container.querySelectorAll("source")].map(source => source.getAttribute("src"));
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatch(/rev-orb\.mp4/);
  });

  it("shows the still orb instead of video when the user prefers reduced motion", () => {
    mockReducedMotion(true);
    const { container } = render(<RevOrbVideo size={24} />);
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("img")!.getAttribute("src")).toMatch(/rev-orb\.png/);
  });
});
