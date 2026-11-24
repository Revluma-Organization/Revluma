import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import axe from "axe-core";
import { TopPrioritiesSection } from "./TopPrioritiesSection";
import { ccFinding, ccFixture, ccResource } from "@/test/commandCenterFixtures";
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
    next_step: {
      label: "Investigate with Rev",
      route: "/dashboard/rev-intell?finding=finding-2",
    },
  }) as Finding;

  const third = ccFinding({
    id: "finding-3",
    severity: "high",
    title: "Storefront still uses default myshopify.com domain",
    description: "Primary storefront domain is unconfigured with zero custom domains connected.",
    evidence: {
      classification: "verified_observation",
      source: "shopify_store_profile",
      observations: [
        {
          label: "Primary domain",
          value: "example-store.myshopify.com",
          unit: "status",
          currency: null,
          period: "current",
          availability: "available",
        },
      ],
      references: [
        { id: "ref-domain-1", source_type: "store_domains", source_record_id: "store-1" },
      ],
      duplicate_finding_ids: [],
    },
    priority: {
      method_version: "finding-priority-v1",
      classification: "high",
      rationale: ["Recorded severity: high.", "Current domain state verified."],
      tie: null,
    },
    investigation: {
      finding_id: "finding-3",
      route: "/dashboard/rev-intell?finding=finding-3",
      context_contract: "rev-selected-finding-v1",
      revalidate_on_open: true,
    },
    next_step: {
      label: "Investigate with Rev",
      route: "/dashboard/rev-intell?finding=finding-3",
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

describe("TopPrioritiesSection — Premium Hybrid Redesign", () => {
  it("renders the restrained empty state with factual counts, coverage, and working Rev Intelligence CTA", () => {
    render(
      <MemoryRouter>
        <TopPrioritiesSection data={ccFixture()} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Top priorities", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("0 active findings")).toBeInTheDocument();
    expect(screen.getByText("Critical & High")).toBeInTheDocument();
    expect(screen.getByText("Medium")).toBeInTheDocument();
    expect(screen.getByText("Low & Watch")).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "No verified priorities right now", level: 3 })).toBeInTheDocument();
    expect(screen.getByText("What this means")).toBeInTheDocument();
    expect(screen.getByText("3 monitored sources")).toBeInTheDocument();
    expect(screen.queryByText(/22 monitored sources/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Explore with Rev Intelligence" }));
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining("/dashboard/rev-intell"));
  });

  it("renders populated ranked findings with severity summary filtering, clean status observations, and Rev handoffs", () => {
    render(
      <MemoryRouter>
        <TopPrioritiesSection data={multiPriorityFixture()} />
      </MemoryRouter>,
    );

    expect(screen.getByText("3 active findings")).toBeInTheDocument();

    // Preserves backend order: #1 critical primary, then #2 medium and #3 high in secondary list
    expect(
      screen.getByRole("heading", { name: "Checkout conversion dropped sharply", level: 3 }),
    ).toBeInTheDocument();

    const queue = screen.getByRole("list", { name: "Other eligible priority findings" });
    const secondaryTitles = within(queue)
      .getAllByRole("heading", { level: 4 })
      .map((el) => el.textContent);
    expect(secondaryTitles).toEqual([
      "Refund volume rose on core SKU",
      "Storefront still uses default myshopify.com domain",
    ]);

    // Status-unit observations render cleanly without appending "status"
    expect(screen.getByText("example-store.myshopify.com")).toBeInTheDocument();
    expect(screen.queryByText(/example-store\.myshopify\.com status/i)).not.toBeInTheDocument();

    // Severity summary card toggles filtering and recovers via Show all priorities
    fireEvent.click(screen.getByRole("button", { name: /Medium/i }));
    expect(screen.queryByRole("heading", { name: "Checkout conversion dropped sharply" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Refund volume rose on core SKU", level: 4 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show all priorities" }));
    expect(
      screen.getByRole("heading", { name: "Checkout conversion dropped sharply", level: 3 }),
    ).toBeInTheDocument();

    // Clicking secondary View investigation button navigates to that exact finding
    const viewButtons = screen.getAllByRole("button", { name: "View investigation" });
    fireEvent.click(viewButtons[0]);
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining("/dashboard/rev-intell?finding=finding-2"));

    // Clicking a priority card body also opens its investigation without interfering with buttons
    fireEvent.click(screen.getByText("Primary storefront domain is unconfigured with zero custom domains connected."));
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining("/dashboard/rev-intell?finding=finding-3"));
  });

  it("renders a loading skeleton without flashing the empty state", () => {
    render(
      <MemoryRouter>
        <TopPrioritiesSection data={null} loading />
      </MemoryRouter>,
    );

    expect(screen.getByRole("status", { name: "Loading top priorities" })).toBeInTheDocument();
    expect(screen.queryByText("No verified priorities right now")).not.toBeInTheDocument();
    expect(screen.queryByText("0 active findings")).not.toBeInTheDocument();
  });

  it("renders a concise error state with functional Retry instead of zero findings", () => {
    const onRetry = vi.fn();
    render(
      <MemoryRouter>
        <TopPrioritiesSection
          data={null}
          error="Could not reach the intelligence service."
          onRetry={onRetry}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Unable to load verified priorities");
    expect(screen.getByRole("alert")).toHaveTextContent("Could not reach the intelligence service.");
    expect(screen.queryByText("0 active findings")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("communicates stale data and partial evidence coverage accurately", () => {
    const stalePartial = ccFixture({
      business_state: {
        ...ccFixture().business_state,
        stale: true,
        presentation_status: "stale",
      },
      evidence: {
        ...ccFixture().evidence,
        resources: [
          ccResource({ resource: "orders", availability: "available" }),
          ccResource({ resource: "inventory.levels", availability: "unauthorized" }),
        ],
      },
    });

    render(
      <MemoryRouter>
        <TopPrioritiesSection data={stalePartial} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("status")).toHaveTextContent(/Underlying store data is stale/i);
    expect(screen.getByText(/1 limited/)).toBeInTheDocument();
  });

  it("passes automated axe-core accessibility checks across populated, empty, loading, and error states", async () => {
    const cases = [
      <TopPrioritiesSection key="pop" data={multiPriorityFixture()} />,
      <TopPrioritiesSection key="empty" data={ccFixture()} />,
      <TopPrioritiesSection key="load" data={null} loading />,
      <TopPrioritiesSection key="err" data={null} error="Network error" onRetry={() => {}} />,
    ];

    for (const element of cases) {
      const { container, unmount } = render(<MemoryRouter>{element}</MemoryRouter>);
      const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
      expect(results.violations).toEqual([]);
      unmount();
    }
  });
});
