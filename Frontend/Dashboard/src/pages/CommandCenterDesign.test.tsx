import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import axe from "axe-core";
import {
  CommandCenterHeader, EvidenceFreshness, HealthIndicators, OperationalActivity,
  OperationalBriefing, PriorityFindings,
} from "@/components/command-center/CommandCenterSections";
import { cc } from "@/components/command-center/tokens";
import { ccFixture, ccMetric, ccPriorityFixture, ccResource } from "@/test/commandCenterFixtures";
import type { CommandCenterData } from "@/components/command-center/types";
import { businessHealthFixture, operationalActivityFixture } from "@/test/businessHealthFixtures";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async original => ({ ...await original<typeof import("react-router-dom")>(), useNavigate: () => navigate }));
const router = (children: React.ReactNode) => <MemoryRouter>{children}</MemoryRouter>;
const health = (data: CommandCenterData) => render(<HealthIndicators data={data} />);
const priority = (data: CommandCenterData) => render(router(<PriorityFindings data={data} />));
const resources = (states: Record<string, string>) => Object.entries(states).map(([resource, availability]) => ccResource({ resource, label: resource, availability })) as CommandCenterData["evidence"]["resources"];
const integration = (overall_status: string) => ({ overall_status, status_explanation: `Integration is ${overall_status}.`, authorization: { verified: false } }) as CommandCenterData["integration"];

afterEach(() => { cleanup(); navigate.mockReset(); });

