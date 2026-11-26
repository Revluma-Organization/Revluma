import { describe, expect, it } from "vitest";
import { ccFinding } from "@/test/commandCenterFixtures";
import {
  countBySignalTier,
  filterSignals,
  matchesSignalTier,
  signalCategories,
  signalVerificationState,
  sortSignals,
} from "./signalsTable";
import type { Finding } from "./types";

const finding = (extra: Record<string, unknown> = {}) => ccFinding(extra) as Finding;
const limited = (extra: Record<string, unknown> = {}) =>
  finding({
    evidence: { ...ccFinding().evidence, classification: "unverified_observation" },
    confidence: { classification: "low", rationale: [], numerical_score: null },
    ...extra,
  });

describe("signalsTable model", () => {
  it("matches severity tiers without inventing a lifecycle dimension", () => {
    expect(matchesSignalTier("critical", "critical_high")).toBe(true);
    expect(matchesSignalTier("high", "critical_high")).toBe(true);
    expect(matchesSignalTier("medium", "critical_high")).toBe(false);
    expect(matchesSignalTier("medium", "medium")).toBe(true);
    expect(matchesSignalTier("low", "low")).toBe(true);
    expect(matchesSignalTier("low", "all")).toBe(true);
  });

  it("splits verified from evidence-limited findings on the shared contract", () => {
    expect(signalVerificationState(finding())).toBe("verified");
    expect(signalVerificationState(limited())).toBe("evidence_limited");
  });

  it("counts tiers from the queue without fabrication", () => {
    const queue = [
      finding({ id: "a", severity: "critical" }),
      finding({ id: "b", severity: "high" }),
      finding({ id: "c", severity: "medium" }),
      finding({ id: "d", severity: "low" }),
    ];
    expect(countBySignalTier(queue)).toEqual({ all: 4, criticalHigh: 2, medium: 1, low: 1 });
  });

  it("lists distinct categories in backend order", () => {
    const queue = [
      finding({ id: "a", signal_category: "sales_revenue" }),
      finding({ id: "b" }),
      finding({ id: "c", signal_category: "sales_revenue" }),
    ];
    expect(signalCategories(queue)).toEqual(["Sales & revenue", "orders"]);
  });

  it("filters by tier, verification, category, and search combined", () => {
    const queue = [
      finding({ id: "a", severity: "critical", title: "Checkout conversion dropped sharply" }),
      limited({ id: "b", severity: "medium", signal_category: "product_inventory" }),
      finding({ id: "c", severity: "low", title: "Unrelated shipping note" }),
    ];
    expect(
      filterSignals(queue, { tier: "critical_high", verification: "all", category: "all", query: "" }).map(
        (item) => item.id,
      ),
    ).toEqual(["a"]);
    expect(
      filterSignals(queue, { tier: "all", verification: "evidence_limited", category: "all", query: "" }).map(
        (item) => item.id,
      ),
    ).toEqual(["b"]);
    expect(
      filterSignals(queue, { tier: "all", verification: "all", category: "Product & inventory", query: "" }).map(
        (item) => item.id,
      ),
    ).toEqual(["b"]);
    expect(
      filterSignals(queue, { tier: "all", verification: "all", category: "all", query: "CHECKOUT conversion" }).map(
        (item) => item.id,
      ),
    ).toEqual(["a"]);
    expect(
      filterSignals(queue, { tier: "all", verification: "all", category: "all", query: "orders" }).map(
        (item) => item.id,
      ),
    ).toEqual(["a", "b", "c"]);
  });

  it("sorts by severity and detection while keeping backend order for ties", () => {
    const queue = [
      finding({ id: "a", severity: "low", detected_at: "2026-11-08T10:00:00Z" }),
      finding({ id: "b", severity: "critical", detected_at: "2026-11-07T10:00:00Z" }),
      finding({ id: "c", severity: "critical", detected_at: "2026-11-09T10:00:00Z" }),
      finding({ id: "d", severity: "high", detected_at: "", last_verified_at: null }),
    ];
    expect(sortSignals(queue, "priority").map((item) => item.id)).toEqual(["a", "b", "c", "d"]);
    expect(sortSignals(queue, "severity").map((item) => item.id)).toEqual(["b", "c", "d", "a"]);
    // Newest detected first; the unrecorded timestamp sorts last without crashing.
    expect(sortSignals(queue, "detected").map((item) => item.id)).toEqual(["c", "a", "b", "d"]);
  });
});
