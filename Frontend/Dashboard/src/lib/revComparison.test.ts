import { describe, expect, it } from "vitest";
import { parseVerifiedComparison } from "./revComparison";

const heading = "I compared your latest rolling seven days with the three preceding seven-day periods using recorded store data.\n\nThese periods are UTC-based; they are not Shopify's calendar-week reports.\n\n";
const period = (name: string, count: number) =>
  `**${name}** (2026-10-22 to 2026-10-29, end exclusive):\n\n` +
  `- Orders: ${count} recorded; 1571.90 USD.\n\n` +
  `- Unrecovered abandoned carts: ${count + 1} recorded; 7790.60 USD.\n\n` +
  `- Newly recorded customer profiles: ${count + 2}.\n\n` +
  `- First-time purchaser orders: 1; returning purchaser orders: 1.\n\n` +
  `- Recorded order discounts: 5.00 USD.\n\n`;
const sample = heading + period("Latest period", 2) + period("Previous period 1", 0) +
  period("Previous period 2", 1) + period("Previous period 3", 0) +
  "**What changed:**\n\n- Orders: 2 versus 0 in the preceding period (change: +2).";

describe("Rev verified comparison rendering contract", () => {
  it("extracts all four periods with values, currency, discounts and purchaser cohorts", () => {
    const periods = parseVerifiedComparison(sample);
    expect(periods).toHaveLength(4);
    expect(periods?.[0]).toMatchObject({
      orders: "2", carts: "3", customers: "4", firstTime: "1", returning: "1",
      values: ["1571.90 USD"], cartValues: ["7790.60 USD"], discounts: ["5.00 USD"],
    });
  });
  it("preserves zero counts rather than rendering missing-value dashes", () => {
    expect(parseVerifiedComparison(sample)?.[1].orders).toBe("0");
  });
  it("does not invent cards for incomplete or unrelated answers", () => {
    expect(parseVerifiedComparison("Hello, merchant!")).toBeNull();
    expect(parseVerifiedComparison(heading + period("Latest period", 2))).toBeNull();
    expect(parseVerifiedComparison(sample.replace("- Newly recorded customer profiles: 4.", ""))).toBeNull();
  });
  it("does not mistake the what-changed section for an extra period", () => {
    expect(parseVerifiedComparison(sample)).toHaveLength(4);
  });
});
