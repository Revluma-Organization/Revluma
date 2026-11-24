import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import axe from "axe-core";
import { TopPrioritiesSection } from "./TopPrioritiesSection";
import { ccFinding, ccFixture } from "@/test/commandCenterFixtures";
import type { CommandCenterData, Finding } from "./types";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async (original) => ({
  ...(await original<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

afterEach(() => {
  cleanup();
  navigate.mockReset();
});

function multiPriorityFixture(): CommandCenterData {
  const first = ccFinding({
    id: "finding-1",
    severity: "critical",
    title: "Checkout conversion dropped sharply",
    description: "Verified checkout completion fell across the current comparison window.",
    priority: {
      method_version: "finding-priority-v1",
      classification: "critical",
      rationale: ["Recorded severity: critical.", "Fresh certified evidence."],
      tie: null,
    },
  }) as Finding;

  const second = ccFinding({
    id: "finding-2",
    severity: "medium",
    title: "Refund volume rose on core SKU",
    description: "Recorded refunds increased over the equal-length UTC window.",
    priority: {
      method_version: "finding-priority-v1",
      classification: "medium",
      rationale: ["Recorded severity: medium.", "Verified refund ledger evidence."],
      tie: null,
    },
    recommendation: {
      available: true,
      step: "Inspect refund reason codes for the affected SKU.",
      rationale: "Confirm whether returns are concentrated in one fulfillment batch.",
      expected_result: "Isolate affected order IDs.",
      validation_method: "Compare refund rate next week.",
      prerequisites: [],
      read_only: true,
      executed: false,
    },
    investigation: {
      finding_id: "finding-2",
      route: "/dashboard/rev-intell?finding=finding-2",
      context_contract: "rev-selected-finding-v1",
      revalidate_on_open: true,
    },
  }) as Finding;

  const third = ccFinding({
    id: "finding-3",
    severity: "high",
    title: "Inventory stockout risk on top seller",
    description: "Available inventory fell below recent recorded unit velocity.",
    priority: {
      method_version: "finding-priority-v1",
      classification: "high",
      rationale: ["Recorded severity: high.", "Current inventory snapshot verified."],
      tie: null,
    },
    investigation: {
      finding_id: "finding-3",
      route: "/dashboard/rev-intell?finding=finding-3",
      context_contract: "rev-selected-finding-v1",
      revalidate_on_open: true,
    },
  }) as Finding;

  return ccFixture({
    findings: [first, second, third],
    priority_finding: first,
    priority_selection: {
      method_version: "finding-priority-v1",
      eligible_count: 3,
      tie: null,
      exclusions: [],
      no_defensible_priority: false,
      reason: null,
    },
  });
}

describe("TopPrioritiesSection — Priority List UI patterns", () => {
  it("renders factual priority tier summary and progressive ranking guide in the empty state", () => {
    render(
      <MemoryRouter>
        <TopPrioritiesSection data={ccFixture()} />
      </MemoryRouter>,
    );

    expect(screen.getByText("Critical & High")).toBeInTheDocument();
    expect(screen.getByText("Medium")).toBeInTheDocument();
    expect(screen.getByText("Low & Watch")).toBeInTheDocument();
    expect(screen.getByText("3 sources monitored")).toBeInTheDocument();

    const guideBtn = screen.getByRole("button", { name: /How priorities are ranked/i });
    expect(guideBtn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(guideBtn);
    expect(guideBtn).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("1. Evidence-threshold gated")).toBeInTheDocument();
    expect(screen.getByText("3. Progressive triage queue")).toBeInTheDocument();
  });

  it("supports one-click priority filtering, sorting, compact density, and keyboard reordering with reset", () => {
    render(
      <MemoryRouter>
        <TopPrioritiesSection data={multiPriorityFixture()} />
      </MemoryRouter>,
    );

    // Filter to High: hides #1 (critical) with recovery banner and keeps #3 (high) in queue
    fireEvent.click(screen.getByRole("button", { name: /High 1/i }));
    expect(screen.getByText(/is hidden by the/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Inventory stockout risk on top seller", level: 4 })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Refund volume rose on core SKU" })).not.toBeInTheDocument();

    // Reset filter back to All
    fireEvent.click(screen.getByRole("button", { name: "Show all priorities" }));
    expect(screen.getByRole("heading", { name: "Checkout conversion dropped sharply", level: 3 })).toBeInTheDocument();

    // Default authoritative order: Refund volume (#2) before Inventory stockout (#3)
    const queue = screen.getByRole("list", { name: "Other eligible priority findings" });
    const initialTitles = within(queue)
      .getAllByRole("heading", { level: 4 })
      .map((el) => el.textContent);
    expect(initialTitles).toEqual([
      "Refund volume rose on core SKU",
      "Inventory stockout risk on top seller",
    ]);

    // One-click sort by Severity puts High (#3) ahead of Medium (#2)
    fireEvent.click(screen.getByRole("button", { name: /Sort secondary priorities/i }));
    const sortedTitles = within(queue)
      .getAllByRole("heading", { level: 4 })
      .map((el) => el.textContent);
    expect(sortedTitles).toEqual([
      "Inventory stockout risk on top seller",
      "Refund volume rose on core SKU",
    ]);

    // Move bottom item up switches to Custom order and reveals Reset order
    fireEvent.click(screen.getByRole("button", { name: "Move Refund volume rose on core SKU up" }));
    expect(screen.getByText("Sorted: Custom")).toBeInTheDocument();
    const customTitles = within(queue)
      .getAllByRole("heading", { level: 4 })
      .map((el) => el.textContent);
    expect(customTitles).toEqual([
      "Refund volume rose on core SKU",
      "Inventory stockout risk on top seller",
    ]);

    fireEvent.click(screen.getByRole("button", { name: /Reset order/i }));
    expect(screen.getByText("Sorted: Rank")).toBeInTheDocument();

    // Toggle Compact single-line density
    const compactBtn = screen.getByRole("button", { name: "Compact single-line rows" });
    fireEvent.click(compactBtn);
    expect(compactBtn).toHaveAttribute("aria-pressed", "true");
  });

  it("provides progressive disclosure drawers and quick-review check toggles on priority items", () => {
    render(
      <MemoryRouter>
        <TopPrioritiesSection data={multiPriorityFixture()} />
      </MemoryRouter>,
    );

    // Secondary row keeps deep rationale and suggested next step collapsed until expanded
    expect(screen.queryByText(/Inspect refund reason codes for the affected SKU/i)).not.toBeInTheDocument();

    const expandBtn = screen.getByRole("button", {
      name: "Show details for Refund volume rose on core SKU",
    });
    fireEvent.click(expandBtn);
    expect(expandBtn).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/Inspect refund reason codes for the affected SKU/i)).toBeInTheDocument();

    // Quick-review check toggle marks an item reviewed locally without removing Investigate action
    const reviewBtn = screen.getByRole("button", {
      name: "Mark Checkout conversion dropped sharply as reviewed",
    });
    expect(reviewBtn).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(reviewBtn);
    expect(screen.getByRole("button", { name: "Unmark Checkout conversion dropped sharply as reviewed" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Reviewed")).toBeInTheDocument();
  });

  it("passes automated axe-core structural accessibility checks in both multi-item and empty states", async () => {
    const { container, rerender } = render(
      <MemoryRouter>
        <TopPrioritiesSection data={multiPriorityFixture()} />
      </MemoryRouter>,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Show details for Refund volume rose on core SKU",
      }),
    );

    const multiResults = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(multiResults.violations).toEqual([]);

    rerender(
      <MemoryRouter>
        <TopPrioritiesSection data={ccFixture()} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /How priorities are ranked/i }));

    const emptyResults = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(emptyResults.violations).toEqual([]);
  });
});
