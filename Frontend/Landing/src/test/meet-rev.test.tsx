import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import App from "@/App";
import { MEET_REV } from "@/content";

const homepage = readFileSync(resolve(__dirname, "../../../index.html"), "utf8");
const T = MEET_REV.turns;
const wait = { timeout: 3000 };

function section() {
  render(<App />);
  return screen.getByRole("region", { name: `${MEET_REV.headline.lead} ${MEET_REV.headline.accent}` });
}

async function reply(el: HTMLElement, label: string) {
  fireEvent.click(within(el).getByRole("button", { name: label }));
}

describe("Meet Rev (a conversation with Rev)", () => {
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

  it("starts with one question and one short answer, plus the checks that ran", () => {
    const el = section();
    const log = within(el).getByRole("log", { name: "Conversation with Rev" });
    expect(within(log).getByText(T.ask.user)).toBeInTheDocument();
    expect(within(log).getByText(T.ask.summary)).toBeInTheDocument();
    expect(within(log).getByText("Partial evidence")).toBeInTheDocument();
    const checks = within(log).getByRole("list", { name: "Checks that ran" });
    for (const c of MEET_REV.checks) expect(within(checks).getByText(c.label)).toBeInTheDocument();
    expect(within(checks).getByText("not connected")).toBeInTheDocument();
    // Nothing else yet: one thing at a time.
    expect(within(log).queryByText(T.verify.lead)).toBeNull();
    expect(within(el).getByRole("button", { name: T.verify.user })).toBeEnabled();
  });

  it("advances one exchange per suggested reply, ending with read-only next steps", async () => {
    const el = section();
    const log = within(el).getByRole("log");

    await reply(el, T.verify.user);
    expect(within(log).getByText(T.verify.user)).toBeInTheDocument();
    expect(await within(log).findByText(T.verify.lead, {}, wait)).toBeInTheDocument();
    const facts = log.querySelectorAll(".mr-list--facts li");
    expect(facts).toHaveLength(T.verify.facts.length);
    facts.forEach((li) => expect(li.querySelector(".mr-cite")).not.toBeNull());
    expect(within(log).getByText("Evidence verified")).toBeInTheDocument();
    expect(within(log).queryByText(T.interpret.lead)).toBeNull();

    await reply(el, T.interpret.user);
    expect(await within(log).findByText(T.interpret.lead, {}, wait)).toBeInTheDocument();
    expect(within(log).getByText("Not verified")).toBeInTheDocument();
    for (const h of T.interpret.hypotheses) expect(within(log).getByText(h)).toBeInTheDocument();
    for (const u of T.interpret.unknowns) expect(within(log).getByText(u)).toBeInTheDocument();

    await reply(el, T.recommend.user);
    expect(await within(log).findByText(T.recommend.lead, {}, wait)).toBeInTheDocument();
    for (const r of T.recommend.recommendations) expect(within(log).getByText(r.label)).toBeInTheDocument();
    expect(within(log).getByText(T.recommend.note)).toBeInTheDocument();

    await reply(el, MEET_REV.restart);
    expect(within(log).queryByText(T.recommend.lead)).toBeNull();
    expect(within(log).getByText(T.ask.user)).toBeInTheDocument();
  });

  it("cites a real source for every fact", () => {
    const sources = new Set(MEET_REV.sources.map((s) => s.n));
    for (const fact of T.verify.facts) expect(sources.has(fact.cite)).toBe(true);
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

  it("stays read-only and makes no unverified claims", () => {
    const all = JSON.stringify(MEET_REV);
    expect(all).not.toMatch(/automat|recover|guarantee|in minutes|brands active|revenue lift/i);
    expect(all).not.toMatch(/[$€£₦]\s?\d/);
  });

  it("replaces the old stats section on the homepage", () => {
    expect(homepage).toContain('<div id="meet-rev" class="revluma-section" data-pending>');
    expect(homepage).not.toMatch(/Brands Active|Avg\. Revenue Lift|Revenue Recovered|Avg\. Setup Time|class="[^"]*counter/);
    expect(homepage.indexOf('id="how-it-works"')).toBeLessThan(homepage.indexOf('id="meet-rev"'));
  });
});
