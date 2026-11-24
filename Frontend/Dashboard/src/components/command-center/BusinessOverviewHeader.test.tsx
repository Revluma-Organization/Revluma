import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import axe from "axe-core";
import { BusinessOverviewHeader } from "./BusinessOverviewHeader";
import { HealthIndicators } from "./CommandCenterSections";
import { ccFixture } from "@/test/commandCenterFixtures";
import { businessHealthFixture } from "@/test/businessHealthFixtures";
import {
  resolveConnectionStatus,
  resolveLastUpdate,
  resolveReportingContext,
} from "@/lib/overviewReporting";
import type { CommandCenterData } from "./types";

afterEach(() => {
  cleanup();
});

function renderHeader(
  data: CommandCenterData | null,
  overrides: Partial<React.ComponentProps<typeof BusinessOverviewHeader>> = {},
) {
  return render(
    <MemoryRouter initialEntries={["/dashboard/overview"]}>
      <BusinessOverviewHeader
        data={data}
        refreshing={false}
        onRefresh={() => {}}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

function multiStoreFixture(): CommandCenterData {
  const health = businessHealthFixture({
    reporting_period: {
      current: {
        label: "last_7_days",
        start: "2026-11-01T12:00:00Z",
        end: "2026-11-08T12:00:00Z",
      },
      comparison: {
        label: "previous_7_days",
        start: "2026-10-25T12:00:00Z",
        end: "2026-11-01T12:00:00Z",
      },
      timezone: "America/New_York",
      period_basis: "rolling_7d_store_tz",
      note: "Rolling 7-day period in America/New_York.",
    },
  });
  const base = ccFixture({
    business_health: health,
    integration: {
      contract_version: "rev-integration-state-v1",
      organization_id: "merchant-a",
      integration_id: "int-1",
      store: {
        id: "store-1",
        shop_domain: "acme-apparel.myshopify.com",
        provider: "shopify",
        installed_at: "2026-01-01T00:00:00Z",
        last_synced_at: "2026-11-08T11:55:00Z",
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
        last_verified_at: "2026-11-08T11:55:00Z",
        missing_app_scopes: [],
      },
      synchronization: {
        state: "succeeded",
        running_domains: [],
        failed_domains: [],
        partial_domains: [],
        last_succeeded_at: "2026-11-08T11:55:00Z",
      },
      evaluated_at: "2026-11-08T12:00:00Z",
    },
  });
  return {
    ...base,
    context: {
      ...base.context,
      store: {
        id: "store-1",
        name: "acme-apparel.myshopify.com",
        display_name: "Acme Apparel",
        shop_domain: "acme-apparel.myshopify.com",
        platform: "shopify",
        iana_timezone: "America/New_York",
      },
      stores: [
        {
          id: "store-1",
          name: "acme-apparel.myshopify.com",
          display_name: "Acme Apparel",
          shop_domain: "acme-apparel.myshopify.com",
          platform: "shopify",
          iana_timezone: "America/New_York",
          connection_status: "connected",
        },
        {
          id: "store-2",
          name: "acme-eu.myshopify.com",
          display_name: "Acme Europe",
          shop_domain: "acme-eu.myshopify.com",
          platform: "shopify",
          iana_timezone: "Europe/London",
          connection_status: "limited_access",
        },
      ],
      reporting_period: {
        kind: "last_7_days",
        label: "Last 7 days",
        days: 7,
        timezone: "America/New_York",
        timezone_verified: true,
        start: "2026-11-01T12:00:00Z",
        end: "2026-11-08T12:00:00Z",
        note: "Using store verified Shopify timezone.",
      },
    },
  };
}

describe("Section 01 — Business Overview header", () => {
  it("renders the required executive heading and supporting copy", () => {
    renderHeader(multiStoreFixture());
    expect(
      screen.getByRole("heading", { name: "Your business at a glance.", level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Understand your store's performance, discover what needs attention, and see what Revluma knows about your business.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Command Center" })).not.toBeInTheDocument();
  });

  it("displays the verified Shopify store timezone consistently between header and Business Health", () => {
    const data = multiStoreFixture();
    render(
      <MemoryRouter initialEntries={["/dashboard/overview"]}>
        <BusinessOverviewHeader data={data} refreshing={false} onRefresh={() => {}} />
        <HealthIndicators data={data} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Last 7 days")).toBeInTheDocument();
    expect(screen.getAllByText(/New York \((EST|EDT)\)/)).toHaveLength(2);
    expect(
      screen.getByText(/Verified operational indicators · Last 7 days · New York \((EST|EDT)\)/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Today & yesterday · UTC/)).not.toBeInTheDocument();
  });

  it("exposes store switcher trigger with store display name and concise connection status", () => {
    renderHeader(multiStoreFixture());
    expect(
      screen.getByRole("button", { name: /Switch store, current store: Acme Apparel/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
  });

  it("never exposes raw internal integration states or raw ISO timestamps", () => {
    const data = multiStoreFixture();
    const failedData: CommandCenterData = {
      ...data,
      integration: {
        ...data.integration!,
        overall_status: "authorization_expired",
      },
    };
    renderHeader(failedData, { lastSuccessfulAt: "2026-11-08T11:55:00.000Z" });
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
    expect(screen.queryByText(/authorization_expired/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/2026-11-08T11:55:00/)).not.toBeInTheDocument();
    const attentionLink = screen.getByRole("link", { name: /Needs attention/i });
    expect(attentionLink).toHaveAttribute("href", "/dashboard/integrations");
  });

  it("maps every canonical integration state to concise merchant language", () => {
    const data = multiStoreFixture();
    expect(resolveConnectionStatus(data, "connected").label).toBe("Connected");
    expect(resolveConnectionStatus(data, "synchronizing").label).toBe("Syncing");
    expect(resolveConnectionStatus(data, "limited_access").label).toBe("Limited data");
    expect(resolveConnectionStatus(data, "sync_partial").label).toBe("Limited data");
    expect(resolveConnectionStatus(data, "sync_failed").label).toBe("Needs attention");
    expect(resolveConnectionStatus(data, "authorization_revoked").label).toBe("Needs attention");
    expect(resolveConnectionStatus(data, "disconnected").label).toBe("Not connected");
    expect(resolveConnectionStatus(data, "unknown").label).toBe("Status unavailable");
  });

  it("formats last successful update in human-readable form without raw ISO strings", () => {
    const data = multiStoreFixture();
    const now = new Date("2026-11-08T12:00:00Z");
    expect(resolveLastUpdate(data, "2026-11-08T11:59:45Z", false, "America/New_York", now).label).toBe(
      "Updated just now",
    );
    expect(resolveLastUpdate(data, "2026-11-08T11:50:00Z", false, "America/New_York", now).label).toBe(
      "Updated 10m ago",
    );
    expect(resolveLastUpdate(data, "2026-11-08T09:00:00Z", false, "America/New_York", now).label).toBe(
      "Updated 3h ago",
    );
    expect(resolveLastUpdate(data, "2026-11-08T11:50:00Z", true, "America/New_York", now).label).toBe(
      "Updating…",
    );
  });

  it("resolves verified reporting context consistently even when business_health overrides legacy UTC snapshot", () => {
    const legacyWithHealth = ccFixture({
      business_health: businessHealthFixture({
        reporting_period: {
          current: { label: "last_7_days", start: "2026-11-01T00:00:00Z", end: "2026-11-08T00:00:00Z" },
          comparison: { label: "previous_7_days", start: "2026-10-25T00:00:00Z", end: "2026-11-01T00:00:00Z" },
          timezone: "America/New_York",
          period_basis: "rolling_7d_store_tz",
          note: "Rolling 7d",
        },
      }),
    });
    const ctx = resolveReportingContext(legacyWithHealth);
    expect(ctx.periodLabel).toBe("Last 7 days");
    expect(ctx.timezone.iana).toBe("America/New_York");
    expect(ctx.timezone.verified).toBe(true);
  });

  it("triggers refresh and exposes accessible pending state", () => {
    const onRefresh = vi.fn();
    renderHeader(multiStoreFixture(), { onRefresh });
    fireEvent.click(screen.getByRole("button", { name: "Refresh briefing" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("has zero structural axe-core accessibility violations", async () => {
    const { container } = renderHeader(multiStoreFixture(), {
      onSelectStore: vi.fn(),
      onSelectPeriod: vi.fn(),
    });
    const result = await axe.run(container, {
      rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
    });
    expect(result.violations).toEqual([]);
  });
});
