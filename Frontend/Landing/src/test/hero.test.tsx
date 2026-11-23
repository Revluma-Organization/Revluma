import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "@/App";
import { CTA, HERO, NAV_LINKS, SIGN_IN_URL, SIGN_UP_URL } from "@/content";

// Claims the approved blueprint rules out for the MVP landing page.
const BANNED = [
  /cart recovery/i,
  /\b(email|sms|whatsapp)\b.*campaign/i,
  /automatic(ally)? (pric|chang)/i,
  /woocommerce|bigcommerce|amazon|etsy|marketplace/i,
  /guarantee/i,
  /\bincrease (your )?(revenue|conversions?)\b/i,
  /soc ?2|gdpr|uptime|99\.\d/i,
  /\d+\s*(min|minute|second)s?\b.*(setup|set up|install)/i,
  /testimonial|trusted by|\d+\+?\s*(merchants|stores|brands)/i,
  /sidekick|only (product|platform)|better than/i,
  /real-?time|live revenue|continuous(ly)? monitor/i,
  /[$€£₦]\s?\d/,
];

describe("Landing hero", () => {
  it("renders the approved headline as a single h1", () => {
    render(<App />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent?.replace(/\s/g, "")).toBe("Knowwhereyourstoreislosingrevenue.");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText(HERO.subline)).toBeInTheDocument();
    expect(screen.getByText(HERO.body)).toBeInTheDocument();
  });

  it("tracks scroll progress on the copy and the scene for the scroll depth effect", () => {
    const { container } = render(<App />);
    for (const selector of [".m-scroll-copy", ".hero-visual"]) {
      const value = (container.querySelector(selector) as HTMLElement).style.getPropertyValue("--sp");
      expect(Number(value)).toBeGreaterThanOrEqual(0);
      expect(Number(value)).toBeLessThanOrEqual(1);
      expect(value).not.toBe("");
    }
  });

  it("keeps the headline readable word by word and starts the scene", () => {
    const { container } = render(<App />);
    const h1 = screen.getByRole("heading", { level: 1 });
    // Words are split for the entrance but must keep their spaces.
    expect(h1.textContent).toBe("Know whereyour store islosing revenue.");
    expect(h1.querySelectorAll(".m-word")).toHaveLength(7);
    // Without IntersectionObserver (old browsers, jsdom) the scene starts at once.
    expect(container.querySelector(".hero-visual")).toHaveClass("is-live");
    // The "Investigating" dots live inside the decorative, aria-hidden scene.
    expect(container.querySelector(".rev-screen__thinking")?.closest("[aria-hidden='true']")).not.toBeNull();
  });

  it("links the hero CTAs to the waitlist and the sign-up page", () => {
    render(<App />);
    const hero = screen.getByRole("region", { name: /know where/i });
    expect(within(hero).getByRole("link", { name: new RegExp(CTA.primary.label) })).toHaveAttribute("href", "#founding-merchants");
    expect(within(hero).getByRole("link", { name: CTA.secondary.label })).toHaveAttribute("href", SIGN_UP_URL);
  });

  it("renders navigation with Sign In pointing at the real login route", () => {
    render(<App />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    for (const link of NAV_LINKS) {
      expect(within(nav).getByRole("link", { name: link.label })).toHaveAttribute("href", link.href);
    }
    expect(within(nav).getByRole("link", { name: "Sign In" })).toHaveAttribute("href", SIGN_IN_URL);
    expect(SIGN_IN_URL).toBe("/login");
  });

  it("opens and closes the mobile menu", async () => {
    const user = userEvent.setup();
    render(<App />);
    const toggle = screen.getByRole("button", { name: "Open menu" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(screen.getByRole("button", { name: "Close menu" })).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById("mobile-menu")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(document.getElementById("mobile-menu")).not.toBeInTheDocument();
  });

  it("labels the illustration and marks its demo content as a sample", () => {
    render(<App />);
    expect(screen.getByRole("img", { name: /illustration/i })).toBeInTheDocument();
    expect(document.body).toHaveTextContent("Sample investigation");
  });

  it("contains none of the banned claims", () => {
    const { container } = render(<App />);
    const text = container.textContent ?? "";
    for (const pattern of BANNED) {
      expect(text).not.toMatch(pattern);
    }
  });
});
