import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import App from "@/App";
import { MEET_REV } from "@/content";

const homepage = readFileSync(resolve(__dirname, "../../../index.html"), "utf8");

function section() {
  render(<App />);
  return screen.getByRole("region", { name: `${MEET_REV.headline.lead} ${MEET_REV.headline.accent}` });
}

describe("Meet Rev (the intelligence interface)", () => {
  it("renders the approved headline and intro", () => {
    const el = section();
    expect(within(el).getByRole("heading", { level: 2 }).textContent).toBe("Don't just look at the numbers.Understand what they mean.");
    expect(within(el).getByText(MEET_REV.description)).toBeInTheDocument();
  });

  it("labels the conversation as a demonstration with sample data", () => {
    const el = section();
    const windowEl = within(el).getByRole("figure", { name: /Example Rev conversation\. Sample store · demonstration data/ });
    expect(within(windowEl).getByText(MEET_REV.sampleLabel)).toBeInTheDocument();
  });

  it("walks through the whole interaction: question, checks, facts, hypotheses, unknowns, next steps", () => {
    const el = section();
    expect(within(el).getByText(MEET_REV.question)).toBeInTheDocument();
    expect(within(el).getByText(/Checks that ran/)).toBeInTheDocument();
    for (const check of MEET_REV.checks) expect(within(el).getByText(check.label)).toBeInTheDocument();
    expect(within(el).getByText("not connected")).toBeInTheDocument();
    expect(within(el).getByText("Partial evidence")).toBeInTheDocument();
    expect(within(el).getByRole("heading", { name: "Facts" })).toBeInTheDocument();
    expect(within(el).getByRole("heading", { name: "Hypotheses · not verified" })).toBeInTheDocument();
    expect(within(el).getByRole("heading", { name: "Unknowns and limits" })).toBeInTheDocument();
    expect(within(el).getByRole("heading", { name: "Recommended next steps" })).toBeInTheDocument();
    expect(within(el).getByText("Recommendations only. Nothing was changed or sent.")).toBeInTheDocument();
    for (const rec of MEET_REV.recommendations) expect(within(el).getByText(rec.label)).toBeInTheDocument();
  });

  it("cites a real source for every fact", () => {
    const sources = new Set(MEET_REV.sources.map((s) => s.n));
    for (const fact of MEET_REV.facts) expect(sources.has(fact.cite)).toBe(true);
    const el = section();
    const facts = el.querySelectorAll(".mr-facts li");
    expect(facts).toHaveLength(MEET_REV.facts.length);
    facts.forEach((li) => expect(li.querySelector(".mr-cite")).not.toBeNull());
  });

  it("keeps the sample numbers internally consistent", () => {
    // Sales 18,420 vs 21,960 (not shown as money); orders 236 vs 281.
    expect(((18420 - 21960) / 21960) * 100).toBeCloseTo(-16.1, 1);
    expect((18420 / 236).toFixed(2)).toBe("78.05");
    expect((21960 / 281).toFixed(2)).toBe("78.15");
    // Mobile 130/340 vs 167/345; desktop 106/172 vs 114/185; orders add up.
    expect(((130 / 340) * 100).toFixed(1)).toBe("38.2");
    expect(((167 / 345) * 100).toFixed(1)).toBe("48.4");
    expect(((106 / 172) * 100).toFixed(1)).toBe("61.6");
    expect(((114 / 185) * 100).toFixed(1)).toBe("61.6");
    expect(130 + 106).toBe(236);
    expect(167 + 114).toBe(281);
    expect(167 - 130).toBe(37);
    expect(281 - 236).toBe(45);
    // The daily chart averages to the weekly rate and dips from Wednesday.
    const days = MEET_REV.chart.days.map((d) => d.value);
    expect((days.reduce((a, b) => a + b, 0) / days.length).toFixed(1)).toBe("38.2");
    expect(MEET_REV.chart.days[2].day).toBe("Wed");
    expect(days[2]).toBeLessThan(days[1] - 10);
    expect(MEET_REV.chart.previousWeek).toBe(48.4);
  });

  it("highlights the matching part of the answer from the guide", () => {
    const el = section();
    const guide = within(el).getByRole("list", { name: "What Rev does in this example" });
    const items = within(guide).getAllByRole("button");
    expect(items.map((b) => b.querySelector(".mr-guide__title")?.textContent)).toEqual(MEET_REV.steps.map((s) => s.title));
    fireEvent.click(items[3]);
    expect(items[3]).toHaveAttribute("aria-pressed", "true");
    expect(el.querySelector('[data-step="interpret"]')).toHaveAttribute("data-focus", "on");
    expect(el.querySelector('[data-step="verify"]')).toHaveAttribute("data-focus", "off");
    fireEvent.click(items[3]);
    expect(el.querySelector('[data-step="interpret"]')).not.toHaveAttribute("data-focus");
  });

  it("stays read-only and makes no unverified claims", () => {
    const text = section().textContent ?? "";
    expect(text).not.toMatch(/automat|recover|guarantee|in minutes|brands active|revenue lift/i);
    expect(text).not.toMatch(/[$€£₦]\s?\d/);
  });

  it("replaces the old stats section on the homepage", () => {
    expect(homepage).toContain('<div id="meet-rev" class="revluma-section" data-pending>');
    expect(homepage).not.toMatch(/Brands Active|Avg\. Revenue Lift|Revenue Recovered|Avg\. Setup Time|class="[^"]*counter/);
    expect(homepage.indexOf('id="how-it-works"')).toBeLessThan(homepage.indexOf('id="meet-rev"'));
  });
});
