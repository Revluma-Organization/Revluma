import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { WorkspaceStatus } from "./WorkspaceStatus";

const states = ["loading", "empty", "partial", "error", "success"] as const;

describe("Task 226 shared status accessibility", () => {
  it.each(states)("has no detectable axe violations in %s state", async state => {
    const { container } = render(<WorkspaceStatus state={state} title={`${state} information`} message="Revluma shows only verified information and its limitations." />);
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
  });

  it("operates retry using a semantic button and exposes disabled state", () => {
    const retry = vi.fn();
    const { rerender } = render(<WorkspaceStatus state="error" title="Retrieval interrupted" message="Try again" onRetry={retry} />);
    const button = screen.getByRole("button", { name: "Try again" });
    button.focus(); fireEvent.keyDown(button, { key: "Enter" }); fireEvent.click(button);
    expect(retry).toHaveBeenCalledTimes(1);
    rerender(<WorkspaceStatus state="error" title="Retrieval interrupted" message="Try again" onRetry={retry} retryDisabled />);
    expect(button).toBeDisabled();
  });
});
