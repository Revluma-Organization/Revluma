import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import App from "@/App";
import { FINAL_CTA } from "@/content";
import { LandingConfigProvider, DEFAULT_CONFIG } from "@/config";

const homepage = readFileSync(resolve(__dirname, "../../../index.html"), "utf8");
const name = `${FINAL_CTA.headline.lead}${FINAL_CTA.headline.accent}`;

describe("Final CTA", () => {
  it("closes the page with the free trial and the Founding Merchants apply link", () => {
    const onJoin = vi.fn((e) => e.preventDefault());
    render(
      <LandingConfigProvider value={{ ...DEFAULT_CONFIG, onJoin }}>
        <App />
      </LandingConfigProvider>,
    );
    const el = screen.getByRole("region", { name: new RegExp(FINAL_CTA.headline.lead) });
    expect(within(el).getByRole("heading", { level: 2 }).textContent).toBe(name);
    expect(within(el).getByRole("link", { name: FINAL_CTA.primary })).toHaveAttribute("href", DEFAULT_CONFIG.signUpHref);
    fireEvent.click(within(el).getByRole("link", { name: FINAL_CTA.secondary }));
    expect(onJoin).toHaveBeenCalledTimes(1);
    for (const n of FINAL_CTA.notes) expect(within(el).getByText(n)).toBeInTheDocument();
  });

  it("makes no user-count, recovery or cancellation claims", () => {
    const text = JSON.stringify(FINAL_CTA);
    expect(text).not.toMatch(/\d[\d,]*\+?\s*(brands|merchants|stores)|recover|cancel anytime|guarantee/i);
  });

  it("replaces the old dark CTA on the homepage, after pricing", () => {
    expect(homepage).not.toMatch(/Ready to switch\?|Scale with|2,400\+|Book a Demo|Cancel anytime/);
    const host = homepage.indexOf('<div id="get-started"');
    expect(host).toBeGreaterThan(homepage.indexOf('<div id="pricing"'));
    expect(host).toBeLessThan(homepage.indexOf("<!-- ── Footer ── -->"));
  });
});
