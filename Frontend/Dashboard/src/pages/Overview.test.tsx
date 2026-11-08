import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { api } from "@/lib/api";
import Overview from "./Overview";
import type { CommandCenterData } from "@/components/command-center/types";
import { businessHealthFixture, operationalActivityFixture } from "@/components/dashboard/businessHealthFixtures";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async importOriginal => ({ ...await importOriginal<typeof import("react-router-dom")>(), useNavigate: () => navigate }));

const metric = (extra = {}) => ({ id: "net_sales_today", label: "Net sales today", value: 18420, unit: "money", currency: "USD", definition: "Order totals net of refunds.", availability: "available", availability_reason: null, reporting_period: { timezone: "UTC" }, zero_semantics: null, ...extra });
const finding = (extra: Record<string, unknown> = {}) => ({
  contract_version: "command-center-priority-finding-v1", id: "finding-1", organization_id: "merchant-a", store_id: "store-1", category: "business_performance", type: "revenue_change", severity: "high",
  title: "Net sales declined", description: "Recorded net sales declined between comparable periods; the cause is not established.",
  priority: { method_version: "finding-priority-v1", classification: "high", rationale: ["Recorded severity: high.", "Evidence freshness: fresh.", "Only verified findings are eligible."], tie: null },
  reporting_period: { kind: "equal_length_utc_windows", timezone: "UTC", start: "2026-10-25T00:00:00Z", end: "2026-11-08T00:00:00Z", current_start: "2026-11-01T00:00:00Z", current_end: "2026-11-08T00:00:00Z", comparison_start: "2026-10-25T00:00:00Z", comparison_end: "2026-11-01T00:00:00Z" },
  detected_at: "2026-11-08T10:00:00Z", last_verified_at: "2026-11-08T11:00:00Z",
  evidence_freshness: { state: "fresh", as_of: "2026-11-08T11:00:00Z", observed_at: "2026-11-08T00:00:00Z", age_seconds: 3600, reason: null },
  coverage: { state: "complete", complete: true, source: "shopify_verified_history_v1", run_id: "coverage-run-1" },
  confidence: { classification: "high", rationale: ["Verified source evidence with certified comparison coverage.", "Evidence freshness is fresh."], numerical_score: null },
  limitations: ["The observed change does not establish its underlying cause."], unknowns: ["The underlying cause is not established."],
  lifecycle: { state: "open", current_validity: "current_evidence_verified", invalidated: false },
  evidence: { classification: "verified_observation", source: "orders", observations: [
    { label: "Current net sales", value: 650, unit: "money", currency: "USD", period: "current", availability: "available" },
    { label: "Previous net sales", value: 1000, unit: "money", currency: "USD", period: "comparison", availability: "available" },
  ], references: [{ id: "finding:finding-1", source_type: "intelligence_findings", source_record_id: "finding-1" }, { id: "order-coverage:coverage-run-1", source_type: "shopify_verified_history_v1", source_record_id: "coverage-run-1" }], duplicate_finding_ids: [] },
  recommendation: { available: true, step: "Compare order count and average order value for both periods, then review products with the largest verified change.", rationale: "The observed movement identifies where to investigate, not its cause.", expected_result: "Identify whether the change is concentrated in particular records.", validation_method: "Repeat the comparison over an equivalent period.", prerequisites: [], lifecycle_state: "presented", read_only: true, executed: false },
  investigation: { finding_id: "finding-1", route: "/dashboard/rev-intell?finding=finding-1", context_contract: "rev-selected-finding-v1", revalidate_on_open: true }, read_only: true,
  next_step: { label: "Investigate with Rev", route: "/dashboard/rev-intell?finding=finding-1" }, ...extra,
});
const resource = (extra = {}) => ({ store_id: "store-1", resource: "orders", label: "orders", availability: "available", reason: null, freshness: "fresh", last_success_at: "2026-11-08T11:50:00Z", last_attempt_at: "2026-11-08T11:50:00Z", sync_state: "succeeded", limitations: [], coverage: "complete", ...extra });
const fixture = (extra: Partial<CommandCenterData> = {}): CommandCenterData => ({
  contract_version: "command-center-v1", read_only: true, retrieved_at: "2026-11-08T12:00:00Z",
  context: { organization_id: "merchant-a", store: { id: "store-1", name: "revluma-test-store-v1.myshopify.com", platform: "shopify" }, currency: "USD", reporting_period: { kind: "current_and_previous_utc_day", timezone: "UTC", note: "UTC snapshot" }, comparison_period: { kind: "previous_utc_day", comparability: "same_metric_definition" } },
  business_state: { id: "state-1", version: "1.1", generated_at: "2026-11-08T11:55:00Z", data_freshness_at: "2026-11-08T11:50:00Z", computation_status: "complete", presentation_status: "current", stale: false, warnings: [] },
  integration: null,
  briefing: { headline: "Your latest synchronized business picture", summary: "The current UTC-day snapshot is available.", tone: "default", observation: null, implication: null, evidence_quality: "complete_snapshot", no_findings_note: "No open verified priority findings are recorded. This is not proof that no issue exists.", limitations: [], next_investigation: { kind: "explore_evidence", finding_id: null, label: "Explore the evidence with Rev", reason: "Investigate available order and checkout evidence.", route: "/dashboard/rev-intell" } },
  metrics: [metric() as CommandCenterData["metrics"][number]], findings: [], activity: [],
  priority_finding: null,
  priority_selection: { method_version: "finding-priority-v1", eligible_count: 0, tie: null, exclusions: [], no_defensible_priority: true, reason: "No open verified findings are recorded." },
  evidence: { overall: "current", snapshot_generated_at: "2026-11-08T11:55:00Z", source_data_at: "2026-11-08T11:50:00Z", last_successful_sync_at: "2026-11-08T11:50:00Z", resources: [resource() as CommandCenterData["evidence"]["resources"][number]], limitations: [], unknown_semantics: "Null is never zero." },
  ...extra,
});
// Task 218 — the page-level mock must answer the store-scoped Task 218 routes
// with contract-shaped payloads; every other route (the authoritative
// /rev/command-center) keeps returning the briefing fixture.
function mockApi(data: CommandCenterData) {
  vi.spyOn(api, "get").mockImplementation(((path: string) => {
    if (path.endsWith("/business-health")) return Promise.resolve({ ok: true, status: 200, data: { success: true, data: businessHealthFixture() } });
    if (path.endsWith("/business-activity")) return Promise.resolve({ ok: true, status: 200, data: { success: true, data: operationalActivityFixture() } });
    return Promise.resolve({ ok: true, status: 200, data: { success: true, data } });
  }) as typeof api.get);
}
async function renderPage(data: CommandCenterData) { mockApi(data); render(<MemoryRouter><Overview /></MemoryRouter>); await screen.findByText("Operational briefing"); }

