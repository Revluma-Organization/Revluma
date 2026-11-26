import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import App from "@/App";
import { REVIEWS } from "@/content";

const homepage = readFileSync(resolve(__dirname, "../../../index.html"), "utf8");

function section() {
  render(<App />);
  return screen.getByRole("region", { name: `${REVIEWS.headline.lead} ${REVIEWS.headline.accent}` });
}

describe("Merchant feedback", () => {
  it("shows the three approved quotes verbatim with name, role and rating", () => {
    const el = section();
    const cards = within(within(el).getByRole("list", { name: "Merchant feedback" })).getAllByRole("listitem");
    expect(cards).toHaveLength(3);
    REVIEWS.items.forEach((r, i) => {
      expect(within(cards[i]).getByRole("blockquote").textContent).toBe(`“${r.quote}”`);
      expect(cards[i]).toHaveTextContent(r.name);
      expect(cards[i]).toHaveTextContent(r.role);
      expect(within(cards[i]).getByLabelText(`Rated ${r.rating} out of 5`)).toBeInTheDocument();
    });
    expect(REVIEWS.items.map((r) => r.name)).toEqual(["James Mitchell", "Sarah Collins", "Daniel Williams"]);
  });

  it("makes no metric, setup-time or feature claims Revluma can't back", () => {
    const text = REVIEWS.items.map((r) => r.quote).join(" ");
    expect(text).not.toMatch(/[$€£₦]\s?\d|\d+\s*%|\d+\s*(min|minute|day|week|month)s?\b|whatsapp|cart recovery|automation/i);
  });

  it("replaces the old reviews on the homepage, before the FAQ", () => {
    expect(homepage).not.toMatch(/What our customers actually say|From Real Merchants|recovered \$18K|profile[234]\.jpg|Konga Seller/);
    const host = homepage.indexOf('<div id="reviews"');
    expect(host).toBeGreaterThan(homepage.indexOf('<div id="founding-merchants"'));
    expect(host).toBeLessThan(homepage.indexOf('<div id="faq"'));
    for (const r of REVIEWS.items) expect(homepage.slice(host)).toContain(r.quote);
  });

  it("types each quote out without changing the card size or hiding it from screen readers", () => {
    const el = section();
    for (const quote of within(el).getAllByRole("blockquote")) {
      // Typed + untyped parts together always hold the full quote.
      expect(quote.querySelector(".rv-untyped")).not.toBeNull();
      expect(quote.querySelector("[aria-hidden='true']:not(.rv-caret)")).toBeNull();
    }
  });
});
