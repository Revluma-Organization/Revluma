import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import App from "@/App";
import { FOUNDING } from "@/content";
import { LandingConfigProvider, DEFAULT_CONFIG } from "@/config";

const homepage = readFileSync(resolve(__dirname, "../../../index.html"), "utf8");

function section() {
  render(<App />);
  return screen.getByRole("region", { name: `${FOUNDING.headline.lead} ${FOUNDING.headline.accent}` });
}

describe("Founding Merchants Program", () => {
  it("renders the approved headline, copy and CTA", () => {
    const el = section();
    expect(within(el).getByRole("heading", { level: 2 }).textContent).toBe("Help shape the next generationof store intelligence.");
    expect(within(el).getByText(FOUNDING.description)).toBeInTheDocument();
    expect(within(el).getByRole("link", { name: FOUNDING.cta })).toBeInTheDocument();
    expect(FOUNDING.description).toBe(
      "We're inviting a select group of Shopify merchants to experience Revluma early, share their operational challenges, and help shape a more useful way to understand their businesses.",
    );
    expect(FOUNDING.cta).toBe("Apply to Become a Founding Merchant");
  });

  it("explains how the program works, what merchants get and what we ask", () => {
    const el = section();
    expect(within(within(el).getByRole("list", { name: "How the program works" }).parentElement!).getAllByRole("listitem")).toHaveLength(3);
    for (const o of FOUNDING.offer.items) expect(within(el).getByText(o.title)).toBeInTheDocument();
    for (const a of FOUNDING.ask.items) expect(within(el).getByText(a)).toBeInTheDocument();
  });

  it("opens the Founding Merchants waitlist from the CTA", () => {
    const onJoin = vi.fn((e) => e.preventDefault());
    render(
      <LandingConfigProvider value={{ ...DEFAULT_CONFIG, onJoin }}>
        <App />
      </LandingConfigProvider>,
    );
    fireEvent.click(screen.getByRole("link", { name: FOUNDING.cta }));
    expect(onJoin).toHaveBeenCalledTimes(1);
  });

  it("is an honest invitation: no stated number of places or unverifiable promises", () => {
    const all = JSON.stringify(FOUNDING);
    expect(all).not.toMatch(/\d+\s*(places|spots|seats|merchants)|only \d|limited to|lifetime|free forever|guarantee|discount|automat|recover/i);
    expect(all).toMatch(/read-only/i);
  });

  it("replaces the always-on globe section on the homepage", () => {
    expect(homepage).toContain('<div id="founding-merchants" class="revluma-section" data-pending>');
    expect(homepage).not.toMatch(/Always-On Revenue|The world doesn't sleep|revlumaMoneyNotifs|revlumaGlobeWrap|LIVE GLOBAL REVENUE FEED/i);
    expect(homepage.indexOf('id="meet-rev"')).toBeLessThan(homepage.indexOf('id="founding-merchants"'));
  });
});
