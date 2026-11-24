import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import axe from "axe-core";
import { CommandCenterWelcomeSection } from "./CommandCenterWelcomeSection";
import { ccFixture } from "@/test/commandCenterFixtures";
import {
  WELCOME_SUPPORTING_COPY,
  formatWelcomeGreeting,
  resolveLastSynchronized,
  resolveMerchantGreetingName,
  resolveWelcomeConnectionStatus,
} from "@/lib/commandCenterWelcome";
import type { CommandCenterData } from "./types";

afterEach(() => {
  cleanup();
});

function connectedStoreFixture(
  overrides: Partial<CommandCenterData> = {},
): CommandCenterData {
  const base = ccFixture({
    retrieved_at: "2026-11-08T15:00:00Z",
    integration: {
      contract_version: "rev-integration-state-v1",
      organization_id: "merchant-a",
      integration_id: "int-1",
      store: {
        id: "store-1",
        shop_domain: "acme-apparel.myshopify.com",
        provider: "shopify",
        installed_at: "2026-01-01T00:00:00Z",
        last_synced_at: "2026-11-08T14:58:00Z",
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
        last_verified_at: "2026-11-08T14:58:00Z",
        missing_app_scopes: [],
      },
      synchronization: {
        state: "succeeded",
        running_domains: [],
        failed_domains: [],
        partial_domains: [],
        last_succeeded_at: "2026-11-08T14:58:00Z",
      },
      evaluated_at: "2026-11-08T15:00:00Z",
    },
  });

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
      stores: [
        {
          id: "store-1",
          name: "acme-apparel.myshopify.com",
          shop_domain: "acme-apparel.myshopify.com",
          platform: "shopify",
          iana_timezone: "America/New_York",
          connection_status: "connected",
        },
      ],
    },
    evidence: {
      ...base.evidence,
      last_successful_sync_at: "2026-11-08T14:58:00Z",
    },
    ...overrides,
  };
}

