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

    // Clicking a priority row body also opens its investigation without interfering with buttons
    fireEvent.click(screen.getByText("Storefront still uses default myshopify.com domain"));
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

  it("renders the distinct incomplete store assessment state when zero findings exist and significant signals failed or were not evaluated", () => {
    const incompleteData = ccFixture({
      signal_evaluation: {
        contract_version: "signal-evaluation-coverage-v1",
        evaluated_at: "2026-11-24T12:00:00.000Z",
        period_days: 7,
        complete: false,
        incomplete: true,
        summary: {
          total_signals: 6,
          evaluated_count: 4,
          verified_findings_count: 0,
          not_detected_count: 4,
          not_evaluated_count: 1,
          failed_count: 1,
          stale_count: 0,
        },
        signals: [
          { id: "storefront_readiness", label: "Storefront readiness", category: "storefront_readiness", state: "not_detected", finding_types: [], source: "store_profiles", last_evaluated_at: "2026-11-24T11:30:00.000Z", reason: "Custom domain active." },
          { id: "traffic_acquisition", label: "Traffic & acquisition", category: "traffic_acquisition", state: "evaluation_failed", finding_types: [], source: "analytics.reports", last_evaluated_at: null, reason: "Shopify Analytics retrieval failed (SHOPIFY_GRAPHQL_ERROR); missing analytics access is never treated as zero traffic." },
          { id: "sales_revenue", label: "Sales & revenue", category: "sales_revenue", state: "not_detected", finding_types: [], source: "orders", last_evaluated_at: "2026-11-24T11:30:00.000Z", reason: "Certified order history evaluated." },
          { id: "conversion_purchasing", label: "Conversion & purchasing", category: "conversion_purchasing", state: "not_evaluated", finding_types: [], source: "abandoned_checkouts", last_evaluated_at: null, reason: "Abandoned checkout records have not yet been synchronized." },
          { id: "product_inventory", label: "Product & inventory", category: "product_inventory", state: "not_detected", finding_types: [], source: "inventory_levels", last_evaluated_at: "2026-11-24T11:30:00.000Z", reason: "Inventory levels evaluated." },
          { id: "customer_fulfillment", label: "Customer & fulfillment", category: "customer_fulfillment", state: "not_detected", finding_types: [], source: "fulfillments", last_evaluated_at: "2026-11-24T11:30:00.000Z", reason: "Fulfillment records evaluated." },
        ],
      },
    });

    render(
      <MemoryRouter>
        <TopPrioritiesSection data={incompleteData} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Your store assessment is incomplete", level: 3 })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "No verified priorities right now" })).not.toBeInTheDocument();
    expect(screen.getByText("4/6 signals evaluated")).toBeInTheDocument();
    expect(screen.getByText("Evaluation failed")).toBeInTheDocument();
    expect(screen.getByText("Not evaluated")).toBeInTheDocument();
    expect(screen.getByText(/missing analytics access is never treated as zero traffic/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Review data coverage/i }));
    expect(navigate).toHaveBeenCalledWith("/dashboard/integrations");
  });

  it("renders complete signal evaluation coverage in the legitimate empty state without conflating raw source counts", () => {
    const completeEmpty = ccFixture({
      signal_evaluation: {
        contract_version: "signal-evaluation-coverage-v1",
        evaluated_at: "2026-11-24T12:00:00.000Z",
        period_days: 7,
        complete: true,
        incomplete: false,
        summary: {
          total_signals: 6,
          evaluated_count: 6,
          verified_findings_count: 0,
          not_detected_count: 6,
          not_evaluated_count: 0,
          failed_count: 0,
          stale_count: 0,
        },
        signals: [
          { id: "storefront_readiness", label: "Storefront readiness", category: "storefront_readiness", state: "not_detected", finding_types: [], source: "store_profiles", last_evaluated_at: "2026-11-24T11:30:00.000Z", reason: "No issues detected." },
          { id: "traffic_acquisition", label: "Traffic & acquisition", category: "traffic_acquisition", state: "not_detected", finding_types: [], source: "analytics.reports", last_evaluated_at: "2026-11-24T11:30:00.000Z", reason: "Active sessions recorded." },
          { id: "sales_revenue", label: "Sales & revenue", category: "sales_revenue", state: "not_detected", finding_types: [], source: "orders", last_evaluated_at: "2026-11-24T11:30:00.000Z", reason: "Order history evaluated." },
          { id: "conversion_purchasing", label: "Conversion & purchasing", category: "conversion_purchasing", state: "not_detected", finding_types: [], source: "abandoned_checkouts", last_evaluated_at: "2026-11-24T11:30:00.000Z", reason: "Checkout records evaluated." },
          { id: "product_inventory", label: "Product & inventory", category: "product_inventory", state: "not_detected", finding_types: [], source: "inventory_levels", last_evaluated_at: "2026-11-24T11:30:00.000Z", reason: "Inventory evaluated." },
          { id: "customer_fulfillment", label: "Customer & fulfillment", category: "customer_fulfillment", state: "not_detected", finding_types: [], source: "fulfillments", last_evaluated_at: "2026-11-24T11:30:00.000Z", reason: "Fulfillment evaluated." },
        ],
      },
    });

    render(
      <MemoryRouter>
        <TopPrioritiesSection data={completeEmpty} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "No verified priorities right now", level: 3 })).toBeInTheDocument();
    expect(screen.getByText("6/6 signals evaluated")).toBeInTheDocument();
    expect(screen.getByText("6 of 6 signals evaluated")).toBeInTheDocument();
    expect(screen.queryByText(/monitored sources/i)).not.toBeInTheDocument();
  });

  it("renders partial evaluation coverage panel alongside populated findings in Scenario 7", () => {
    const partialPopulated: CommandCenterData = {
      ...multiPriorityFixture(),
      signal_evaluation: {
        contract_version: "signal-evaluation-coverage-v1",
        evaluated_at: "2026-11-24T12:00:00.000Z",
        period_days: 7,
        complete: false,
        incomplete: true,
        summary: {
          total_signals: 6,
          evaluated_count: 5,
          verified_findings_count: 3,
          not_detected_count: 2,
          not_evaluated_count: 0,
          failed_count: 1,
          stale_count: 0,
        },
        signals: [
          { id: "storefront_readiness", label: "Storefront readiness", category: "storefront_readiness", state: "verified", finding_types: ["storefront_domain_unconfigured"], source: "store_profiles", last_evaluated_at: "2026-11-24T11:30:00.000Z", reason: "Default .myshopify.com domain detected." },
          { id: "traffic_acquisition", label: "Traffic & acquisition", category: "traffic_acquisition", state: "evaluation_failed", finding_types: [], source: "analytics.reports", last_evaluated_at: null, reason: "Analytics query failed." },
          { id: "sales_revenue", label: "Sales & revenue", category: "sales_revenue", state: "verified", finding_types: ["no_recent_orders"], source: "orders", last_evaluated_at: "2026-11-24T11:30:00.000Z", reason: "No recent orders." },
          { id: "conversion_purchasing", label: "Conversion & purchasing", category: "conversion_purchasing", state: "verified", finding_types: ["abandoned_checkouts_open"], source: "abandoned_carts", last_evaluated_at: "2026-11-24T11:30:00.000Z", reason: "Open abandoned checkouts." },
          { id: "product_inventory", label: "Product & inventory", category: "product_inventory", state: "not_detected", finding_types: [], source: "inventory_levels", last_evaluated_at: "2026-11-24T11:30:00.000Z", reason: "Stock levels normal." },
          { id: "customer_fulfillment", label: "Customer & fulfillment", category: "customer_fulfillment", state: "not_detected", finding_types: [], source: "fulfillments", last_evaluated_at: "2026-11-24T11:30:00.000Z", reason: "Fulfillments normal." },
        ],
      },
    };

    render(
      <MemoryRouter>
        <TopPrioritiesSection data={partialPopulated} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Checkout conversion dropped sharply", level: 3 })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Signal evaluation coverage" })).toBeInTheDocument();
    expect(screen.getByText("Recent signals")).toBeInTheDocument();
    expect(screen.getByText("5/6 signals evaluated")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("passes automated axe-core accessibility checks across populated, empty, incomplete, loading, and error states", async () => {
    const incompleteCase = ccFixture({
      signal_evaluation: {
        contract_version: "signal-evaluation-coverage-v1",
        evaluated_at: "2026-11-24T12:00:00.000Z",
        period_days: 7,
        complete: false,
        incomplete: true,
        summary: {
          total_signals: 6,
          evaluated_count: 5,
          verified_findings_count: 0,
          not_detected_count: 5,
          not_evaluated_count: 0,
          failed_count: 1,
          stale_count: 0,
        },
        signals: [
          { id: "storefront_readiness", label: "Storefront readiness", category: "storefront_readiness", state: "not_detected", finding_types: [], source: "store_profiles", last_evaluated_at: "2026-11-24T11:30:00.000Z", reason: "Evaluated." },
          { id: "traffic_acquisition", label: "Traffic & acquisition", category: "traffic_acquisition", state: "evaluation_failed", finding_types: [], source: "analytics.reports", last_evaluated_at: null, reason: "Failed." },
          { id: "sales_revenue", label: "Sales & revenue", category: "sales_revenue", state: "not_detected", finding_types: [], source: "orders", last_evaluated_at: "2026-11-24T11:30:00.000Z", reason: "Evaluated." },
          { id: "conversion_purchasing", label: "Conversion & purchasing", category: "conversion_purchasing", state: "not_detected", finding_types: [], source: "abandoned_carts", last_evaluated_at: "2026-11-24T11:30:00.000Z", reason: "Evaluated." },
          { id: "product_inventory", label: "Product & inventory", category: "product_inventory", state: "not_detected", finding_types: [], source: "inventory_levels", last_evaluated_at: "2026-11-24T11:30:00.000Z", reason: "Evaluated." },
          { id: "customer_fulfillment", label: "Customer & fulfillment", category: "customer_fulfillment", state: "not_detected", finding_types: [], source: "fulfillments", last_evaluated_at: "2026-11-24T11:30:00.000Z", reason: "Evaluated." },
        ],
      },
    });

    const cases = [
      <TopPrioritiesSection key="pop" data={multiPriorityFixture()} />,
      <TopPrioritiesSection key="empty" data={ccFixture()} />,
      <TopPrioritiesSection key="incomplete" data={incompleteCase} />,
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
