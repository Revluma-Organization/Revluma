import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import { ProblemSection } from "@/components/ProblemSection";
import { PROBLEM } from "@/content";

const frontend = resolve(__dirname, "../../..");
const homepage = readFileSync(resolve(frontend, "index.html"), "utf8");

describe("Problem section (section 3)", () => {
  it("leads with the split headline as one h2", () => {
    render(<ProblemSection />);
    const h2 = screen.getByRole("heading", { level: 2 });
    expect(h2.textContent).toBe(
      "Your store generates data.But does it explain what's going wrong?",
    );
    expect(within(h2).getByText(PROBLEM.headline.accent)).toHaveClass(
      "text-indigo-deep",
    );
  });

  it("names the three problems, in order, as a list", () => {
    render(<ProblemSection />);
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(
      items.map(
        (li) => within(li).getByRole("heading", { level: 3 }).textContent,
      ),
    ).toEqual([
      "Information without answers",
      "Disconnected evidence",
      "Unclear priorities",
    ]);
    expect(screen.getByText(PROBLEM.closing)).toBeInTheDocument();
  });

  it("does not claim every merchant has the problem, and shows no figures", () => {
    const { container } = render(<ProblemSection />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(
      /\b(every|all|most) (shopify )?(merchants?|stores?|store owners?)\b/i,
    );
    // The only digits are the 01-03 card labels; the illustrations use labels only.
    expect(text.replace(/0[1-3]/g, "")).not.toMatch(/[0-9%$€£₦]/);
  });
});

describe("Homepage: features section replaced by the problem section", () => {
  it("mounts the problem section where Platform Capabilities was", () => {
    expect(homepage).toContain(
      '<div id="problem" class="revluma-section" data-pending>',
    );
    expect(homepage.indexOf('id="problem"')).toBeLessThan(
      homepage.indexOf('id="how-it-works"'),
    );
  });

  it("has no trace of the old features section, page link or images", () => {
    expect(homepage).not.toContain('id="features"');
    expect(homepage).not.toContain("Platform Capabilities");
    expect(homepage).not.toMatch(/features\.html|feat-card|feature-img/);
    for (const image of [
      "cart-recovery-icon.png",
      "product-intelligence.png",
      "crm-database.webp",
    ]) {
      expect(existsSync(resolve(frontend, "assets/images", image))).toBe(false);
    }
  });
});
