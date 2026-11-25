import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import App from "@/App";
import { PRICING } from "@/content";

const homepage = readFileSync(resolve(__dirname, "../../../index.html"), "utf8");

function section() {
  render(<App />);
  return screen.getByRole("region", { name: `${PRICING.headline.lead} ${PRICING.headline.accent}` });
}
const card = (el: HTMLElement, name: string) => within(el).getByRole("article", { name });

describe("Pricing", () => {
  it("shows the three approved plans with their exact copy", () => {
    const el = section();
    const starter = card(el, "Starter");
    expect(starter).toHaveTextContent("$29/month");
    expect(starter).toHaveTextContent("For merchants getting started with operational intelligence.");
    expect(
      within(starter)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([
      "1 Shopify store",
      "Core store intelligence",
      "Automated signal monitoring",
      "Ranked Top Priorities",
      "Evidence and reasoning",
      "Essential Rev Intelligence access",
      "Basic historical findings",
      "Standard support",
    ]);

    const premium = card(el, "Premium");
    expect(premium).toHaveTextContent("Recommended");
    expect(premium).toHaveTextContent("$79/month");
    expect(premium).toHaveTextContent("Everything in Starter, plus:");
    expect(within(premium).getAllByRole("listitem")).toHaveLength(7);
    expect(premium).toHaveTextContent("Priority support");

    const enterprise = card(el, "Enterprise");
    expect(enterprise).toHaveTextContent("Custom pricing");
    expect(enterprise).toHaveTextContent("For established businesses with complex requirements.");
    expect(within(enterprise).getAllByRole("listitem")).toHaveLength(8);
    expect(within(enterprise).getByRole("link", { name: "Contact our team" })).toHaveAttribute("href", expect.stringMatching(/^mailto:/));
  });

  it("switches to yearly billing at 20% off", () => {
    const el = section();
    fireEvent.click(within(el).getByRole("radio", { name: /Yearly/ }));
    expect(within(el).getByRole("radio", { name: /Yearly/ })).toHaveAttribute("aria-checked", "true");
    expect(card(el, "Starter")).toHaveTextContent("$23/month");
    expect(card(el, "Starter")).toHaveTextContent("Billed yearly · $276/year");
    expect(card(el, "Premium")).toHaveTextContent("$63/month");
    expect(card(el, "Premium")).toHaveTextContent("Billed yearly · $756/year");
    for (const plan of PRICING.plans) {
      if ("price" in plan) expect(plan.price.yearly).toBe(Math.floor(plan.price.monthly * 0.8));
    }
  });

  it("starts Starter and Premium at the real sign-up page, and states the trial", () => {
    const el = section();
    for (const name of ["Starter", "Premium"]) {
      expect(within(card(el, name)).getByRole("link", { name: /Start free trial/ })).toHaveAttribute("href", "/auth/signup");
    }
    expect(within(el).getByText(PRICING.trial)).toBeInTheDocument();
  });

  it("replaces the old pricing teaser on the homepage, after the FAQ", () => {
    expect(homepage).not.toMatch(/Pricing Teaser|One flat price\. No surprises|AI Cart Recovery|ROAS Opportunity/);
    const host = homepage.indexOf('<div id="pricing"');
    expect(host).toBeGreaterThan(homepage.indexOf('<div id="faq"'));
    for (const plan of PRICING.plans) {
      expect(homepage.slice(host)).toContain(plan.description);
      for (const f of plan.features) expect(homepage.slice(host)).toContain(f);
    }
  });
});
