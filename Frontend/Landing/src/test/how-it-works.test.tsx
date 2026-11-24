import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import App from "@/App";
import { HOW_IT_WORKS } from "@/content";

const homepage = readFileSync(resolve(__dirname, "../../../index.html"), "utf8");

function section() {
  render(<App />);
  return screen.getByRole("region", {
    name: `${HOW_IT_WORKS.headline.lead} ${HOW_IT_WORKS.headline.accent}`,
  });
}

describe("How it works (three steps)", () => {
  it("renders the intro with the approved copy", () => {
    const el = section();
    expect(within(el).getByText(HOW_IT_WORKS.eyebrow)).toBeInTheDocument();
    expect(within(el).getByRole("heading", { level: 2 }).textContent).toBe("From raw store datato clear business intelligence.");
    expect(within(el).getByText(HOW_IT_WORKS.description)).toBeInTheDocument();
  });

  it("shows three numbered steps, in order, each with an icon circle, name, bold subhead and description", () => {
    const el = section();
    const items = within(el).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    const expected = [
      ["Connect your store", "Bring your Shopify data into Revluma."],
      ["Revluma analyzes your business", "Discover what's happening beneath the surface."],
      ["Understand what matters. Know what to do next.", "Turn business intelligence into informed decisions."],
    ];
    items.forEach((item, i) => {
      const [label, title] = expected[i];
      expect(item.querySelector(".hiw-step__kicker")?.textContent).toBe(`Step 0${i + 1}`);
      expect(item.querySelector(".hiw-node__disc svg")).not.toBeNull();
      expect(within(item).getByRole("heading", { level: 3 }).textContent).toBe(`Step ${i + 1}: ${label}`);
      expect(item.querySelector(".hiw-step__title")?.textContent).toBe(title);
      expect(within(item).getByText(HOW_IT_WORKS.steps[i].body)).toBeInTheDocument();
      expect(item).toHaveAccessibleName(`Step ${i + 1}: ${label}`);
    });
  });

  it("draws the decorative infographic: one circle per step on a single weaving path ending in an arrow", () => {
    const el = section();
    const diagram = el.querySelector(".hiw-diagram") as HTMLElement;
    expect(diagram.getAttribute("aria-hidden")).toBe("true");
    expect(diagram.querySelectorAll(".hiw-node")).toHaveLength(3);
    expect(diagram.querySelectorAll(".hiw-path")).toHaveLength(1);
    expect(diagram.querySelector(".hiw-path")?.getAttribute("d")?.match(/ A /g)).toHaveLength(3);
    expect(diagram.querySelector(".hiw-arrow")).not.toBeNull();
    expect(diagram.querySelectorAll(".hiw-dash")).toHaveLength(2);
  });

  it("stays read-only: no automation, recovery or setup-time claims", () => {
    const text = section().textContent ?? "";
    expect(text).not.toMatch(/automat|recover|revenue returns|in minutes|fire|guarantee/i);
  });

  it("replaces the old static section on the homepage and keeps the nav anchor", () => {
    expect(homepage).toContain('<div id="how-it-works" class="revluma-section" data-pending>');
    expect(homepage).not.toMatch(/hiw-|Automations fire|From zero to revenue recovery/);
  });
});
