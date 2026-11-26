import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { KpiStrip, resolveKpiValues } from "./KpiStrip";
import { ccResource, commandCenterFixture } from "./testFixtures";
import type {
  CommandCenterData,
  Finding,
  SignalCategoryId,
  SignalEvaluationItem,
  SignalEvaluationState,
} from "./types";

const finding = (id: string) => ({ id }) as unknown as Finding;
const signal = (id: SignalCategoryId, state: SignalEvaluationState): SignalEvaluationItem => ({
  id, label: id, category: id, state, finding_types: [], source: "orders",
  last_evaluated_at: null, reason: "Fixture signal.",
});
const evaluation = (signals: SignalEvaluationItem[]): CommandCenterData["signal_evaluation"] => ({
  contract_version: "signal-evaluation-coverage-v1",
  evaluated_at: "2026-11-24T12:00:00Z",
  period_days: 7,
  complete: true,
  incomplete: false,
  summary: {
    total_signals: 3, evaluated_count: 3, verified_findings_count: 1,
    not_detected_count: 2, not_evaluated_count: 0, failed_count: 0, stale_count: 0,
  },
  signals,
});

function renderStrip(data: CommandCenterData) {
  return render(
    <MemoryRouter>
      <KpiStrip data={data} />
    </MemoryRouter>,
  );
}

describe("resolveKpiValues", () => {
  it("counts the visible queue once (distinct primary is included, overlap is not double-counted)", () => {
    const primary = finding("primary");
    const distinct = resolveKpiValues(
      commandCenterFixture({ priority_finding: primary, findings: [finding("a"), finding("b")] }),
    );
    expect(distinct.openIssues).toBe(3);
    const overlap = resolveKpiValues(
      commandCenterFixture({ priority_finding: primary, findings: [primary, finding("a")] }),
    );
    expect(overlap.openIssues).toBe(2);
  });

  it("counts verified-state signals and reports null when no evaluation exists", () => {
    const evaluated = resolveKpiValues(
      commandCenterFixture({
        signal_evaluation: evaluation([
          signal("sales_revenue", "verified"),
          signal("traffic_acquisition", "not_detected"),
          signal("storefront_readiness", "stale"),
        ]),
      }),
    );
    expect(evaluated.actionableSignals).toBe(1);
    expect(evaluated.evaluatedSignals).toBe(3);
    const missing = resolveKpiValues(commandCenterFixture());
    expect(missing.actionableSignals).toBeNull();
  });

  it("counts available sources over reported sources", () => {
    const values = resolveKpiValues(
      commandCenterFixture({
        evidence: {
          ...commandCenterFixture().evidence,
          resources: [ccResource(), ccResource({ resource: "abandoned_checkouts", availability: "stale" })],
        },
      }),
    );
    expect(values.availableSources).toBe(1);
    expect(values.totalSources).toBe(2);
  });
});

describe("KpiStrip", () => {
  it("renders exactly the three spec cards with verified values", () => {
    renderStrip(
      commandCenterFixture({
        findings: [finding("a"), finding("b")],
        signal_evaluation: evaluation([
          signal("sales_revenue", "verified"),
          signal("traffic_acquisition", "not_detected"),
          signal("storefront_readiness", "not_detected"),
        ]),
      }),
    );
    expect(screen.getByRole("link", { name: "Open issues: 2. View priority queue" })).toHaveAttribute(
      "href", "/dashboard/overview?section=priority",
    );
    expect(screen.getByRole("link", { name: "Actionable signals: 1. View signals" })).toHaveAttribute(
      "href", "/dashboard/overview?section=signals",
    );
    expect(
      screen.getByRole("link", { name: "Evidence coverage: 1 of 1 sources available. View data readiness" }),
    ).toHaveAttribute("href", "/dashboard/overview?section=evidence");
    expect(screen.getByText("3 of 3 evaluated · 7d window")).toBeInTheDocument();
  });

  it("never renders 0 for an unevaluated signal state", () => {
    renderStrip(commandCenterFixture({ findings: [finding("a")] }));
    const card = screen.getByRole("link", { name: "Actionable signals: not evaluated. View signals" });
    expect(card).toHaveTextContent("—");
    expect(card).toHaveTextContent("Signal evaluation unavailable");
    expect(card).not.toHaveTextContent("0");
    // Sibling cards stay independent of the missing evaluation.
    expect(screen.getByRole("link", { name: /Open issues: 1\./ })).toBeInTheDocument();
  });

  it("renders an honest empty state when no sources are reported", () => {
    renderStrip(
      commandCenterFixture({
        evidence: { ...commandCenterFixture().evidence, resources: [] },
      }),
    );
    const card = screen.getByRole("link", { name: "Evidence coverage: no sources reported. View data readiness" });
    expect(card).toHaveTextContent("—");
    expect(card).toHaveTextContent("No sources reported");
  });

  it("invents no trends, comparisons, sparklines, or scores", () => {
    renderStrip(
      commandCenterFixture({
        findings: [finding("a")],
        signal_evaluation: evaluation([signal("sales_revenue", "verified")]),
      }),
    );
    const strip = screen.getByRole("region", { name: "Key store indicators" });
    expect(strip.textContent).not.toMatch(/trend|versus|vs\. previous|previous period|%|sparkline|score/i);
  });

  it("uses token-driven dense-surface styling with tabular numerals", () => {
    const { container } = renderStrip(commandCenterFixture());
    const cards = container.querySelectorAll("li > a");
    expect(cards).toHaveLength(3);
    for (const card of cards) {
      expect(card.className).toContain("rounded-xl");
      expect(card.className).toContain("border-line-soft");
      expect(card.className).toContain("bg-white");
      expect(card.className).toContain("cursor-pointer");
      expect(card.className).toContain("transition-colors");
      expect(card.className).toContain("focus-visible:ring-2");
    }
    expect(container.querySelectorAll(".tabular-nums").length).toBeGreaterThanOrEqual(3);
  });
});
