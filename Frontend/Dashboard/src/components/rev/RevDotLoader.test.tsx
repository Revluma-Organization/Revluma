import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RevDotLoader, REV_DOTS } from "./RevDotLoader";

afterEach(() => {
  vi.useRealTimers();
});

describe("RevDotLoader", () => {
  it("announces a polite status and keeps the dot matrix decorative", () => {
    const { container } = render(<RevDotLoader />);
    const status = screen.getByRole("status", { name: "Rev is preparing a response" });
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toBe("");
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.classList.contains("rv-dots")).toBe(true);
    expect(container.querySelectorAll("circle")).toHaveLength(REV_DOTS.length);
    expect(container.querySelector("video")).toBeNull();
  });

  it("draws a round 7 x 7 matrix whose ripple starts at the centre", () => {
    expect(REV_DOTS.length).toBe(37);
    const centre = REV_DOTS.find(dot => dot.cx === 3.5 && dot.cy === 3.5)!;
    expect(centre.delay).toBe(0);
    const delays = REV_DOTS.map(dot => dot.delay);
    expect(Math.max(...delays)).toBeLessThanOrEqual(0.72);
    // Centre dot is the largest; rim dots are smaller.
    expect(centre.r).toBe(Math.max(...REV_DOTS.map(dot => dot.r)));
    // Corners are clipped for the round silhouette.
    expect(REV_DOTS.some(dot => dot.cx === 0.5 && dot.cy === 0.5)).toBe(false);
  });

  it("takes its colour from the theme brand role so it follows dark mode", () => {
    const { container } = render(<RevDotLoader />);
    // `text-brand` reads the --rv-brand variable, which .dark redefines.
    expect(container.querySelector("svg")!.classList.contains("text-brand")).toBe(true);
  });

  it("explains a long wait with a quiet caption", () => {
    vi.useFakeTimers();
    render(<RevDotLoader hintAfterMs={8000} />);
    expect(screen.queryByText("Still working on it")).toBeNull();
    act(() => { vi.advanceTimersByTime(8000); });
    expect(screen.getByText("Still working on it")).toBeTruthy();
  });

  it("shows no caption when live steps already explain the wait", () => {
    vi.useFakeTimers();
    render(<RevDotLoader showHint={false} />);
    act(() => { vi.advanceTimersByTime(20000); });
    expect(screen.queryByText("Still working on it")).toBeNull();
  });
});
