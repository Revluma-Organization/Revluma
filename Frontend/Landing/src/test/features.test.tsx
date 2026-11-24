import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import App from "@/App";
import { FEATURES } from "@/content";

const homepage = readFileSync(resolve(__dirname, "../../../index.html"), "utf8");

function section() {
  render(<App />);
  return screen.getByRole("region", {
    name: `${FEATURES.headline.lead} ${FEATURES.headline.accent}`,
  });
}

describe("What Revluma does (features section)", () => {
  it("renders the intro with the approved copy", () => {
    const el = section();
    expect(within(el).getByText(FEATURES.eyebrow)).toBeInTheDocument();
    expect(within(el).getByRole("heading", { level: 2 }).textContent).toBe(`${FEATURES.headline.lead}${FEATURES.headline.accent}`);
    expect(within(el).getByText(FEATURES.description)).toBeInTheDocument();
  });

  it("shows exactly four showcases, in order, each with a numbered step, benefit headline, description and visual", () => {
    const el = section();
    const titles = within(el)
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);
    expect(titles).toEqual([
      "Catch revenue problems before they become bigger losses.",
      "Don't just see what's wrong. Understand why.",
      "Know what deserves your attention first.",
      "Turn business insights into measurable next steps.",
    ]);
    const rows = el.querySelectorAll(".fx-show");
    expect(rows).toHaveLength(4);
    rows.forEach((row, i) => {
      const item = FEATURES.items[i];
      expect(row.querySelector(".fx-show__eyebrow")?.textContent).toBe(`${String(i + 1).padStart(2, "0")}${item.step}`);
      expect(within(row as HTMLElement).getByText(item.body)).toBeInTheDocument();
      expect(row.querySelector(".fx-stage .fx-window")).not.toBeNull();
    });
  });

  it("alternates text and visual: 01 and 03 text first, 02 and 04 visual first", () => {
    const rows = [...section().querySelectorAll(".fx-show")];
    expect(rows.map((row) => row.classList.contains("fx-show--flip"))).toEqual([false, true, false, true]);
    // Text stays first in the DOM (reading order); the flip is visual only.
    rows.forEach((row) => expect(row.firstElementChild).toHaveClass("fx-show__text"));
  });

  it("labels every visual as sample data and shows no money figures or percentages", () => {
    const el = section();
    expect(el.querySelectorAll(".fx-window__sample")).toHaveLength(4);
    expect(el.textContent).not.toMatch(/[$€£₦]\s?\d|\d+(\.\d+)?\s?%|\b\d+(\.\d+)?k\b/i);
  });

  it("separates verified facts, hypotheses and unknowns in the investigation", () => {
    const el = section();
    expect(el.querySelector(".fx-finding--fact b")?.textContent?.trim()).toBe("Verified fact");
    expect(el.querySelector(".fx-finding--hypothesis b")?.textContent?.trim()).toBe("Hypothesis");
    expect(el.querySelector(".fx-finding--unknown b")?.textContent?.trim()).toBe("Unknown");
  });

  it("stays read-only: no automation, execution or recovery guarantees", () => {
    const text = section().textContent ?? "";
    expect(text).toContain("Review only · Revluma will not change your store");
    for (const pattern of [
      /automatic(ally)?/i,
      /\bauto-?(fix|apply|recover)/i,
      /guarantee/i,
      /recover(ed|s)? (your )?revenue/i,
      /\b(we|revluma) (will )?(fix|change|update|apply|execute|launch)/i,
      /\b(run|launch|send)s? (a |your )?campaign/i,
    ]) {
      expect(text).not.toMatch(pattern);
    }
  });

  it("replaces the old problem section on the homepage, before How It Works", () => {
    expect(homepage).not.toContain('id="problem"');
    const host = homepage.indexOf('<div id="platform"');
    expect(host).toBeGreaterThan(homepage.indexOf('<div id="revluma-hero"'));
    expect(host).toBeLessThan(homepage.indexOf('id="how-it-works"'));
    // No-JS fallback carries the headline and the four capabilities.
    const fallback = homepage.slice(host, homepage.indexOf("</div>", host));
    expect(fallback).toContain("Everything affecting your revenue. Finally, understood.");
    expect(fallback.match(/<li>/g)).toHaveLength(4);
  });
});
