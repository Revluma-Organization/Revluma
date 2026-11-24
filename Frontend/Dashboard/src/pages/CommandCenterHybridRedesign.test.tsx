import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import axe from "axe-core";
import Overview from "./Overview";
import { api } from "@/lib/api";
import { StateBadge, type AppState } from "@/components/command-center/StateBadge";
import { cc, shell } from "@/components/command-center/tokens";
import { ccFixture, ccPriorityFixture, ccResource } from "@/test/commandCenterFixtures";
import type { CommandCenterData } from "@/components/command-center/types";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async (original) => ({
  ...(await original<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

const mockUser = vi.hoisted(() => ({
  current: { full_name: "Ada Lovelace", nickname: "Ada" } as {
    full_name?: string | null;
    nickname?: string | null;
  } | null,
}));

vi.mock("@/store/authStore", () => ({
  useAuthStore: (selector: (s: { user: typeof mockUser.current }) => unknown) =>
    selector({ user: mockUser.current }),
}));

function mockCommandCenterApi(data: CommandCenterData) {
  return vi.spyOn(api, "get").mockImplementation((() =>
    Promise.resolve({ ok: true, status: 200, data: { success: true, data } })) as typeof api.get);
}

async function renderOverview(data: CommandCenterData) {
  mockCommandCenterApi(data);
  const view = render(
    <MemoryRouter initialEntries={["/dashboard/overview"]}>
      <Overview />
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "Top priorities", level: 2 });
  return view;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  navigate.mockReset();
  mockUser.current = { full_name: "Ada Lovelace", nickname: "Ada" };
});

describe("Command Center — Premium Hybrid Redesign V1", () => {
  it("renders the exact four-section hierarchy: Welcome -> Top Priorities -> Operational Briefing -> Supporting Intelligence", async () => {
    const { container } = await renderOverview(ccPriorityFixture());

    const welcome = screen.getByRole("heading", { name: /^Good (morning|afternoon|evening), Ada\.$/, level: 1 });
    const priorities = screen.getByRole("heading", { name: "Top priorities", level: 2 });
    const briefing = screen.getByRole("heading", {
      name: "There are developments in your store that deserve closer attention.",
      level: 2,
    });
    const supporting = screen.getByRole("heading", { name: "Supporting intelligence", level: 2 });

    expect(welcome.compareDocumentPosition(priorities) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(priorities.compareDocumentPosition(briefing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(briefing.compareDocumentPosition(supporting) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Supporting panels inside the Hybrid Operational Briefing right rail
    const evidenceHeading = screen.getByRole("heading", { name: "Evidence & data coverage", level: 3 });
    const healthHeading = screen.getByRole("heading", { name: "Operational data health", level: 3 });
    expect(briefing.compareDocumentPosition(evidenceHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(evidenceHeading.compareDocumentPosition(healthHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Hybrid 2-column layout marker present and no tables used
    expect(container.querySelector('[data-briefing-layout="hybrid"]')).toBeTruthy();
    expect(container.querySelectorAll("table")).toHaveLength(0);
  });

  it("renders the Welcome Experience with merchant name, supporting line, compact store row, sync time, and working Refresh", async () => {
    await renderOverview(ccFixture());

    expect(
      screen.getByRole("heading", { name: /^Good (morning|afternoon|evening), Ada\.$/, level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Here's what's happening across your business today."),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Connected store" })).toBeInTheDocument();
    expect(screen.getByText("revluma-test-store-v1.myshopify.com")).toBeInTheDocument();
    expect(screen.getByText(/^Last synchronized:/)).toBeInTheDocument();

    const refreshBtn = screen.getByRole("button", { name: "Refresh briefing" });
    fireEvent.click(refreshBtn);
    expect(api.get).toHaveBeenCalledWith("/rev/command-center", { signal: expect.any(AbortSignal) });
  });

  it("renders the Top Priorities empty state with exact required copy and a working Rev Intell navigation action", async () => {
    await renderOverview(ccFixture());

    expect(screen.getByRole("heading", { name: "Top priorities", level: 2 })).toBeInTheDocument();
    expect(
      screen.getByText("The most important issues identified across your store."),
    ).toBeInTheDocument();
    expect(screen.getByText("No verified priorities right now")).toBeInTheDocument();
    expect(
      screen.getByText(
        "No findings currently meet the evidence threshold. This doesn't mean there are no business problems. Further investigation may uncover issues.",
      ),
    ).toBeInTheDocument();

    const revIntellBtn = screen.getByRole("button", { name: /Explore with Rev Intell/i });
    fireEvent.click(revIntellBtn);
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining("/dashboard/rev-intell"));
  });

  it("renders populated Top Priorities immediately after Welcome with verified evidence, read-only recommendation, and Rev handoff", async () => {
    const { container } = await renderOverview(ccPriorityFixture());
    const prioritiesSection = container.querySelector("#priority-finding") as HTMLElement;
    expect(prioritiesSection).toBeTruthy();

    expect(within(prioritiesSection).getByText("#1")).toBeInTheDocument();
    expect(within(prioritiesSection).getByText("Verified finding")).toBeInTheDocument();
    expect(
      within(prioritiesSection).getByRole("heading", { name: "Net sales declined", level: 3 }),
    ).toBeInTheDocument();
    expect(within(prioritiesSection).getByText("$650.00")).toBeInTheDocument();
    expect(
      within(prioritiesSection).getByText(/merchant action, not executed by Revluma/),
    ).toBeInTheDocument();

    fireEvent.click(
      within(prioritiesSection).getByRole("button", { name: /Investigate in Rev Intelligence/i }),
    );
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining("/dashboard/rev-intell?finding=finding-1"));
  });

  it("visually and semantically distinguishes all six canonical application states", () => {
    const states: AppState[] = ["current", "updating", "stale", "unavailable", "empty", "partial"];
    const { container } = render(
      <div>
        {states.map((state) => (
          <StateBadge key={state} state={state} />
        ))}
      </div>,
    );

    const badges = states.map((state) => container.querySelector(`[data-app-state="${state}"]`));
    for (const badge of badges) {
      expect(badge).toBeTruthy();
      expect(badge?.textContent?.trim().length).toBeGreaterThan(0);
    }

    // Every state must have distinct label text so meaning never depends solely on color
    const labels = new Set(badges.map((b) => b?.textContent?.trim()));
    expect(labels.size).toBe(6);
  });

  it("never uses a single green status to imply full data health when inventory coverage is unauthorized", async () => {
    const limited = ccResource({
      resource: "inventory.levels",
      label: "inventory levels",
      availability: "unauthorized",
      reason: "The required Shopify inventory permission is not granted.",
      coverage: "unknown",
    });
    await renderOverview(
      ccFixture({
        integration: {
          overall_status: "connected",
          status_explanation: "Shopify integration is connected.",
          authorization: { verified: true },
        },
        evidence: {
          ...ccFixture().evidence,
          resources: [ccResource(), limited] as CommandCenterData["evidence"]["resources"],
        },
      }),
    );

    // Store connection can be Connected while Evidence & data coverage explicitly surfaces Partial coverage + Limited access
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("Partial coverage")).toBeInTheDocument();
    expect(screen.getAllByText("Limited access").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("The required Shopify inventory permission is not granted.").length,
    ).toBeGreaterThan(0);
  });

  it("shows All sources verified (not Partial coverage) on the evidence card when every source is verified, and explains quiet/unverified webhooks in Operational data health", async () => {
    const webhookNote =
      "Webhooks are registered but no event was observed in the last seven days; this can mean either a quiet store or that events are not arriving.";
    await renderOverview(
      ccFixture({
        integration: {
          overall_status: "limited_access",
          status_reason: "limited_capabilities",
          status_explanation:
            "Store is connected with limited capabilities until webhook delivery is verified.",
          authorization: { verified: true },
          webhooks: {
            state: "unknown",
            note: webhookNote,
          },
        },
        evidence: {
          ...ccFixture().evidence,
          resources: [
            ccResource({ resource: "orders", label: "orders", availability: "available" }),
            ccResource({ resource: "products", label: "products", availability: "available" }),
          ] as CommandCenterData["evidence"]["resources"],
        },
      }),
    );

    const evidencePanel = document.getElementById("evidence-heading-panel");
    expect(evidencePanel).toBeTruthy();
    expect(evidencePanel?.textContent).toContain("2 of 2 sources verified");
    expect(evidencePanel?.textContent).toContain("All sources verified");
    expect(evidencePanel?.textContent).not.toContain("Partial coverage");

    // Operational data health still honestly shows Limited access and the webhook explanation
    expect(screen.getAllByText("Limited access").length).toBeGreaterThan(0);
    expect(screen.getByText(webhookNote)).toBeInTheDocument();
  });

  it("enforces the Premium Hybrid V1 palette, typography, and layout tokens", () => {
    expect(shell.sidebar).toContain("#111318");
    expect(shell.workspace).toContain("#F4F5F8");
    expect(cc.surface).toContain("bg-white");
    expect(cc.surface).toContain("border-[#E7E9EF]");
    expect(cc.surface).not.toContain("shadow");
    expect(cc.page).toContain("max-w-[1400px]");
    expect(cc.primary).toContain("#4438E8");
    expect(cc.muted).toContain("#707582");
    expect(cc.title).toContain("#17191F");
  });

  it("passes automated axe-core structural accessibility checks across the full redesigned Overview page", async () => {
    const { container } = await renderOverview(ccPriorityFixture());
    const result = await axe.run(container, {
      rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
    });
    expect(result.violations).toEqual([]);
  });
});
