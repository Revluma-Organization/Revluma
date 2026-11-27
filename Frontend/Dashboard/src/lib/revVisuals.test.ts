import { describe, expect, it } from "vitest";
import type { EvidenceItem, RevAnswerPayload } from "@/lib/revStream";
import {
  chartCellNumber, describeMetricCard, describeTableChart, deriveMetricCards, formatChange,
  formatRelative, MAX_METRIC_CARDS, tableChartSpec,
} from "@/lib/revVisuals";

const period = { start: "2026-10-01T00:00:00Z", end: "2026-10-31T23:59:59Z", timezone: "UTC" };
const previous = { start: "2026-09-01T00:00:00Z", end: "2026-09-30T23:59:59Z", timezone: "UTC" };

const item = (overrides: Partial<EvidenceItem> = {}): EvidenceItem => ({
  id: "ev-revenue", metric: "recorded_order_value", label: "Recorded order value",
  value: 1250, unit: "currency", currency: "USD", status: "available",
  source: "Shopify orders", definition: "Recorded non-cancelled order value.",
  period, ...overrides,
});

const payload = (items: EvidenceItem[], comparison: EvidenceItem[] = [], valid = true): RevAnswerPayload => ({
  read_only: true, response_type: "analysis", text: "Answer.",
  evidence: { items, comparison_items: comparison, validation: { valid, errors: valid ? [] : ["bad"] } },
});

describe("deriveMetricCards (evidence-bound KPI cards)", () => {
  it("shows no strip for one or two bare numbers: the sentence and ledger already carry them", () => {
    expect(deriveMetricCards(payload([item()]))).toEqual([]);
    expect(deriveMetricCards(payload([item(), item({ id: "o", metric: "orders", unit: "count", currency: null, value: 3 })]))).toEqual([]);
  });

  it("builds a card with a measured change when a previous-period record matches", () => {
    const cards = deriveMetricCards(payload(
      [item()],
      [item({ id: "ev-revenue-prev", value: 1000, period: previous })],
    ));
    expect(cards).toHaveLength(1);
    const [card] = cards;
    expect(card.valueText).toBe("USD 1,250.00");
    expect(card.trust).toBe("verified");
    expect(card.change).toMatchObject({ absolute: 250, relative: 0.25, direction: "up", previousText: "USD 1,000.00", previousId: "ev-revenue-prev" });
    expect(formatChange(card, card.change!)).toBe("+USD 250.00");
    expect(formatRelative(card.change!)).toBe("+25%");
    expect(describeMetricCard(card)).toBe("Recorded order value: USD 1,250.00, up USD 250.00 (25%) from USD 1,000.00 in the previous period.");
  });

  it("never pairs records across currencies or units", () => {
    const cards = deriveMetricCards(payload(
      [item(), item({ id: "ev-orders", metric: "orders", label: "Orders", unit: "count", currency: null, value: 42 }),
        item({ id: "ev-aov", metric: "aov", label: "Average order value", value: 29.76 })],
      [item({ id: "ev-eur", currency: "EUR", value: 900, period: previous })],
    ));
    expect(cards).toHaveLength(3);
    expect(cards.every(card => card.change === null)).toBe(true);
  });

  it("skips unusable records and never renders a missing value as zero", () => {
    const cards = deriveMetricCards(payload([
      item(),
      item({ id: "ev-null", metric: "aov", label: "Average order value", value: null }),
      item({ id: "ev-orders", metric: "orders", label: "Orders", unit: "count", currency: null, value: 42 }),
      item({ id: "ev-items", metric: "items", label: "Items sold", unit: "count", currency: null, value: 97 }),
    ]));
    expect(cards.map(card => card.label)).toEqual(["Recorded order value", "Orders", "Items sold"]);
  });

  it("keeps weaker trust labels: partial stays partial, failed validation is unverified", () => {
    const extra = [item({ id: "o", metric: "orders", unit: "count", currency: null, value: 3 }), item({ id: "i", metric: "items", unit: "count", currency: null, value: 5 })];
    const partial = deriveMetricCards(payload([item({ status: "partial" }), ...extra]));
    expect(partial[0].trust).toBe("partial");
    const unverified = deriveMetricCards(payload([item(), ...extra], [], false));
    expect(unverified.every(card => card.trust === "unverified")).toBe(true);
  });

  it("reports no relative change against a zero baseline and caps the strip", () => {
    const cards = deriveMetricCards(payload(
      [item(), ...["a", "b", "c", "d"].map(key => item({ id: key, metric: key, label: key, unit: "count", currency: null, value: 5 }))],
      [item({ id: "prev", value: 0, period: previous })],
    ));
    expect(cards).toHaveLength(MAX_METRIC_CARDS);
    expect(cards[0].change?.relative).toBeNull();
    expect(formatRelative(cards[0].change!)).toBeNull();
  });

  it("returns nothing for a missing payload or empty evidence", () => {
    expect(deriveMetricCards(undefined)).toEqual([]);
    expect(deriveMetricCards({ read_only: true, response_type: "chat", text: "Hi" })).toEqual([]);
  });
});