describe("Task 219 scenarios A–J and authoritative hierarchy", () => {
  it("A: renders briefing, one priority, five domains, activity and readiness", () => {
    const data = { ...ccPriorityFixture(), activity: [{ id: "a1", kind: "business" as const, type: "revenue_change", finding_id: "finding-1", label: "Net sales declined", occurred_at: "2026-11-08T10:00:00Z", note: "Verified finding." }] };
    const { container } = render(router(<><OperationalBriefing data={data} /><PriorityFindings data={data} /><HealthIndicators data={data} /><OperationalActivity data={data} /><EvidenceFreshness data={data} /></>));
    expect(container.querySelectorAll("[data-health-domain]")).toHaveLength(5);
    expect(screen.getAllByRole("heading", { name: "Net sales declined" })).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Operational activity" })).toBeInTheDocument();
  });
  it("B: a new merchant sees unavailable values, not sample business data", () => {
    health(ccFixture({ metrics: [ccMetric({ value: null, availability: "not_synchronized" }) as CommandCenterData["metrics"][number]], evidence: { ...ccFixture().evidence, resources: resources({ orders: "not_synchronized" }) } }));
    expect(screen.queryByText("$1,250.00")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
  it("C: partial order evidence stays visible beside unsupported inventory", () => {
    health(ccFixture({ evidence: { ...ccFixture().evidence, resources: resources({ orders: "partial", "inventory.levels": "unsupported" }) } }));
    expect(screen.getByText("Coverage complete")).toBeInTheDocument();
    expect(screen.getAllByText("Unsupported").length).toBeGreaterThan(0);
  });
  it("D: a critical finding has stronger emphasis than health indicators", () => {
    const { container } = priority(ccPriorityFixture({ severity: "critical" }));
    expect(container.querySelector("article")?.className).toContain("border-l-[#b42318]");
    expect(screen.getByRole("heading", { name: "Net sales declined", level: 3 })).toBeInTheDocument();
  });
  it("E: no defensible priority is informative and not a healthy-store claim", () => {
    priority(ccFixture());
    expect(screen.getByText(/No sufficiently supported priority/)).toBeInTheDocument();
    expect(screen.queryByText(/everything is healthy/i)).not.toBeInTheDocument();
  });
  it("F: integration failure and stale evidence remain distinct", () => {
    health(ccFixture({ integration: integration("sync_failed"), business_state: { ...ccFixture().business_state, presentation_status: "stale", stale: true } }));
    expect(screen.getAllByText(/Integration is sync_failed/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Last sync/)).toBeInTheDocument();
  });
  it("G: genuine activity preserves its investigation path", () => {
    render(router(<OperationalActivity data={ccFixture({ activity: [{ id: "f1", kind: "business", type: "revenue_change", finding_id: "a/b", label: "Recorded change", occurred_at: "2026-11-08T10:00:00Z", note: "Verified finding." }] })} />));
    fireEvent.click(screen.getByRole("button", { name: /Investigate event/ }));
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining("/dashboard/rev-intell?finding=a%2Fb"));
  });
  it("H: no activity has an explicit empty state and no fake event", () => {
    render(<OperationalActivity data={ccFixture()} />);
    expect(screen.getByText("No operational activity to show")).toBeInTheDocument();
    expect(screen.getByText(/No placeholder events/)).toBeInTheDocument();
  });
  it("I: health uses a single-column base and responsive multi-column breakpoints", () => {
    const { container } = health(ccFixture());
    expect(container.querySelector("dl")?.className).toContain("grid");
    expect(container.querySelector("dl")?.className).toContain("sm:grid-cols-2");
    expect(container.querySelector("dl")?.className).toContain("xl:grid-cols-5");
  });
  it("J: all primary actions use the same tokenized behavior", () => {
    expect(cc.primary).toContain("min-h-11");
    expect(cc.primary).toContain("focus-visible:ring-2");
    expect(cc.secondary).toContain("min-h-11");
  });
});

describe("Task 219 consolidated Task 218 contracts", () => {
  it("binds the canonical five indicators, order counts and independent data quality without duplicate panels", () => {
    const { container } = health(ccFixture({ business_health: businessHealthFixture() }));
    expect(container.querySelectorAll("[data-health-domain]")).toHaveLength(5);
    expect(screen.getByText("312 orders")).toBeInTheDocument();
    expect(screen.getAllByText("Complete data")).toHaveLength(5);
    expect(screen.getAllByText("Healthy")).toHaveLength(5);
    expect(screen.getByText(/Business severity and data quality are independent/)).toBeInTheDocument();
  });
  it("withholds a monetary scalar when canonical currency is absent", () => {
    const fixture = businessHealthFixture();
    fixture.indicators[0] = { ...fixture.indicators[0], value: 100, currency: null, status: "insufficient_history", data_quality: "unknown" };
    health(ccFixture({ business_health: fixture }));
    expect(screen.queryByText("$100.00")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
  it("canonical activity retains exact finding IDs and only working integration destinations", () => {
    render(router(<OperationalActivity data={ccFixture({ operational_activity: operationalActivityFixture({ items: [{ event_id: "finding:abc", type: "finding", category: "finding", severity: "warning", title: "Recorded change", detail: "finding type: revenue_change", status: "open", occurred_at: "2026-11-08T10:00:00Z", received_at: "2026-11-08T10:00:01Z", source: "intelligence_findings", finding_id: "a/b", link: "/findings" }], total: 1, returned: 1 }) })} />));
    fireEvent.click(screen.getByRole("button", { name: /Investigate event/ }));
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining("/dashboard/rev-intell?finding=a%2Fb"));
  });
  it("an empty canonical window is not a claim that nothing happened", () => {
    render(<OperationalActivity data={ccFixture({ operational_activity: operationalActivityFixture({ items: [], total: 0, returned: 0 }) })} />);
    expect(screen.getByText(/unavailable source evidence; it does not prove that nothing happened/)).toBeInTheDocument();
  });
});

describe("Task 219 health-domain data binding", () => {
  for (const domain of ["revenue", "orders", "checkouts", "product-availability", "integration"]) {
    it(`renders the ${domain} domain exactly once`, () => {
      const { container } = health(ccFixture());
      expect(container.querySelectorAll(`[data-health-domain="${domain}"]`)).toHaveLength(1);
    });
  }
  it("revenue uses the API money value and ISO currency", () => {
    health(ccFixture());
    expect(screen.getByText("$1,250.00")).toBeInTheDocument();
    expect(screen.getByText(/USD/)).toBeInTheDocument();
  });
  it("revenue comparison uses the recorded percent, not a derived browser trend", () => {
    health(ccFixture());
    expect(screen.getByText(/-12\.5%/)).toBeInTheDocument();
  });
  it("checkouts use the recorded count and 48-hour definition", () => {
    health(ccFixture());
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText(/last 48 hours/)).toBeInTheDocument();
  });
  it("orders communicate coverage without inventing an order count", () => {
    health(ccFixture());
    expect(screen.getByText("Coverage complete")).toBeInTheDocument();
    expect(screen.queryByText(/order count:/i)).not.toBeInTheDocument();
  });
  it("inventory quantities are never inferred from availability", () => {
    health(ccFixture());
    expect(screen.queryByText(/\d+ in stock/i)).not.toBeInTheDocument();
  });
  it("integration uses the canonical state explanation", () => {
    health(ccFixture({ integration: integration("needs_attention") }));
    expect(screen.getByText("Integration is needs_attention.")).toBeInTheDocument();
  });
  it("missing metrics render an em dash rather than zero", () => {
    health(ccFixture({ metrics: [] }));
    expect(screen.getAllByText("—")).toHaveLength(2);
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });
  it("verified zero remains a meaningful value", () => {
    health(ccFixture({ metrics: [ccMetric({ value: 0, zero_semantics: "verified_zero" }) as CommandCenterData["metrics"][number]] }));
    expect(screen.getByText("$0.00")).toBeInTheDocument();
  });
  it("unverified zero is withheld", () => {
    health(ccFixture({ metrics: [ccMetric({ value: 0, zero_semantics: "unverified_zero_withheld" }) as CommandCenterData["metrics"][number]] }));
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });
  it("stale revenue retains its historical value with a stale label", () => {
    health(ccFixture({ metrics: [ccMetric({ availability: "stale", availability_reason: "Historical value." }) as CommandCenterData["metrics"][number]] }));
    expect(screen.getByText("$1,250.00")).toBeInTheDocument();
    expect(screen.getAllByText("Stale").length).toBeGreaterThan(0);
  });
  it("missing currency never produces a monetary scalar", () => {
    health(ccFixture({ metrics: [ccMetric({ value: null, currency: null, availability: "unknown" }) as CommandCenterData["metrics"][number]] }));
    expect(screen.queryByText(/1250/)).not.toBeInTheDocument();
  });
});

describe("Task 219 finding, activity and readiness governance", () => {
  it("briefing links to the single priority instead of repeating its investigation", () => {
    render(router(<OperationalBriefing data={ccPriorityFixture()} />));
    expect(screen.getByRole("link", { name: /Review priority/ })).toHaveAttribute("href", "#priority-finding");
    expect(screen.queryByRole("button", { name: /Investigate this finding/ })).not.toBeInTheDocument();
  });
  it("priority description appears once", () => {
    priority(ccPriorityFixture());
    expect(screen.getAllByText(/Recorded net sales declined/)).toHaveLength(1);
  });
  it("priority and confidence have separate explanations", () => {
    priority(ccPriorityFixture());
    expect(screen.getByRole("heading", { name: "Why this is the priority" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Confidence" })).toBeInTheDocument();
  });
  it("no numerical confidence or priority score is shown", () => {
    priority(ccPriorityFixture());
    expect(screen.queryByText(/priority score|\d+% confidence/i)).not.toBeInTheDocument();
  });
  it("supporting evidence preserves currency and period", () => {
    priority(ccPriorityFixture());
    expect(screen.getByText("$650.00")).toBeInTheDocument();
    expect(screen.getByText(/equal length utc windows · UTC/)).toBeInTheDocument();
  });
  it("recommendation is read-only and merchant executable", () => {
    priority(ccPriorityFixture());
    expect(screen.getByText(/merchant action, not executed by Revluma/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /execute|apply|launch/i })).not.toBeInTheDocument();
  });
  it("finding limitations remain adjacent to the conclusion", () => {
    priority(ccPriorityFixture());
    expect(screen.getByRole("heading", { name: "Limits of this conclusion" })).toBeInTheDocument();
  });
  it("provenance is hidden behind a keyboard-native disclosure", () => {
    priority(ccPriorityFixture());
    const summary = screen.getByText("Inspect evidence, provenance and uncertainty");
    expect(summary.tagName).toBe("SUMMARY");
    fireEvent.click(summary);
    expect(screen.getByText("finding-1")).toBeInTheDocument();
  });
  it("Rev navigation preserves the exact finding route", () => {
    priority(ccPriorityFixture());
    fireEvent.click(screen.getByRole("button", { name: /Investigate in Rev Intelligence/ }));
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining("/dashboard/rev-intell?finding=finding-1"));
  });
  it("excluded stale findings remain historical, not current headings", () => {
    priority(ccFixture({ priority_selection: { ...ccFixture().priority_selection, exclusions: [{ finding_id: "old", title: "Old issue", reason: "stale_unreverified" }] } }));
    expect(screen.getByText(/not current: stale unreverified/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Old issue" })).not.toBeInTheDocument();
  });
  it("system events are not called merchant actions", () => {
    render(<OperationalActivity data={ccFixture({ activity: [{ id: "s1", kind: "system", type: "synchronization_completed", label: "Synchronization completed", occurred_at: "2026-11-08T10:00:00Z", note: "System activity; not a merchant action." }] })} />);
    expect(screen.getByText("system", { exact: true })).toBeInTheDocument();
    expect(screen.getByText(/not a merchant action/)).toBeInTheDocument();
  });
  it("activity chronology comes from the authoritative ordered response", () => {
    const { container } = render(<OperationalActivity data={ccFixture({ activity: [{ id: "2", kind: "system", type: "sync", label: "Later", occurred_at: "2026-11-08T11:00:00Z", note: "Second." }, { id: "1", kind: "system", type: "sync", label: "Earlier", occurred_at: "2026-11-08T10:00:00Z", note: "First." }] })} />);
    const items = container.querySelectorAll("li");
    expect(within(items[0]).getByText("Later")).toBeInTheDocument();
    expect(within(items[1]).getByText("Earlier")).toBeInTheDocument();
  });
  it("readiness lists material limitations before detailed references", () => {
    render(<EvidenceFreshness data={ccFixture({ evidence: { ...ccFixture().evidence, resources: resources({ "inventory.levels": "unauthorized" }) } })} />);
    expect(screen.getByText(/inventory.levels:/)).toBeInTheDocument();
    expect(screen.getByText("1 limited")).toBeInTheDocument();
  });
  it("readiness disclosure exposes source-specific last success", () => {
    render(<EvidenceFreshness data={ccFixture()} />);
    fireEvent.click(screen.getByText("Review resource freshness and coverage"));
    expect(screen.getAllByText(/Last success/).length).toBeGreaterThan(0);
  });
  it("stale snapshot warning distinguishes historical from current performance", () => {
    render(<EvidenceFreshness data={ccFixture({ business_state: { ...ccFixture().business_state, stale: true, presentation_status: "stale" } })} />);
    expect(screen.getByRole("status")).toHaveTextContent(/not current performance/);
  });
  it("unknown semantics remain visible inside evidence disclosure", () => {
    render(<EvidenceFreshness data={ccFixture()} />);
    fireEvent.click(screen.getByText("Review resource freshness and coverage"));
    expect(screen.getByText(/Null is unavailable, never zero/)).toBeInTheDocument();
  });
});

describe("Task 219 tokens, controls and responsive viewport contracts", () => {
  it("centralizes brand blue at the established #1F06AC", () => { expect(cc.primary).toContain("#1F06AC"); });
  it("uses green only for meaningful positive status", () => { expect(cc.positive).toBe("text-[#067647]"); });
  it("uses red only for meaningful negative status", () => { expect(cc.negative).toBe("text-[#b42318]"); });
  it("uses one restrained surface treatment", () => { expect(cc.surface).toContain("rounded-xl"); expect(cc.surface).not.toContain("shadow"); });
  it("uses one body text color and line height", () => { expect(cc.body).toBe("text-sm leading-6 text-[#344054]"); });
  it("uses a bounded content width", () => { expect(cc.page).toContain("max-w-[1320px]"); expect(cc.page).toContain("overflow-x-clip"); });
  it("refresh exposes pending state and disables duplicate submission", () => {
    render(<CommandCenterHeader data={ccFixture()} refreshing onRefresh={() => {}} />);
    expect(screen.getByRole("button", { name: "Refreshing…" })).toBeDisabled();
  });
  it("refresh uses an explicit accessible name", () => {
    render(<CommandCenterHeader data={ccFixture()} refreshing={false} onRefresh={() => {}} />);
    expect(screen.getByRole("button", { name: "Refresh briefing" })).toBeInTheDocument();
  });
  it("header retains store and UTC context", () => {
    render(<CommandCenterHeader data={ccFixture()} refreshing={false} onRefresh={() => {}} />);
    expect(screen.getByText(/revluma-test-store-v1/)).toBeInTheDocument();
    expect(screen.getByText(/Today & yesterday · UTC/)).toBeInTheDocument();
  });
  it("reduced motion is honored by loading and refresh animations", () => {
    render(<CommandCenterHeader data={ccFixture()} refreshing onRefresh={() => {}} />);
    expect(document.querySelector(".motion-reduce\\:animate-none")).toBeInTheDocument();
  });

  for (const width of [320, 375, 430, 768, 1024, 1280, 1440, 1920]) {
    it(`viewport ${width}px keeps five domains in a non-table wrapping grid`, () => {
      window.innerWidth = width;
      const { container } = health(ccFixture());
      expect(container.querySelectorAll("table")).toHaveLength(0);
      expect(container.querySelector("dl")?.className).toContain("grid");
      expect(container.querySelectorAll("[data-health-domain]")).toHaveLength(5);
      for (const item of container.querySelectorAll("[data-health-domain]")) expect(item.className).toContain("min-w-0");
    });
  }

  it("has no headings that skip from page title to card level", () => {
    render(router(<><OperationalBriefing data={ccFixture()} /><PriorityFindings data={ccFixture()} /><HealthIndicators data={ccFixture()} /></>));
    expect(screen.getAllByRole("heading", { level: 2 }).length).toBe(3);
  });
  it("status meaning is conveyed by text as well as icon/color", () => {
    health(ccFixture());
    expect(screen.getAllByText("Available").length).toBeGreaterThan(0);
  });
  it("disclosures use native summary elements", () => {
    render(<EvidenceFreshness data={ccFixture()} />);
    expect(screen.getByText("Review resource freshness and coverage").tagName).toBe("SUMMARY");
  });
});

describe("Task 219 automated accessibility checks", () => {
  async function expectAccessible(node: HTMLElement) {
    const result = await axe.run(node, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(result.violations).toEqual([]);
  }
  it("populated health and activity have no detectable structural axe violations", async () => {
    const { container } = render(<><HealthIndicators data={ccFixture()} /><OperationalActivity data={ccFixture()} /></>);
    await expectAccessible(container);
  });
  it("canonical Task 218 health and activity have no detectable structural axe violations", async () => {
    const data = ccFixture({ business_health: businessHealthFixture(), operational_activity: operationalActivityFixture() });
    const { container } = render(<><HealthIndicators data={data} /><OperationalActivity data={data} /></>);
    await expectAccessible(container);
  });
  it("priority finding has no detectable structural axe violations", async () => {
    const { container } = render(router(<PriorityFindings data={ccPriorityFixture()} />));
    await expectAccessible(container);
  });
  it("readiness disclosure has no detectable structural axe violations", async () => {
    const { container } = render(<EvidenceFreshness data={ccFixture()} />);
    await expectAccessible(container);
  });
});
