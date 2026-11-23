import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The embed mounts on import; give it nothing to mount into.
const { EMBED_CONFIG } = await import("@/embed");
const homepage = readFileSync(resolve(__dirname, "../../../index.html"), "utf8");

describe("Homepage hero embed", () => {
  it("only links to sections that exist on the current homepage", () => {
    const hrefs = EMBED_CONFIG.navLinks.map((link) => link.href);
    for (const href of hrefs) {
      expect(href.startsWith("#")).toBe(true);
      expect(homepage).toContain(`id="${href.slice(1)}"`);
    }
  });

  it("points Sign Up at the real sign-up page", () => {
    expect(EMBED_CONFIG.signUpHref).toBe("/auth/signup");
    expect(readFileSync(resolve(__dirname, "../../../../vercel.json"), "utf8")).toContain('"source": "/auth/signup"');
  });

  it("opens the homepage's waitlist modal instead of navigating", () => {
    expect(homepage).toContain("@open-waitlist.window");
    const listener = vi.fn();
    window.addEventListener("open-waitlist", listener);
    const event = { preventDefault: vi.fn() } as unknown as Parameters<NonNullable<typeof EMBED_CONFIG.onJoin>>[0];
    EMBED_CONFIG.onJoin?.(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("is wired into the homepage and the removed hero pieces are gone", () => {
    expect(homepage).toContain('<div id="revluma-hero"');
    expect(homepage).toContain('src="/landing-hero/hero.js"');
    expect(homepage).not.toContain("bounceLogo");
    expect(homepage).not.toContain('id="hero-landing"');
  });
});