describe("tableChartSpec (charts only from tables Rev printed)", () => {
  const head = ["Product", "Orders", "Revenue"];

  it("turns a category table into a bar chart spec", () => {
    const spec = tableChartSpec([head, ["Mug", "12", "USD 240.00"], ["Tee", "30", "$600"], ["Cap", "7", "140 USD"]]);
    expect(spec).not.toBeNull();
    expect(spec!.kind).toBe("bar");
    expect(spec!.series.map(entry => entry.label)).toEqual(["Orders", "Revenue"]);
    expect(spec!.rows[1]).toEqual({ label: "Tee", values: [30, 600] });
    expect(describeTableChart(spec!)).toBe("Orders by product. Highest: Tee (30). Lowest: Cap (7).");
  });

  it("turns a period table into a line chart in source order", () => {
    const spec = tableChartSpec([["Week", "Orders"], ["2026-10-05", "10"], ["2026-10-12", "14"], ["2026-10-19", "9"]]);
    expect(spec!.kind).toBe("line");
    expect(describeTableChart(spec!)).toBe("Orders by week, from 10 (2026-10-05) to 9 (2026-10-19).");
  });

  it("declines tables a chart would misrepresent", () => {
    expect(tableChartSpec([head, ["Mug", "12", "240"]])).toBeNull(); // one row
    expect(tableChartSpec([["Product", "Note"], ["Mug", "slow"], ["Tee", "fast"]])).toBeNull(); // no numbers
    expect(tableChartSpec([head, ["Mug", "12", "240"], ["Tee", "3", "x"]])!.series.map(s => s.label)).toEqual(["Orders"]); // only fully numeric columns
    expect(tableChartSpec([head, ["Mug", "n/a", "x"], ["Tee", "3", "y"]])).toBeNull(); // no fully numeric column
    expect(tableChartSpec([head, ["Mug", "1", "2"], ["Mug", "3", "4"]])).toBeNull(); // duplicate labels
    const many = [head, ...Array.from({ length: 16 }, (_, i) => [`P${i}`, String(i), String(i)])];
    expect(tableChartSpec(many)).toBeNull(); // > 15 categories reads faster as a table
  });

  it("reads only a single number per cell", () => {
    expect(chartCellNumber("1,571.90 USD")).toBe(1571.9);
    expect(chartCellNumber("**42**")).toBe(42);
    expect(chartCellNumber("12%")).toBe(12);
    expect(chartCellNumber("12 to 20")).toBeNull();
    expect(chartCellNumber("Unavailable")).toBeNull();
  });
});

describe("ratio cards", () => {
  it("keep one decimal so the card matches the prose", () => {
    const ratio = (id: string, value: number, p = period) => item({ id, metric: "refund_rate", label: "Refund rate", unit: "ratio", currency: null, value, period: p });
    const [card] = deriveMetricCards(payload([ratio("r", 0.031)], [ratio("rp", 0.024, previous)]));
    expect(card.valueText).toBe("3.1%");
    expect(card.change?.previousText).toBe("2.4%");
    expect(formatChange(card, card.change!)).toBe("+0.7 pts");
  });
});
