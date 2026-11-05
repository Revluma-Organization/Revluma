import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import JumpToLatest from "./JumpToLatest";

describe("JumpToLatest", () => {
  it("is mounted but hidden, unfocusable and outside the a11y tree when not visible", () => {
    const { container } = render(<JumpToLatest visible={false} onClick={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Back to latest message" })).toBeNull();
    const pill = container.querySelector("[data-rev-jump-to-latest]");
    expect(pill).toBeTruthy();
    expect(pill).toHaveAttribute("aria-hidden", "true");
    expect(pill).toHaveAttribute("tabindex", "-1");
  });

  it("joins the a11y tree and fires the callback when visible", () => {
    const onClick = vi.fn();
    render(<JumpToLatest visible onClick={onClick} />);
    const pill = screen.getByRole("button", { name: "Back to latest message" });
    expect(pill).not.toHaveAttribute("aria-hidden", "true");
    fireEvent.click(pill);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is click-through and invisible while hidden (pointer-events guard)", () => {
    const { container } = render(<JumpToLatest visible={false} onClick={vi.fn()} dark />);
    const pill = container.querySelector<HTMLElement>("[data-rev-jump-to-latest]")!;
    // jsdom does not enforce pointer-events, so assert the mechanism itself:
    // a hidden pill must be fully transparent to pointer and invisible.
    expect(pill.style.pointerEvents).toBe("none");
    expect(pill.style.opacity).toBe("0");
  });
});
