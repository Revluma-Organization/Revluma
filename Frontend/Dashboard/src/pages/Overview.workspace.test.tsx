import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { api } from "@/lib/api";
import Overview from "./Overview";
import { commandCenterFixture } from "@/components/command-center/testFixtures";
import type { CommandCenterData } from "@/components/command-center/types";

// Stage 3a — workspace grid information architecture: KPI strip, 8-col
// Today's Priorities + 4-col sticky rail, briefing + activity preserved below.
// No pixel layout is measured here (jsdom has no layout engine); these verify
// the responsive contracts the application controls: grid spans, rail order
// and landmark, sticky-without-scroll-traps, and single-instance anchors.
const evaluation = {
  contract_version: "signal-evaluation-coverage-v1",
  evaluated_at: "2026-11-24T12:00:00Z",
  period_days: 7,
  complete: true,
  incomplete: false,
  summary: {
    total_signals: 2, evaluated_count: 2, verified_findings_count: 1,
    not_detected_count: 1, not_evaluated_count: 0, failed_count: 0, stale_count: 0,
  },
  signals: [
    { id: "sales_revenue", label: "Sales & revenue", category: "sales_revenue", state: "verified", finding_types: ["no_recent_orders"], source: "orders", last_evaluated_at: "2026-11-24T11:30:00.000Z", reason: "No recent orders." },
    { id: "traffic_acquisition", label: "Traffic & acquisition", category: "traffic_acquisition", state: "not_detected", finding_types: [], source: "analytics.reports", last_evaluated_at: "2026-11-24T11:30:00.000Z", reason: "Active sessions recorded." },
  ],
};

async function renderWorkspace(data: CommandCenterData) {
  vi.spyOn(api, "get").mockImplementation((() =>
    Promise.resolve({ ok: true, status: 200, data: { success: true, data } })) as unknown as typeof api.get);
  const view = render(
    <MemoryRouter initialEntries={["/dashboard/overview"]}>
      <Overview />
    </MemoryRouter>,
  );
  await screen.findByRole("region", { name: "Key store indicators" });
  return view;
}

describe("Command Center workspace grid (Stage 3a)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the KPI strip above the workspace grid", async () => {
    const { container } = await renderWorkspace(commandCenterFixture());
    const strip = screen.getByRole("region", { name: "Key store indicators" });
    expect(strip.querySelectorAll(":scope a")).toHaveLength(3);
    const priorities = container.querySelector("#priority-finding") as HTMLElement;
    expect(strip.compareDocumentPosition(priorities) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("places priorities in 8 columns and the rail in 4, stacked below lg", async () => {
    const { container } = await renderWorkspace(commandCenterFixture());
    const main = container.querySelector("#priority-finding")?.parentElement as HTMLElement;
    expect(main.className).toContain("lg:col-span-8");
    expect(main.className).toContain("min-w-0");
    const grid = main.parentElement as HTMLElement;
    expect(grid.className).toContain("grid");
    expect(grid.className).toContain("lg:grid-cols-12");
    const rail = container.querySelector("aside[aria-label='Secondary intelligence']") as HTMLElement;
    expect(rail.className).toContain("lg:col-span-4");
    expect(rail.className).toContain("min-w-0");
    expect(rail.parentElement).toBe(grid);
  });

  it("keeps the main column first in DOM order and the rail after it", async () => {
    const { container } = await renderWorkspace(commandCenterFixture());
    const priorities = container.querySelector("#priority-finding") as HTMLElement;
    const rail = container.querySelector("aside[aria-label='Secondary intelligence']") as HTMLElement;
    expect(priorities.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("orders the rail as business summary, live signals, then store coverage", async () => {
    const { container } = await renderWorkspace(
      commandCenterFixture({ signal_evaluation: evaluation } as Partial<CommandCenterData>),
    );
    const rail = container.querySelector("aside[aria-label='Secondary intelligence']") as HTMLElement;
    const health = rail.querySelector("#business-health-heading") as HTMLElement;
    const signals = rail.querySelector("#recent-signals") as HTMLElement;
    const coverage = rail.querySelector("#evidence-heading") as HTMLElement;
    expect(health).toBeTruthy();
    expect(signals).toBeTruthy();
    expect(coverage).toBeTruthy();
    expect(health.compareDocumentPosition(signals) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(signals.compareDocumentPosition(coverage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders each moved section exactly once (no main/rail duplication)", async () => {
    const { container } = await renderWorkspace(
      commandCenterFixture({ signal_evaluation: evaluation } as Partial<CommandCenterData>),
    );
    expect(container.querySelectorAll("#priority-finding")).toHaveLength(1);
    expect(container.querySelectorAll("#recent-signals")).toHaveLength(1);
    expect(container.querySelectorAll("#business-health-heading")).toHaveLength(1);
    expect(container.querySelectorAll("#evidence-heading")).toHaveLength(1);
  });

  it("makes the rail sticky on desktop without nested scroll traps", async () => {
    const { container } = await renderWorkspace(commandCenterFixture());
    const rail = container.querySelector("aside[aria-label='Secondary intelligence']") as HTMLElement;
    expect(rail.className).not.toMatch(/overflow-|max-h-|sticky/);
    const sticky = rail.firstElementChild as HTMLElement;
    expect(sticky.className).toContain("lg:sticky");
    expect(sticky.className).toContain("lg:top-[calc(var(--topbar-h)+20px)]");
    expect(sticky.className).not.toMatch(/overflow-|max-h-/);
  });

  it("preserves the briefing and activity sections below the grid", async () => {
    const { container } = await renderWorkspace(commandCenterFixture());
    const rail = container.querySelector("aside[aria-label='Secondary intelligence']") as HTMLElement;
    const briefing = screen.getByRole("heading", { name: "Your latest synchronized business picture" });
    const activity = screen.getByRole("heading", { name: "Operational activity" });
    expect(rail.compareDocumentPosition(briefing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(briefing.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector("#operational-briefing-heading")).toBeTruthy();
    expect(container.querySelector("#operational-activity-heading")).toBeTruthy();
  });

  it("heads the main column with Today's Priorities", async () => {
    await renderWorkspace(commandCenterFixture());
    expect(screen.getByRole("heading", { name: "Today's Priorities", level: 2 })).toBeInTheDocument();
  });
});
