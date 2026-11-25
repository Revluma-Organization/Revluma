import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

describe("PriorityFindingCard: Premium Hybrid Intelligence Card", () => {
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

  it("keeps the title focal with the factual description and compact evidence tiles", () => {
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
    expect(screen.getByLabelText("Key supporting evidence")).toBeInTheDocument();
    expect(screen.getByText("$650.00")).toBeInTheDocument();
  });

  it("shows the recommended next step in a distinct band with the read-only note", () => {
    render(
      <PriorityFindingCard
        finding={primaryFinding()}
        rank={1}
        isPrimary
        onInvestigate={() => {}}
      />,
    );

    expect(screen.getByText("Recommended next step")).toBeInTheDocument();
    expect(
      screen.getByText("Compare order count and average order value for both periods."),
    ).toBeInTheDocument();
    expect(screen.getByText(/merchant action, not executed by Revluma/)).toBeInTheDocument();
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

  it("navigates on card body click but not on disclosure or button interaction", () => {
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

    fireEvent.click(screen.getByText("Inspect evidence, provenance and uncertainty"));
    expect(onInvestigate).toHaveBeenCalledTimes(1);
  });

  it("expands and collapses the evidence disclosure with native semantics", () => {
    render(
      <PriorityFindingCard
        finding={primaryFinding()}
        rank={1}
        isPrimary
        onInvestigate={() => {}}
      />,
    );

    const summary = screen.getByText("Inspect evidence, provenance and uncertainty");
    expect(summary.tagName).toBe("SUMMARY");
    const details = summary.closest("details");
    expect(details?.hasAttribute("open")).toBe(false);

    fireEvent.click(summary);
    expect(details?.hasAttribute("open")).toBe(true);
    expect(screen.getByText("finding-1")).toBeInTheDocument();

    fireEvent.click(summary);
    expect(details?.hasAttribute("open")).toBe(false);
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
