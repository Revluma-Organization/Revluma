import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import App from "@/App";
import { WHY_REVLUMA } from "@/content";

const homepage = readFileSync(resolve(__dirname, "../../../index.html"), "utf8");

function section() {
  render(<App />);
  return screen.getByRole("region", { name: `${WHY_REVLUMA.headline.lead} ${WHY_REVLUMA.headline.accent}` });
}

describe("Why Revluma (three reasons)", () => {
  it("renders the headline and intro", () => {
    const el = section();
    expect(within(el).getByRole("heading", { level: 2 }).textContent).toBe("Three reasons your storeneeds Revluma.");
    expect(within(el).getByText(WHY_REVLUMA.description)).toBeInTheDocument();
  });

  it("gives exactly three reasons, each with a title, explanation and proof point", () => {
    const el = section();
    const list = within(el).getByRole("list", { name: "Three reasons your store needs Revluma" });
    const items = within(list).getAllByRole("listitem", { name: /^Reason \d:/ });
    expect(items).toHaveLength(3);
    WHY_REVLUMA.reasons.forEach((r, i) => {
      expect(within(items[i]).getByRole("heading", { level: 3 }).textContent).toBe(`Reason ${i + 1}: ${r.title}`);
      expect(within(items[i]).getByText(r.body)).toBeInTheDocument();
      expect(within(items[i]).getByText(r.proof)).toBeInTheDocument();
    });
  });

  it("stays read-only and makes no unverifiable claims", () => {
    const all = JSON.stringify(WHY_REVLUMA);
    expect(all).toMatch(/Read-only/);
    expect(all).not.toMatch(/automat|recover|guarantee|in minutes|better than|typical tools|\d+%|[$€£₦]\s?\d/i);
  });

  it("replaces the comparison table on the homepage", () => {
    expect(homepage).toContain('<div id="why-revluma" class="revluma-section" data-pending>');
    expect(homepage).not.toMatch(/The Honest Comparison|Why Smart Stores Choose Revluma|Typical\s+Tools|<table/);
    expect(homepage.indexOf('id="meet-rev"')).toBeLessThan(homepage.indexOf('id="why-revluma"'));
  });
});
