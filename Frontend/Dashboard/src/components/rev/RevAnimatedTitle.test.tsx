import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RevAnimatedTitle } from "./RevAnimatedTitle";

describe("RevAnimatedTitle", () => {
  it("announces the whole title once and hides the per-letter reveal", () => {
    const { container } = render(<RevAnimatedTitle text="Friendly greetings" />);
    expect(screen.getByText("Friendly greetings")).toHaveClass("sr-only");
    const typed = container.querySelector(".rv-title-typed")!;
    expect(typed).toHaveAttribute("aria-hidden", "true");
    expect(typed.querySelectorAll(".rv-title-char")).toHaveLength(18);
    expect(typed.textContent).toBe("Friendly greetings");
    expect(container.querySelector("[data-rev-title]")).toHaveAttribute("title", "Friendly greetings");
    expect(container.querySelector("[data-rev-title]")).toHaveClass("truncate");
  });

  it("types left to right and caps the reveal for long titles", () => {
    const long = "Why revenue dropped on mobile checkout this week across regions";
    const { container } = render(<RevAnimatedTitle text={long} />);
    const delays = [...container.querySelectorAll<HTMLElement>(".rv-title-char")].map(el => parseInt(el.style.animationDelay, 10));
    expect(delays[0]).toBe(0);
    expect(delays).toEqual([...delays].sort((a, b) => a - b));
    expect(Math.max(...delays)).toBeLessThanOrEqual(600);
  });

  it("restarts the reveal when the title changes", () => {
    const { container, rerender } = render(<RevAnimatedTitle text="New conversation" />);
    const before = container.querySelector(".rv-title-typed");
    rerender(<RevAnimatedTitle text="Saying hello" />);
    const after = container.querySelector(".rv-title-typed");
    expect(after).not.toBe(before);
    expect(after!.textContent).toBe("Saying hello");
  });
});
