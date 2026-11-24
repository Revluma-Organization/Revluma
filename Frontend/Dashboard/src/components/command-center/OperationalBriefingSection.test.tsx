import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import axe from "axe-core";
import { OperationalBriefingSection } from "./OperationalBriefingSection";
import { translateLimitationToMerchantCopy } from "@/lib/operationalBriefing";
import { ccFixture, ccFinding, ccResource } from "@/test/commandCenterFixtures";
import type { CommandCenterData } from "./types";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async (original) => ({
  ...(await original<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

const NOW = new Date("2026-11-08T12:00:00Z");

afterEach(() => {
  cleanup();
  navigate.mockReset();
});

function baseBriefingData(overrides: Partial<CommandCenterData> = {}): CommandCenterData {
  const base = ccFixture();
  return {
    ...base,
    context: {
      ...base.context,
      store: {
        id: "store-1",
        name: "acme-apparel.myshopify.com",
        shop_domain: "acme-apparel.myshopify.com",
        platform: "shopify",
        iana_timezone: "America/New_York",
      },
      reporting_period: {
        kind: "last_7_days",
        label: "Last 7 days",
        days: 7,
        timezone: "America/New_York",
        timezone_verified: true,
        note: "Rolling 7-day window in America/New_York.",
      },
      comparison_period: {
        kind: "previous_7_days",
        label: "Previous 7 days",
        timezone: "America/New_York",
        comparability: "same_metric_definition",
      },
    },
    business_state: {
      ...base.business_state,
      generated_at: "2026-11-08T11:55:00Z",
      data_freshness_at: "2026-11-08T11:40:00Z",
      presentation_status: "current",
      computation_status: "complete",
    },
    integration: {
      contract_version: "rev-integration-state-v1",
      organization_id: "merchant-a",
      integration_id: "int-1",
      store: {
        id: "store-1",
        shop_domain: "acme-apparel.myshopify.com",
        provider: "shopify",
        installed_at: "2026-01-01T00:00:00Z",
        last_synced_at: "2026-11-08T10:00:00Z",
      },
      overall_status: "connected",
      status_reason: "verified",
      status_explanation: "Store connected and verified.",
      merchant_action_required: false,
      recommended_next_step: null,
      authorization: {
        verification: "verified",
        valid: true,
        verified: true,
        last_verified_at: "2026-11-08T10:00:00Z",
        missing_app_scopes: [],
      },
      synchronization: {
        state: "succeeded",
        running_domains: [],
        failed_domains: [],
        partial_domains: [],
        last_succeeded_at: "2026-11-08T10:00:00Z",
      },
      evaluated_at: "2026-11-08T12:00:00Z",
    },
    briefing: {
      ...base.briefing,
      generated_at: "2026-11-08T11:55:00Z",
      previous_generated_at: "2026-11-08T06:00:00Z",
      has_previous_briefing: true,
      assessment: {
        state: "normal",
        label: "No major issue established",
        data_quality: "verified",
        data_quality_label: "Evidence verified",
      },
      featured_intelligence: {
        status: "empty",
        empty_state: "no_new_findings",
        item: null,
      },
      recent_developments: {
        empty_state: "no_changes",
        items: [],
      },
    },
    evidence: {
      ...base.evidence,
      snapshot_generated_at: "2026-11-08T11:55:00Z",
      last_successful_sync_at: "2026-11-08T10:00:00Z",
    },
    ...overrides,
  };
}

function renderBriefing(
  data: CommandCenterData,
  extra: Partial<React.ComponentProps<typeof OperationalBriefingSection>> = {},
) {
  return render(
    <MemoryRouter initialEntries={["/dashboard/overview"]}>
      <OperationalBriefingSection data={data} nowOverride={NOW} {...extra} />
    </MemoryRouter>,
  );
}

describe("Operational Briefing Rebuild", () => {
  it("1. renders all hybrid editorial and supporting panels with authoritative briefing generation timestamp distinct from sync time", () => {
    const { container } = renderBriefing(baseBriefingData());

    expect(container.querySelector('[data-briefing-layout="hybrid"]')).toBeTruthy();
    expect(screen.getByText("Operational briefing")).toBeInTheDocument();
    expect(screen.getByText(/Business overview · Last 7 days/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "Your latest synchronized business picture",
    );
    // Uses briefing generated_at (5 minutes ago), NOT last_successful_sync_at (2 hours ago)
    expect(screen.getByText("Briefing updated 5 minutes ago")).toBeInTheDocument();
    expect(screen.getByText("No major issue established")).toBeInTheDocument();
    expect(screen.getByText("Evidence verified")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Recent developments", level: 3 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Areas worth investigating", level: 3 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Evidence & data coverage", level: 3 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Operational data health", level: 3 }),
    ).toBeInTheDocument();
    expect(screen.getByText("How this briefing was prepared")).toBeInTheDocument();
  });

  it("2. highlights one qualifying featured discovery without duplicating Top Priority and navigates to Rev Intelligence", () => {
    const topPriority = ccFinding({ id: "priority-1", title: "Top priority revenue shift" });
    const data = baseBriefingData({
      priority_finding: topPriority,
      findings: [topPriority],
      briefing: {
        ...baseBriefingData().briefing,
        assessment: {
          state: "important_development",
          label: "Development detected",
          data_quality: "verified",
          data_quality_label: "Evidence verified",
        },
        featured_intelligence: {
          status: "qualified",
          empty_state: null,
          item: {
            id: "featured:finding-2",
            finding_id: "finding-2",
            title: "Refund value increased across recent orders",
            explanation: "Recorded refund totals increased compared with the prior 7-day window.",
            why_it_matters: "Rising refund value can indicate product or fulfillment friction early.",
            evidence_summary: "Recorded refund transactions and order adjustment history.",
            verification_status: "verified",
            confidence: "high",
            severity: "medium",
            category: "business_performance",
            detected_at: "2026-11-08T09:30:00Z",
            last_verified_at: "2026-11-08T11:30:00Z",
            is_new: true,
            action_label: "Examine supporting evidence",
            action_route: "/dashboard/rev-intell?finding=finding-2",
            references: [],
          },
        },
      },
    });

    renderBriefing(data);

    // Top priority is linked, never duplicated as featured intelligence
    expect(screen.getByRole("link", { name: /Review priority/ })).toHaveAttribute(
      "href",
      "#priority-finding",
    );
    expect(screen.queryByText("Top priority revenue shift")).not.toBeInTheDocument();

    // Featured intelligence details
    expect(screen.getByText("Verified finding")).toBeInTheDocument();
    expect(screen.getByText("New discovery")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Refund value increased across recent orders", level: 4 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Recorded refund transactions and order adjustment history/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Examine supporting evidence/ }));
    expect(navigate).toHaveBeenCalledWith(
      expect.stringContaining("/dashboard/rev-intell?finding=finding-2"),
    );
  });

  it("3. preserves the mandatory Featured Intelligence empty state when no new qualifying discovery exists", () => {
    const { container } = renderBriefing(baseBriefingData());

    expect(
      screen.getByRole("heading", { name: "Areas worth investigating", level: 3 }),
    ).toBeInTheDocument();
    expect(container.querySelector('[data-featured-empty-state="no_new_findings"]')).toBeTruthy();
    expect(screen.getByText("No new findings")).toBeInTheDocument();
    expect(
      screen.getByText("Nothing new requires highlighting right now."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/This doesn't necessarily mean there are no issues in your business/),
    ).toBeInTheDocument();
  });

  it("4. distinguishes insufficient evidence, ongoing investigation, generation failure, and no previous briefing states", () => {
    // Insufficient evidence
    const insufficient = baseBriefingData({
      briefing: {
        ...baseBriefingData().briefing,
        assessment: {
          state: "insufficient_evidence",
          label: "Insufficient evidence",
          data_quality: "insufficient",
          data_quality_label: "Insufficient evidence",
        },
        featured_intelligence: {
          status: "empty",
          empty_state: "insufficient_evidence",
          item: null,
        },
      },
    });
    const { unmount: u1 } = renderBriefing(insufficient);
    expect(
      screen.getByText(
        "We don't yet have enough evidence to highlight a reliable business finding.",
      ),
    ).toBeInTheDocument();
    u1();

    // Investigation running
    const running = baseBriefingData({
      briefing: {
        ...baseBriefingData().briefing,
        featured_intelligence: {
          status: "empty",
          empty_state: "investigation_running",
          item: null,
        },
      },
    });
    const { unmount: u2 } = renderBriefing(running);
    expect(
      screen.getByText("Revluma is examining the available business evidence."),
    ).toBeInTheDocument();
    u2();

    // Briefing generation failed + retry action
    const onRefresh = vi.fn();
    const failed = baseBriefingData({
      business_state: {
        ...baseBriefingData().business_state,
        presentation_status: "failed",
        computation_status: "failed",
      },
      briefing: {
        ...baseBriefingData().briefing,
        featured_intelligence: {
          status: "empty",
          empty_state: "generation_failed",
          item: null,
        },
      },
    });
    const { unmount: u3 } = renderBriefing(failed, { onRefresh });
    expect(
      screen.getByText("We couldn't prepare your intelligence briefing. Please try again."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    u3();

    // No previous briefing
    const first = baseBriefingData({
      briefing: {
        ...baseBriefingData().briefing,
        has_previous_briefing: false,
        previous_generated_at: null,
        featured_intelligence: {
          status: "empty",
          empty_state: "no_previous_briefing",
          item: null,
        },
        recent_developments: {
          empty_state: "no_previous_briefing",
          items: [],
        },
      },
    });
    renderBriefing(first);
    expect(
      screen.getByText("Your first intelligence briefing is being established."),
    ).toBeInTheDocument();
    expect(screen.getByText("No previous briefing is on record yet.")).toBeInTheDocument();
  });

  it("5. renders Recent Developments timeline distinguishing New, Ongoing, and Resolved items with navigation", () => {
    const data = baseBriefingData({
      briefing: {
        ...baseBriefingData().briefing,
        recent_developments: {
          empty_state: null,
          items: [
            {
              id: "dev-1",
              category: "finding",
              lifecycle: "new",
              title: "Order volume shifted in the latest window",
              explanation: "Completed order volume changed relative to the prior period.",
              occurred_at: "2026-11-08T10:30:00Z",
              finding_id: "finding-3",
              route: "/dashboard/rev-intell?finding=finding-3",
              action_label: "Examine finding",
            },
            {
              id: "dev-2",
              category: "finding",
              lifecycle: "ongoing",
              title: "Returning buyer share remains below baseline",
              explanation: "Repeat-buyer share has not returned to the earlier comparison window.",
              occurred_at: "2026-11-07T15:00:00Z",
              finding_id: "finding-4",
              route: "/dashboard/rev-intell?finding=finding-4",
              action_label: "Examine finding",
            },
            {
              id: "dev-3",
              category: "resolved_finding",
              lifecycle: "resolved",
              title: "Checkout anomaly resolved",
              explanation: "A previously identified finding is no longer active.",
              occurred_at: "2026-11-08T08:00:00Z",
              finding_id: "finding-5",
              route: "/dashboard/rev-intell?finding=finding-5",
              action_label: "Review finding",
            },
          ],
        },
      },
    });

    renderBriefing(data);

    expect(screen.getByText("Order volume shifted in the latest window")).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("Ongoing")).toBeInTheDocument();
    expect(screen.getByText("Resolved")).toBeInTheDocument();
    expect(screen.getByText("Yesterday")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /Examine finding/ })[0]);
    expect(navigate).toHaveBeenCalledWith(
      expect.stringContaining("/dashboard/rev-intell?finding=finding-3"),
    );
  });

  it("6. renders an explicit empty timeline message when nothing significant changed", () => {
    renderBriefing(baseBriefingData());
    expect(
      screen.getByText("Nothing significant has changed since your last briefing."),
    ).toBeInTheDocument();
  });

  it("7. translates technical permissions into merchant-friendly copy inside the expandable evidence drawer", () => {
    expect(translateLimitationToMerchantCopy("read_legal_policies permission missing.")).toBe(
      "We cannot currently review your store policies because the required access has not been granted.",
    );

    const data = baseBriefingData({
      briefing: {
        ...baseBriefingData().briefing,
        limitations: ["read_legal_policies permission missing."],
      },
      evidence: {
        ...baseBriefingData().evidence,
        resources: [
          ccResource({ resource: "orders", label: "orders", availability: "available" }),
          ccResource({
            resource: "inventory.levels",
            label: "inventory.levels",
            availability: "unauthorized",
          }),
        ],
      },
    });

    renderBriefing(data);
    const summary = screen.getByText("How this briefing was prepared");
    expect(summary.closest("summary")).toBeTruthy();
    fireEvent.click(summary);

    expect(screen.getByText("Last 7 days")).toBeInTheDocument();
    expect(screen.getByText("America/New_York")).toBeInTheDocument();
    expect(
      screen.getByText(
        "We cannot currently review your store policies because the required access has not been granted.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "We cannot currently review your inventory because the required Shopify access has not been granted.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Technical references")).toBeInTheDocument();
  });

  it("8. never promotes a hypothesis to a verified finding", () => {
    const data = baseBriefingData({
      briefing: {
        ...baseBriefingData().briefing,
        featured_intelligence: {
          status: "qualified",
          empty_state: null,
          item: {
            id: "featured:hyp-1",
            finding_id: "hyp-1",
            title: "Product availability may be inconsistent",
            explanation: "Catalog and inventory records show differing availability states.",
            why_it_matters: "Conflicting availability can confuse shoppers attempting checkout.",
            evidence_summary: "Product availability records and inventory information.",
            verification_status: "hypothesis",
            confidence: "low",
            severity: "medium",
            category: "business_performance",
            detected_at: "2026-11-08T11:00:00Z",
            last_verified_at: null,
            is_new: true,
            action_label: "Examine supporting evidence",
            action_route: "/dashboard/rev-intell?finding=hyp-1",
            references: [],
          },
        },
      },
    });

    renderBriefing(data);
    expect(screen.getByText("Hypothesis")).toBeInTheDocument();
    expect(screen.queryByText("Verified finding")).not.toBeInTheDocument();
  });

  it("9. guards duplicate refresh clicks and confirms update only after backend settles", () => {
    const onRefresh = vi.fn();
    const data = baseBriefingData();
    const { rerender } = render(
      <MemoryRouter initialEntries={["/dashboard/overview"]}>
        <OperationalBriefingSection
          data={data}
          refreshing={false}
          failure={null}
          nowOverride={NOW}
          onRefresh={onRefresh}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Update operational briefing" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Updated")).not.toBeInTheDocument();

    rerender(
      <MemoryRouter initialEntries={["/dashboard/overview"]}>
        <OperationalBriefingSection
          data={data}
          refreshing={true}
          failure={null}
          nowOverride={NOW}
          onRefresh={onRefresh}
        />
      </MemoryRouter>,
    );
    const pendingBtn = screen.getByRole("button", { name: "Updating operational briefing…" });
    expect(pendingBtn).toBeDisabled();
    fireEvent.click(pendingBtn);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    rerender(
      <MemoryRouter initialEntries={["/dashboard/overview"]}>
        <OperationalBriefingSection
          data={data}
          refreshing={false}
          failure={null}
          nowOverride={NOW}
          onRefresh={onRefresh}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Updated")).toBeInTheDocument();
  });

  it("10. passes automated axe-core structural accessibility checks", async () => {
    const { container } = renderBriefing(baseBriefingData());
    const result = await axe.run(container, {
      rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
    });
    expect(result.violations).toEqual([]);
  });
});