describe("Task 216 Command Center", () => {
  afterEach(() => { vi.restoreAllMocks(); navigate.mockReset(); });

  it("places the operational briefing before supporting business sections", async () => {
    await renderPage(fixture());
    const briefing = screen.getByRole("heading", { name: "Your latest synchronized business picture" });
    const business = screen.getByRole("heading", { name: "Business situation" });
    expect(briefing.compareDocumentPosition(business) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("revluma-test-store-v1.myshopify.com")).toBeInTheDocument();
    expect(screen.getByText("Today & yesterday · UTC")).toBeInTheDocument();
  });

  it("healthy sufficient evidence stays calm and has no promotional cards", async () => {
    await renderPage(fixture());
    expect(screen.getByRole("heading", { name: "Your latest synchronized business picture" })).toBeInTheDocument();
    expect(screen.queryByText(/Execution intelligence/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Evidence-backed intelligence/i)).not.toBeInTheDocument();
  });

  it("verified revenue deterioration receives primary emphasis", async () => {
    await renderPage(fixture({ briefing: { ...fixture().briefing, headline: "Net sales declined", summary: "Recorded sales declined; the cause is not established.", tone: "attention", observation: "The evidence establishes the observation, not its cause." }, findings: [finding() as CommandCenterData["findings"][number]] }));
    expect(screen.getByRole("heading", { name: "Net sales declined", level: 2 })).toBeInTheDocument();
    expect(screen.getAllByText(/cause is not established|not its cause/).length).toBeGreaterThan(0);
  });

  it("inventory authorization failure is local and never zero stock", async () => {
    const limited = resource({ resource: "inventory.levels", label: "inventory levels", availability: "unauthorized", reason: "The required Shopify permission is unavailable.", coverage: "unknown" });
    await renderPage(fixture({ evidence: { ...fixture().evidence, resources: [resource() as CommandCenterData["evidence"]["resources"][number], limited as CommandCenterData["evidence"]["resources"][number]] } }));
    fireEvent.click(screen.getByText("Review resource freshness and coverage"));
    expect(screen.getByText("Limited access")).toBeInTheDocument();
    expect(screen.getByText("The required Shopify permission is unavailable.")).toBeInTheDocument();
    expect(screen.queryByText(/zero inventory|0 in stock/i)).not.toBeInTheDocument();
  });

  it("stale evidence is labelled and dated rather than presented as current", async () => {
    await renderPage(fixture({ business_state: { ...fixture().business_state, presentation_status: "stale", stale: true }, metrics: [metric({ availability: "stale", availability_reason: "Historical value, not current performance." }) as CommandCenterData["metrics"][number]] }));
    expect(screen.getAllByText("Stale").length).toBeGreaterThan(0);
    expect(screen.getByText(/Historical evidence remains available; it is not current performance/)).toBeInTheDocument();
  });

  it("new merchant synchronization does not fabricate comparisons", async () => {
    await renderPage(fixture({ briefing: { ...fixture().briefing, headline: "Revluma is preparing your first business overview", summary: "Comparisons remain limited until the required history is available." }, metrics: [metric({ value: null, availability: "not_synchronized", availability_reason: "Orders have not synchronized." }) as CommandCenterData["metrics"][number]] }));
    expect(screen.getByRole("heading", { name: "Revluma is preparing your first business overview" })).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("$18,420.00")).not.toBeInTheDocument();
  });

  it("no findings language is bounded by evidence and detector scope", async () => {
    await renderPage(fixture());
    expect(screen.getByText(/not proof that the store has no problems/)).toBeInTheDocument();
    expect(screen.queryByText(/Everything is healthy/i)).not.toBeInTheDocument();
  });

  it("unknown contradictory financial evidence remains unavailable", async () => {
    await renderPage(fixture({ metrics: [metric({ value: null, currency: null, availability: "unknown", availability_reason: "Conflicting currencies cannot be reconciled." }) as CommandCenterData["metrics"][number]] }));
    expect(screen.getByText("Unknown")).toBeInTheDocument();
    expect(screen.getByText("Conflicting currencies cannot be reconciled.")).toBeInTheDocument();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("partial and failed generation states remain visible", async () => {
    await renderPage(fixture({ business_state: { ...fixture().business_state, presentation_status: "partial", computation_status: "partial" }, briefing: { ...fixture().briefing, headline: "A partial operational picture is available" } }));
    expect(screen.getByText("Evidence partial")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "A partial operational picture is available" })).toBeInTheDocument();
  });

  it("finding navigation preserves the selected finding id", async () => {
    await renderPage(fixture({ findings: [finding({ id: "abc/def", investigation: { finding_id: "abc/def", route: "/dashboard/rev-intell?finding=abc%2Fdef", context_contract: "rev-selected-finding-v1", revalidate_on_open: true }, next_step: { label: "Investigate", route: "/dashboard/rev-intell?finding=abc%2Fdef" } }) as CommandCenterData["findings"][number]] }));
    fireEvent.click(screen.getByRole("button", { name: "Investigate" }));
    expect(navigate).toHaveBeenCalledWith("/dashboard/rev-intell?finding=abc%2Fdef");
  });

  it("business metrics include definitions and currency context", async () => {
    await renderPage(fixture());
    expect(screen.getByText("$18,420.00")).toBeInTheDocument();
    expect(screen.getByText(/Current and previous UTC day · USD/)).toBeInTheDocument();
    expect(screen.getAllByText(/Order totals net of refunds/).length).toBeGreaterThan(0);
  });

  it("system activity is not presented as merchant action", async () => {
    await renderPage(fixture({ activity: [{ id: "sync", kind: "system", type: "synchronization_completed", label: "Shopify synchronization completed", occurred_at: "2026-11-08T11:50:00Z", note: "System activity; not a merchant action or business event." }] }));
    expect(screen.getByText("system", { exact: true })).toBeInTheDocument();
    expect(screen.getByText(/not a merchant action/)).toBeInTheDocument();
  });

  it("failed API response shows recovery and no fabricated disconnected store", async () => {
    // Task 220 — a plain network-level failure classifies as "network": the
    // classified merchant-facing message plus a retry, and no fabricated
    // disconnected-store state.
    vi.spyOn(api, "get").mockRejectedValue(new Error("unavailable"));
    render(<MemoryRouter><Overview /></MemoryRouter>);
    expect(await screen.findByRole("alert")).toHaveTextContent("The briefing could not be reached");
    expect(screen.getByRole("alert")).toHaveTextContent("A connection problem stopped this request");
    expect(screen.queryByText("Not connected")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("manual refresh reuses the same authoritative endpoint", async () => {
    await renderPage(fixture());
    fireEvent.click(screen.getByRole("button", { name: "Refresh briefing" }));
    // Task 218 note: the store-scoped panels each fetch once at mount, so the
    // total call count is no longer 2 — but the authoritative briefing
    // endpoint is still called exactly twice (initial + refresh) and remains
    // the endpoint the refresh action reuses.
    const calls = (api.get as unknown as { mock: { calls: [string, ...unknown[]][] } }).mock.calls;
    expect(calls.filter(([path]) => path === "/rev/command-center")).toHaveLength(2);
    expect(api.get).toHaveBeenLastCalledWith("/rev/command-center", { signal: expect.any(AbortSignal) });
  });

  it("resource evidence is accessible through a keyboard-native disclosure", async () => {
    await renderPage(fixture());
    const disclosure = screen.getByText("Review resource freshness and coverage");
    expect(disclosure.tagName).toBe("SUMMARY");
    fireEvent.click(disclosure);
    expect(screen.getByText(/^Last success /)).toBeInTheDocument();
  });

  it("page sections fit a single-column mobile hierarchy without horizontal tables", async () => {
    await renderPage(fixture());
    expect(document.querySelectorAll("table")).toHaveLength(0);
    expect(document.querySelector("main")?.className).toContain("overflow-x-clip");
    expect(screen.getByRole("button", { name: "Refresh briefing" })).toBeInTheDocument();
  });
});

function priorityFixture(extra: Record<string, unknown> = {}) {
  const primary = finding(extra) as CommandCenterData["findings"][number];
  return fixture({ findings: [primary], priority_finding: primary,
    priority_selection: { method_version: "finding-priority-v1", eligible_count: 1, tie: null, exclusions: [], no_defensible_priority: false, reason: null } });
}

describe("Task 217 priority finding evidence and next step", () => {
  afterEach(() => { vi.restoreAllMocks(); navigate.mockReset(); });

  it("shows the verified observation, comparison and UTC period", async () => {
    await renderPage(priorityFixture());
    expect(screen.getByRole("heading", { name: "Net sales declined" })).toBeInTheDocument();
    expect(screen.getByText("$650.00")).toBeInTheDocument();
    expect(screen.getByText("$1,000.00")).toBeInTheDocument();
    expect(screen.getByText(/equal length utc windows · UTC/)).toBeInTheDocument();
  });
  it("explains priority separately from confidence", async () => {
    await renderPage(priorityFixture());
    expect(screen.getByRole("heading", { name: "Why this is the priority" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Confidence" })).toBeInTheDocument();
    expect(screen.getByText("high confidence")).toBeInTheDocument();
    expect(screen.queryByText(/confidence \d+%/i)).not.toBeInTheDocument();
  });
  it("provides a concrete merchant-executable next step and expected result", async () => {
    await renderPage(priorityFixture());
    expect(screen.getByText(/Compare order count and average order value/)).toBeInTheDocument();
    expect(screen.getByText(/Identify whether the change is concentrated/)).toBeInTheDocument();
    expect(screen.getByText(/merchant action, not executed by Revluma/)).toBeInTheDocument();
  });
  it("uses progressive disclosure for provenance, lifecycle and unknowns", async () => {
    await renderPage(priorityFixture());
    const disclosure = screen.getByText("Inspect evidence, provenance and uncertainty");
    expect(disclosure.tagName).toBe("SUMMARY");
    fireEvent.click(disclosure);
    expect(screen.getByText("coverage-run-1")).toBeInTheDocument();
    expect(screen.getByText(/current evidence verified/)).toBeInTheDocument();
    expect(screen.getAllByText(/underlying cause is not established/i).length).toBeGreaterThan(0);
  });
  it("opens Rev with the exact priority finding and revalidation contract", async () => {
    await renderPage(priorityFixture());
    fireEvent.click(screen.getByRole("button", { name: /Investigate in Rev Intelligence/ }));
    expect(navigate).toHaveBeenCalledWith("/dashboard/rev-intell?finding=finding-1");
  });
  it("shows an honest no-priority state instead of a generic healthy alert", async () => {
    await renderPage(fixture());
    expect(screen.getByText("No sufficiently supported priority is currently available")).toBeInTheDocument();
    expect(screen.queryByText(/no business problems|everything is healthy/i)).not.toBeInTheDocument();
  });
  it("retains lower eligible findings without another top-priority card", async () => {
    const first = finding() as CommandCenterData["findings"][number];
    const second = finding({ id: "finding-2", title: "Returning buyers declined", severity: "medium", investigation: { finding_id: "finding-2", route: "/dashboard/rev-intell?finding=finding-2", context_contract: "rev-selected-finding-v1", revalidate_on_open: true } }) as CommandCenterData["findings"][number];
    await renderPage(fixture({ findings: [first, second], priority_finding: first, priority_selection: { method_version: "finding-priority-v1", eligible_count: 2, tie: null, exclusions: [], no_defensible_priority: false, reason: null } }));
    expect(screen.getByText("Other eligible findings")).toBeInTheDocument();
    expect(screen.getByText("Returning buyers declined")).toBeInTheDocument();
  });
  it("refund deterioration recommends affected orders, products and reasons", async () => {
    await renderPage(priorityFixture({ title: "Refund value increased 100%", type: "refund_increase",
      recommendation: { available: true, step: "Review refund transactions. Compare affected orders, products and recorded refund reasons.", rationale: "The cause is not established.", expected_result: "Identify concentration in a product or issue.", validation_method: "Repeat with the same currency.", prerequisites: [], read_only: true, executed: false } }));
    expect(screen.getByText(/affected orders, products and recorded refund reasons/)).toBeInTheDocument();
    expect(screen.queryByText(/recoverable revenue|guaranteed recovery/i)).not.toBeInTheDocument();
  });
  it("inventory history limitation remains attached to the relevant claim", async () => {
    await renderPage(priorityFixture({ limitations: ["Inventory history is unavailable; no stockout history is asserted."] }));
    expect(screen.getByText(/no stockout history is asserted/)).toBeInTheDocument();
  });
  it("stale or failed evidence does not appear as a current top priority", async () => {
    await renderPage(fixture({ priority_selection: { method_version: "finding-priority-v1", eligible_count: 0, tie: null, exclusions: [{ finding_id: "old", title: "Old decline", reason: "stale_unreverified" }], no_defensible_priority: true, reason: "No open finding currently satisfies validity, evidence, freshness and coverage requirements." } }));
    expect(screen.getByText(/freshness and coverage requirements/)).toBeInTheDocument();
    expect(screen.getByText("Old decline")).toBeInTheDocument();
    expect(screen.getByText(/not current: stale unreverified/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Old decline" })).not.toBeInTheDocument();
  });
  it("incomplete coverage cannot produce a supported priority", async () => {
    await renderPage(fixture({ priority_selection: { ...fixture().priority_selection, reason: "Order coverage is incomplete; the revenue comparison is withheld." } }));
    expect(screen.getByText(/revenue comparison is withheld/)).toBeInTheDocument();
  });
  it("explains deterministic ties without implying greater impact", async () => {
    const tied = finding({ priority: { method_version: "finding-priority-v1", classification: "high", rationale: ["Recorded severity: high."], tie: { finding_ids: ["finding-1", "finding-2"], statement: "Equal severity, freshness, confidence and coverage. Stable ID order does not imply greater impact." } } });
    await renderPage(priorityFixture(tied));
    expect(screen.getByText(/Stable ID order does not imply greater impact/)).toBeInTheDocument();
  });
  it("retains duplicate provenance without duplicate priority cards", async () => {
    const duplicate = finding({ evidence: { ...finding().evidence, duplicate_finding_ids: ["old-finding"] } });
    await renderPage(priorityFixture(duplicate));
    fireEvent.click(screen.getByText("Inspect evidence, provenance and uncertainty"));
    expect(screen.getByText(/Deduplicated records retained: old-finding/)).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Net sales declined" })).toHaveLength(1);
  });
  it("invalidated context carries prerequisites, not a current action", async () => {
    await renderPage(priorityFixture({ lifecycle: { state: "invalidated", current_validity: "historical_invalidated", invalidated: true }, recommendation: { available: false, step: null, rationale: null, expected_result: null, validation_method: null, prerequisites: ["Restore fresh, verified source evidence before treating this as current."], read_only: true, executed: false } }));
    expect(screen.getByText(/Restore fresh, verified source evidence/)).toBeInTheDocument();
  });
  it("priority evidence remains keyboard accessible and responsive without raw tables", async () => {
    await renderPage(priorityFixture());
    expect(document.querySelectorAll("table")).toHaveLength(0);
    expect(screen.getByText("Inspect evidence, provenance and uncertainty").tagName).toBe("SUMMARY");
    expect(document.querySelector("main")?.className).toContain("overflow-x-clip");
  });
  it("does not expose an invented numerical priority or confidence score", async () => {
    await renderPage(priorityFixture());
    expect(screen.queryByText(/priority score|confidence score|\d+% confident/i)).not.toBeInTheDocument();
    expect(screen.getByText(/finding-priority-v1/)).toBeInTheDocument();
  });
});

describe("Task 218 Command Center — business health and operational history", () => {
  afterEach(() => { vi.restoreAllMocks(); navigate.mockReset(); });

  it("renders the Task 218 sections bound to the briefing's store", async () => {
    await renderPage(fixture());
    await screen.findByText("$42,510.50"); // Task 218 store-scoped fetch
    expect(screen.getByRole("heading", { name: "Business health" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Operational history" })).toBeInTheDocument();
    // Indicator values come from the store-scoped contract, not the briefing.
    expect(screen.getByText("$42,510.50")).toBeInTheDocument();
    expect(screen.getByText("312 orders")).toBeInTheDocument();
    expect(screen.getByText("2 recorded")).toBeInTheDocument();
  });

  it("renders the Task 218 sections only when a store context exists", async () => {
    await renderPage(fixture({ context: { ...fixture().context, store: null } }));
    expect(screen.queryByRole("heading", { name: "Business health" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Operational history" })).not.toBeInTheDocument();
  });

  it("never shows an investigate action unless the integration is connected", async () => {
    await renderPage(fixture()); // integration: null in the base fixture
    expect(screen.queryByRole("button", { name: "Investigate with Rev" })).not.toBeInTheDocument();
  });
});
