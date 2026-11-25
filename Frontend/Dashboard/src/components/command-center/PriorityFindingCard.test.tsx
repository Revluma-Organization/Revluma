import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { PriorityFindingCard } from "./PriorityFindingCard";
import { ccFinding } from "@/test/commandCenterFixtures";
import type { Finding } from "./types";

afterEach(() => {
  cleanup();
});

function primaryFinding(extra: Record<string, unknown> = {}): Finding {
  return ccFinding({
    id: "finding-1",
    severity: "critical",
    title: "Checkout conversion dropped sharply",
    description: "Verified checkout completion fell across the current comparison window.",
    signal_category: "conversion_purchasing",
    ...extra,
  }) as Finding;
}

function openDrawer() {
  fireEvent.click(screen.getByRole("button", { name: "View full details" }));
  return screen.getByRole("dialog");
}

describe("PriorityFindingCard: minimal card with full-details drawer", () => {
  it("renders the severity identity, rank, category, verification state, and detection time", () => {
    render(
      <PriorityFindingCard
        finding={primaryFinding()}
        rank={1}
        isPrimary
        onInvestigate={() => {}}
      />,
    );

    const article = document.querySelector("article[data-priority-primary='true']");
    expect(article?.getAttribute("data-severity")).toBe("critical");
    expect(screen.getByText("Critical priority")).toBeInTheDocument();
    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.getByText("Conversion & purchasing")).toBeInTheDocument();
    expect(screen.getByText("Verified finding")).toBeInTheDocument();
    expect(screen.getByText(/Detected (\d+[mhd] ago|Just now|Yesterday|Recently)/)).toBeInTheDocument();
    expect(screen.getByLabelText("Impact level 3 of 3")).toBeInTheDocument();
  });

  it("adapts the severity identity and impact meter per severity without flashing", () => {
    const { rerender } = render(
      <PriorityFindingCard
        finding={primaryFinding({ severity: "medium" })}
        rank={2}
        isPrimary={false}
        onInvestigate={() => {}}
      />,
    );
    expect(screen.getByText("Medium priority")).toBeInTheDocument();
    expect(screen.getByText("#2")).toBeInTheDocument();
    expect(screen.getByLabelText("Impact level 2 of 3")).toBeInTheDocument();

    rerender(
      <PriorityFindingCard
        finding={primaryFinding({ severity: "low" })}
        rank={3}
        isPrimary={false}
        onInvestigate={() => {}}
      />,
    );
    expect(screen.getByText("Low priority")).toBeInTheDocument();
    expect(screen.getByLabelText("Impact level 1 of 3")).toBeInTheDocument();
  });

  it("keeps the card minimal: verbatim title, description, primary impact, and actions only", () => {
    render(
      <PriorityFindingCard
        finding={primaryFinding()}
        rank={1}
        isPrimary
        onInvestigate={() => {}}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Checkout conversion dropped sharply", level: 3 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Verified checkout completion fell across the current comparison window."),
    ).toBeInTheDocument();
    expect(screen.getByText("$650.00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View full details" })).toBeInTheDocument();

    // Full detail stays behind the drawer until requested.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Recommended next step")).not.toBeInTheDocument();
    expect(screen.queryByText("Why this is the priority")).not.toBeInTheDocument();
    expect(screen.queryByText("Evidence and provenance")).not.toBeInTheDocument();
  });

  it("opens a side drawer with the full evidence, recommendation, and provenance", () => {
    render(
      <PriorityFindingCard
        finding={primaryFinding()}
        rank={1}
        isPrimary
        onInvestigate={() => {}}
      />,
    );

    const dialog = openDrawer();
    const drawer = within(dialog);
    expect(drawer.getByRole("heading", { name: "Checkout conversion dropped sharply" })).toBeInTheDocument();
    expect(drawer.getByLabelText("Key supporting evidence")).toBeInTheDocument();
    expect(drawer.getByText("$650.00")).toBeInTheDocument();
    expect(drawer.getByText("Recommended next step")).toBeInTheDocument();
    expect(
      drawer.getByText("Compare order count and average order value for both periods."),
    ).toBeInTheDocument();
    expect(drawer.getByText(/merchant action, not executed by Revluma/)).toBeInTheDocument();
    expect(drawer.getByRole("heading", { name: "Why this is the priority" })).toBeInTheDocument();
    expect(drawer.getByRole("heading", { name: "Confidence" })).toBeInTheDocument();
    expect(drawer.getByRole("heading", { name: "Limits of this conclusion" })).toBeInTheDocument();
    expect(drawer.getByText("finding-1")).toBeInTheDocument();
  });

  it("closes the drawer from the close control and the Escape key", () => {
    render(
      <PriorityFindingCard
        finding={primaryFinding()}
        rank={1}
        isPrimary
        onInvestigate={() => {}}
      />,
    );

    openDrawer();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    openDrawer();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens Rev Intelligence with the exact finding route from the Ask Rev action", () => {
    const onInvestigate = vi.fn();
    render(
      <PriorityFindingCard
        finding={primaryFinding()}
        rank={1}
        isPrimary
        onInvestigate={onInvestigate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ask Rev about this" }));
    expect(onInvestigate).toHaveBeenCalledTimes(1);
    expect(onInvestigate).toHaveBeenCalledWith("/dashboard/rev-intell?finding=finding-1");
  });

  it("investigates from the drawer footer with the exact finding route", () => {
    const onInvestigate = vi.fn();
    render(
      <PriorityFindingCard
        finding={primaryFinding()}
        rank={1}
        isPrimary
        onInvestigate={onInvestigate}
      />,
    );

    const dialog = openDrawer();
    fireEvent.click(within(dialog).getByRole("button", { name: "Ask Rev about this finding" }));
    expect(onInvestigate).toHaveBeenCalledTimes(1);
    expect(onInvestigate).toHaveBeenCalledWith("/dashboard/rev-intell?finding=finding-1");
  });

  it("uses Investigate with Rev for secondary cards while preserving backend labels", () => {
    const onInvestigate = vi.fn();
    const { rerender } = render(
      <PriorityFindingCard
        finding={primaryFinding({
          next_step: { label: "Investigate with Rev", route: "/dashboard/rev-intell?finding=finding-1" },
        })}
        rank={2}
        isPrimary={false}
        onInvestigate={onInvestigate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Investigate with Rev" }));
    expect(onInvestigate).toHaveBeenCalledWith("/dashboard/rev-intell?finding=finding-1");

    rerender(
      <PriorityFindingCard
        finding={primaryFinding({
          next_step: { label: "Investigate", route: "/dashboard/rev-intell?finding=finding-1" },
        })}
        rank={2}
        isPrimary={false}
        onInvestigate={onInvestigate}
      />,
    );
    expect(screen.getByRole("button", { name: "Investigate" })).toBeInTheDocument();
  });

  it("navigates on card body click but not on button interaction", () => {
    const onInvestigate = vi.fn();
    render(
      <PriorityFindingCard
        finding={primaryFinding()}
        rank={1}
        isPrimary
        onInvestigate={onInvestigate}
      />,
    );

    fireEvent.click(screen.getByText("Checkout conversion dropped sharply"));
    expect(onInvestigate).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "View full details" }));
    expect(onInvestigate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("passes axe-core checks for primary and secondary severities", async () => {
    for (const severity of ["critical", "high", "medium", "low"] as const) {
      const { container, unmount } = render(
        <PriorityFindingCard
          finding={primaryFinding({ severity })}
          rank={1}
          isPrimary
          onInvestigate={() => {}}
        />,
      );
      const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
      expect(results.violations).toEqual([]);
      unmount();
    }
  });
});
