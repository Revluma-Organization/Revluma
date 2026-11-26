import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import App from "@/App";
import { FOOTER } from "@/content";
import { LandingConfigProvider, DEFAULT_CONFIG } from "@/config";

const homepage = readFileSync(resolve(__dirname, "../../../index.html"), "utf8");

function renderFooter(onJoin = vi.fn()) {
  render(
    <LandingConfigProvider value={{ ...DEFAULT_CONFIG, onJoin }}>
      <App />
    </LandingConfigProvider>,
  );
  return screen.getByRole("contentinfo");
}

describe("Footer", () => {
  it("has the brand, tagline, X link and the four link columns", () => {
    const el = renderFooter();
    expect(within(el).getByRole("link", { name: "Revluma home" })).toHaveAttribute("href", "/");
    expect(within(el).getByText(FOOTER.tagline)).toBeInTheDocument();
    const x = within(el).getByRole("link", { name: "Revluma on X" });
    expect(x).toHaveAttribute("href", "https://x.com/RevlumaAI");
    expect(x).toHaveAttribute("rel", "noopener noreferrer");
    const headings = within(el)
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(headings).toEqual(["Product", "Get started", "Support", "Legal"]);
    expect(within(el).getByText(`© ${new Date().getFullYear()} Revluma.`)).toBeInTheDocument();
  });

  it("only links to things that exist", () => {
    const onJoin = vi.fn((e) => e.preventDefault());
    const el = renderFooter(onJoin);
    const nav = within(el).getByRole("navigation", { name: "Footer" });
    const hrefs = Object.fromEntries(
      within(nav)
        .getAllByRole("link")
        .map((a) => [a.textContent, a.getAttribute("href")]),
    );
    expect(hrefs).toEqual({
      Platform: "#platform",
      "How it works": "#how-it-works",
      "Meet Rev": "#meet-rev",
      Pricing: "#pricing",
      "Start free trial": DEFAULT_CONFIG.signUpHref,
      "Sign in": DEFAULT_CONFIG.signInHref,
      "Founding Merchants": DEFAULT_CONFIG.joinHref,
      FAQ: "#faq",
      "Contact us": "mailto:hello@revluma.com",
      "Privacy Policy": "/pages/privacyPolicy",
      "Terms of Service": "/pages/termsOfService",
    });
    // In-page links point at homepage sections; legal links at the real pages.
    for (const href of Object.values(hrefs)) if (href?.startsWith("#")) expect(homepage).toContain(`id="${href.slice(1)}"`);
    expect(readFileSync(resolve(__dirname, "../../../pages/privacyPolicy.html"), "utf8")).toMatch(/<h1[^>]*>Privacy Policy/);
    expect(readFileSync(resolve(__dirname, "../../../pages/termsOfService.html"), "utf8")).toMatch(/<h1[^>]*>Terms of Service/);
    fireEvent.click(within(nav).getByRole("link", { name: "Founding Merchants" }));
    expect(onJoin).toHaveBeenCalledTimes(1);
  });

  it("renders the scene as decoration, with the eye watching store data Revluma reads", () => {
    const el = renderFooter();
    const scene = el.querySelector(".ft-scene");
    expect(scene).toHaveAttribute("aria-hidden", "true");
    expect(scene?.querySelector("img")).toHaveAttribute("alt", "");
    expect(scene?.querySelector(".ft-eye")).not.toBeNull();
    expect(FOOTER.watch.targets.map((t) => t.label)).toEqual(["Checkouts", "Inventory", "Orders", "Customers", "Products", "Refunds"]);
  });

  it("replaces the old dark footer on the homepage, after the final CTA", () => {
    expect(homepage).not.toMatch(/border-\[#1F1F1F\]|&copy; 2025 Revluma|id="newsletter-form"|splendor_|Changelog/);
    const host = homepage.indexOf('<div id="site-footer"');
    expect(host).toBeGreaterThan(homepage.indexOf('<div id="get-started"'));
  });
});