function renderWelcome(
  props: Partial<React.ComponentProps<typeof CommandCenterWelcomeSection>> = {},
) {
  return render(
    <MemoryRouter initialEntries={["/dashboard/overview"]}>
      <CommandCenterWelcomeSection
        data={connectedStoreFixture()}
        refreshing={false}
        onRefresh={() => {}}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe("Command Center Welcome Section", () => {
  describe("1. Personalized Greeting", () => {
    it("greets the merchant using their preferred nickname/display name and local store time", () => {
      // 2026-11-08T14:00:00Z is 09:00 AM EST in America/New_York -> morning
      renderWelcome({
        userOverride: { full_name: "Ada Lovelace", nickname: "Ada" },
        nowOverride: new Date("2026-11-08T14:00:00Z"),
      });

      const heading = screen.getByRole("heading", { level: 1 });
      expect(heading).toHaveTextContent("Good morning, Ada.");
      expect(screen.getByText(WELCOME_SUPPORTING_COPY)).toBeInTheDocument();
    });

    it("switches greeting dynamically between morning, afternoon, and evening in the store timezone", () => {
      const data = connectedStoreFixture(); // America/New_York (EST = UTC-5 on Nov 8)
      const user = { full_name: "Jordan Rivera" };

      expect(
        formatWelcomeGreeting(user, data, new Date("2026-11-08T13:30:00Z")).text,
      ).toBe("Good morning, Jordan"); // 08:30 EST
      expect(
        formatWelcomeGreeting(user, data, new Date("2026-11-08T18:15:00Z")).text,
      ).toBe("Good afternoon, Jordan"); // 13:15 EST
      expect(
        formatWelcomeGreeting(user, data, new Date("2026-11-08T23:45:00Z")).text,
      ).toBe("Good evening, Jordan"); // 18:45 EST
    });

    it("prefers configured nickname/display_name, falls back to first name, and omits name when unavailable", () => {
      expect(
        resolveMerchantGreetingName({
          full_name: "Benjamin Splendor",
          nickname: "Benny",
          display_name: "Benjamin",
        }),
      ).toBe("Benny");
      expect(
        resolveMerchantGreetingName({
          full_name: "Benjamin Splendor",
          display_name: "Ben",
        }),
      ).toBe("Ben");
      expect(resolveMerchantGreetingName({ full_name: "  Amara   Okafor " })).toBe("Amara");
      expect(resolveMerchantGreetingName({ full_name: "merchant@example.com" })).toBeNull();
      expect(resolveMerchantGreetingName({ full_name: "   " })).toBeNull();
      expect(resolveMerchantGreetingName(null)).toBeNull();
    });

    it("renders a clean greeting without a name when user profile is unavailable", () => {
      renderWelcome({
        userOverride: null,
        nowOverride: new Date("2026-11-08T14:00:00Z"),
      });
      const heading = screen.getByRole("heading", { level: 1 });
      expect(heading.textContent).toBe("Good morning.");
    });
  });

  describe("2. Compact Connected Store Status", () => {
    it("displays the compact horizontal store identity, connection badge, sync timestamp, and refresh control", () => {
      renderWelcome();

      const storeRegion = screen.getByRole("region", { name: "Connected store" });
      expect(storeRegion.className).toContain("bg-white");
      expect(storeRegion.className).toContain("flex-wrap");

      const badge = screen.getByText("Connected");
      expect(badge).toBeInTheDocument();
      expect(badge.parentElement?.className).toContain("text-[#067647]");
      expect(screen.getByText("acme-apparel.myshopify.com")).toBeInTheDocument();
      expect(screen.getByText(/^Last synchronized:/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Refresh briefing" })).toBeInTheDocument();
    });

    it("does NOT render a fake store dropdown/chevron when only a single store exists", () => {
      renderWelcome({ onSelectStore: vi.fn() });
      expect(
        screen.queryByRole("button", { name: /Switch store/i }),
      ).not.toBeInTheDocument();
    });

    it("renders a real store-switcher chevron when multiple stores are connected", () => {
      const base = connectedStoreFixture();
      const multiStore: CommandCenterData = {
        ...base,
        context: {
          ...base.context,
          stores: [
            {
              id: "store-1",
              name: "acme-apparel.myshopify.com",
              display_name: "Acme Apparel",
              shop_domain: "acme-apparel.myshopify.com",
              platform: "shopify",
              connection_status: "connected",
            },
            {
              id: "store-2",
              name: "acme-eu.myshopify.com",
              display_name: "Acme Europe",
              shop_domain: "acme-eu.myshopify.com",
              platform: "shopify",
              connection_status: "connected",
            },
          ],
        },
      };
      renderWelcome({ data: multiStore, onSelectStore: vi.fn() });
      expect(
        screen.getByRole("button", { name: /Switch store, current store/i }),
      ).toBeInTheDocument();
    });

    it("handles disconnected, expired, reconnect-required, sync-issue, and loading states honestly", () => {
      const data = connectedStoreFixture();

      // Loading
      expect(resolveWelcomeConnectionStatus(null, true, null)).toMatchObject({
        label: "Checking connection",
        tone: "neutral",
        isConfirmedConnected: false,
      });

      // API failure never fabricates disconnected or connected
      expect(
        resolveWelcomeConnectionStatus(null, false, {
          kind: "network",
          retryAfterSeconds: null,
          backendMessage: null,
        }),
      ).toMatchObject({
        label: "Status unavailable",
        tone: "neutral",
        isConfirmedConnected: false,
      });

      // Confirmed connected (ONLY green state)
      expect(resolveWelcomeConnectionStatus(data, false, null)).toMatchObject({
        label: "Connected",
        tone: "positive",
        isConfirmedConnected: true,
      });

      // Disconnected
      expect(
        resolveWelcomeConnectionStatus(data, false, null, "disconnected"),
      ).toMatchObject({
        label: "Disconnected",
        tone: "neutral",
        isConfirmedConnected: false,
        needsAction: true,
      });

      // Expired authorization
      expect(
        resolveWelcomeConnectionStatus(data, false, null, "authorization_expired"),
      ).toMatchObject({
        label: "Authorization expired",
        tone: "negative",
        isConfirmedConnected: false,
        needsAction: true,
      });

      // Revoked / required authorization
      expect(
        resolveWelcomeConnectionStatus(data, false, null, "authorization_revoked"),
      ).toMatchObject({
        label: "Reconnect required",
        tone: "negative",
        isConfirmedConnected: false,
        needsAction: true,
      });

      // Sync failure stays distinct from Disconnected (never falsely green either)
      expect(
        resolveWelcomeConnectionStatus(data, false, null, "sync_failed"),
      ).toMatchObject({
        label: "Sync issue",
        tone: "warning",
        isConfirmedConnected: false,
      });

      // Fail-closed: if authorization block reports unverified, never show green Connected
      const unverifiedAuth: CommandCenterData = {
        ...data,
        integration: {
          ...data.integration!,
          overall_status: "connected",
          authorization: {
            ...data.integration!.authorization,
            verified: false,
            valid: false,
          },
        },
      };
      expect(resolveWelcomeConnectionStatus(unverifiedAuth, false, null)).toMatchObject({
        label: "Reconnect required",
        tone: "negative",
        isConfirmedConnected: false,
      });
    });

    it("renders loading skeleton for store identity while initial request is in flight", () => {
      renderWelcome({ data: null, loading: true });
      expect(screen.getByText("Checking connection")).toBeInTheDocument();
      expect(screen.getByText("Loading connected store details")).toBeInTheDocument();
      expect(screen.getByText("Checking synchronization status…")).toBeInTheDocument();
    });
  });

  describe("3. Last Successful Synchronization", () => {
    it("displays human-friendly relative time from last successful sync, not last attempted sync", () => {
      const now = new Date("2026-11-08T15:00:00Z");
      const base = connectedStoreFixture();
      // Attempted 10 seconds ago, but last SUCCESS was 2 minutes ago!
      const data: CommandCenterData = {
        ...base,
        retrieved_at: "2026-11-08T15:00:00Z",
        integration: {
          ...base.integration!,
          synchronization: {
            ...base.integration!.synchronization,
            last_succeeded_at: "2026-11-08T14:58:00Z",
          },
          store: {
            ...base.integration!.store,
            last_synced_at: "2026-11-08T14:58:00Z",
          },
        },
        evidence: {
          ...base.evidence,
          last_successful_sync_at: "2026-11-08T14:58:00Z",
          resources: [
            {
              ...base.evidence.resources[0],
              last_success_at: "2026-11-08T14:58:00Z",
              last_attempt_at: "2026-11-08T14:59:50Z",
            },
          ],
        },
      };

      const resolved = resolveLastSynchronized(data, false, null, "America/New_York", now);
      expect(resolved.label).toBe("Last synchronized: 2 minutes ago");
      expect(resolved.timestamp).toBe("2026-11-08T14:58:00Z");
      expect(resolved.title).toContain("Individual data domains may update on separate schedules.");
    });

    it("communicates clearly when synchronization has never succeeded instead of inventing a timestamp", () => {
      const base = connectedStoreFixture();
      const neverSynced: CommandCenterData = {
        ...base,
        retrieved_at: "2026-11-08T15:00:00Z",
        integration: {
          ...base.integration!,
          overall_status: "sync_failed",
          store: { ...base.integration!.store, last_synced_at: null },
          synchronization: {
            state: "failed",
            running_domains: [],
            failed_domains: ["orders"],
            partial_domains: [],
            last_succeeded_at: null,
          },
        },
        evidence: {
          ...base.evidence,
          last_successful_sync_at: null,
          resources: [
            {
              ...base.evidence.resources[0],
              last_success_at: null,
              last_attempt_at: "2026-11-08T14:59:00Z",
            },
          ],
        },
      };

      const resolved = resolveLastSynchronized(
        neverSynced,
        false,
        null,
        "America/New_York",
        new Date("2026-11-08T15:00:00Z"),
      );
      expect(resolved.label).toBe("Last synchronized: Not yet synchronized");
      expect(resolved.state).toBe("never_synced");
      expect(resolved.timestamp).toBeNull();
    });

    it("shows unavailable state when data failed to load or timestamp is malformed", () => {
      const failed = resolveLastSynchronized(
        null,
        false,
        { kind: "network", retryAfterSeconds: null, backendMessage: null },
        "UTC",
      );
      expect(failed.label).toBe("Last synchronized: Unavailable");
      expect(failed.state).toBe("unavailable");

      const base = connectedStoreFixture();
      const malformed: CommandCenterData = {
        ...base,
        integration: {
          ...base.integration!,
          store: { ...base.integration!.store, last_synced_at: "not-a-date" },
          synchronization: {
            ...base.integration!.synchronization,
            last_succeeded_at: "not-a-date",
          },
        },
        evidence: {
          ...base.evidence,
          last_successful_sync_at: "not-a-date",
          resources: [],
        },
      };
      expect(resolveLastSynchronized(malformed, false, null, "UTC").label).toBe(
        "Last synchronized: Unavailable",
      );
    });
  });

  describe("4. Refresh Control", () => {
    it("prevents duplicate requests while refreshing and only confirms success after backend completion", () => {
      const onRefresh = vi.fn();
      const data = connectedStoreFixture();
      const { rerender } = render(
        <MemoryRouter initialEntries={["/dashboard/overview"]}>
          <CommandCenterWelcomeSection
            data={data}
            refreshing={false}
            failure={null}
            onRefresh={onRefresh}
          />
        </MemoryRouter>,
      );

      const refreshBtn = screen.getByRole("button", { name: "Refresh briefing" });
      fireEvent.click(refreshBtn);
      expect(onRefresh).toHaveBeenCalledTimes(1);
      // Must NOT claim "Refreshed" before backend finishes!
      expect(screen.queryByText("Refreshed")).not.toBeInTheDocument();

      // Transition into refreshing=true (button disabled, duplicate click ignored)
      rerender(
        <MemoryRouter initialEntries={["/dashboard/overview"]}>
          <CommandCenterWelcomeSection
            data={data}
            refreshing={true}
            failure={null}
            onRefresh={onRefresh}
          />
        </MemoryRouter>,
      );
      const pendingBtn = screen.getByRole("button", { name: "Refreshing…" });
      expect(pendingBtn).toBeDisabled();
      fireEvent.click(pendingBtn);
      expect(onRefresh).toHaveBeenCalledTimes(1);

      // Transition refreshing=false with no failure -> confirmed success feedback
      rerender(
        <MemoryRouter initialEntries={["/dashboard/overview"]}>
          <CommandCenterWelcomeSection
            data={data}
            refreshing={false}
            failure={null}
            onRefresh={onRefresh}
          />
        </MemoryRouter>,
      );
      expect(screen.getByText("Refreshed")).toBeInTheDocument();
    });

    it("surfaces error feedback when a manual refresh settles with a backend failure", () => {
      const onRefresh = vi.fn();
      const data = connectedStoreFixture();
      const { rerender } = render(
        <MemoryRouter initialEntries={["/dashboard/overview"]}>
          <CommandCenterWelcomeSection
            data={data}
            refreshing={false}
            failure={null}
            onRefresh={onRefresh}
          />
        </MemoryRouter>,
      );

      fireEvent.click(screen.getByRole("button", { name: "Refresh briefing" }));

      rerender(
        <MemoryRouter initialEntries={["/dashboard/overview"]}>
          <CommandCenterWelcomeSection
            data={data}
            refreshing={true}
            failure={null}
            onRefresh={onRefresh}
          />
        </MemoryRouter>,
      );

      rerender(
        <MemoryRouter initialEntries={["/dashboard/overview"]}>
          <CommandCenterWelcomeSection
            data={data}
            refreshing={false}
            failure={{ kind: "server_error", retryAfterSeconds: null, backendMessage: null }}
            onRefresh={onRefresh}
          />
        </MemoryRouter>,
      );

      expect(screen.getByText("Refresh failed")).toBeInTheDocument();
      expect(screen.queryByText("Refreshed")).not.toBeInTheDocument();
    });
  });

  describe("5. Accessibility", () => {
    it("has zero structural axe-core accessibility violations", async () => {
      const { container } = renderWelcome({
        userOverride: { full_name: "Splendor Benjamin", display_name: "Splendor" },
        nowOverride: new Date("2026-11-08T15:00:00Z"),
        onSelectStore: vi.fn(),
      });
      const result = await axe.run(container, {
        rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
      });
      expect(result.violations).toEqual([]);
    });
  });
});
