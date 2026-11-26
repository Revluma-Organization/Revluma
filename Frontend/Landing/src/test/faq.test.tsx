import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import App from "@/App";
import { FAQ, FOUNDING } from "@/content";
import { LandingConfigProvider, DEFAULT_CONFIG } from "@/config";

const homepage = readFileSync(resolve(__dirname, "../../../index.html"), "utf8");
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

const QUESTIONS = [
  "What exactly is Revluma?",
  "Who is Revluma built for?",
  "Does Revluma work with Shopify?",
  "What Shopify data can it access?",
  "Does Revluma make changes to my store?",
  "How does Rev investigate potential revenue leaks?",
  "How does Revluma distinguish facts from assumptions?",
  "What happens when some data is unavailable?",
  "Is Revluma available to everyone yet?",
  "How can I become a founding merchant?",
];

function section() {
  render(<App />);
  return screen.getByRole("region", { name: `${FAQ.headline.lead} ${FAQ.headline.accent}` });
}

describe("FAQ", () => {
  it("asks the ten approved questions, in order, as accordion buttons", () => {
    const el = section();
    const buttons = within(within(el).getByRole("list", { name: "Frequently asked questions" })).getAllByRole("button");
    expect(buttons.map((b) => b.textContent?.replace(/^\d+\.\s*/, ""))).toEqual(QUESTIONS);
  });

  it("opens the first answer and toggles the others", () => {
    const el = section();
    const [first, second] = within(el)
      .getAllByRole("button", { expanded: undefined })
      .filter((b) => b.hasAttribute("aria-controls"));
    expect(first).toHaveAttribute("aria-expanded", "true");
    expect(second).toHaveAttribute("aria-expanded", "false");
    const answer = el.querySelector(`#${CSS.escape(second.getAttribute("aria-controls")!)}`)!;
    expect(answer).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(second);
    expect(second).toHaveAttribute("aria-expanded", "true");
    expect(answer).toHaveAttribute("aria-hidden", "false");
    fireEvent.click(first);
    expect(first).toHaveAttribute("aria-expanded", "false");
  });

  it("describes the current product: Shopify only, no store edits, facts separated from assumptions", () => {
    const text = FAQ.items.map((i) => [...i.a, ...("data" in i ? i.data : []), ...("grades" in i ? i.grades.map((g) => g.body) : [])].join(" ")).join(" ");
    expect(text).toMatch(/Shopify stores only/);
    expect(text).toMatch(/doesn't edit products, prices, discounts or orders/);
    expect(text).toMatch(/never treated as zero/);
    // No roadmap promises or unverifiable claims.
    expect(text).not.toMatch(/\b(will soon|coming soon|roadmap|in the future|planned)\b/i);
    expect(text).not.toMatch(/\d+\s*(merchants|stores|spots|places)/i);
  });

  it("opens the Founding Merchants waitlist from its CTAs", () => {
    const onJoin = vi.fn((e) => e.preventDefault());
    render(
      <LandingConfigProvider value={{ ...DEFAULT_CONFIG, onJoin }}>
        <App />
      </LandingConfigProvider>,
    );
    const el = screen.getByRole("region", { name: `${FAQ.headline.lead} ${FAQ.headline.accent}` });
    const ctas = within(el).getAllByRole("link", { name: FOUNDING.cta, hidden: true });
    expect(ctas).toHaveLength(2);
    for (const cta of ctas) fireEvent.click(cta);
    expect(onJoin).toHaveBeenCalledTimes(2);
  });

  it("sits under the reviews on the homepage, with a fallback that matches the content", () => {
    const host = homepage.indexOf('<div id="faq"');
    expect(host).toBeGreaterThan(homepage.indexOf('<div id="reviews"'));
    expect(host).toBeLessThan(homepage.indexOf('<div id="pricing"'));
    const fallback = decode(homepage.slice(host, homepage.indexOf("</div>\n    </div>", host)));
    for (const item of FAQ.items) {
      expect(fallback).toContain(item.q);
      for (const p of item.a) expect(fallback).toContain(p);
    }
  });
});
