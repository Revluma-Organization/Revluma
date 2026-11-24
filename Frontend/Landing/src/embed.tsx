/**
 * Embed build of the rebuilt landing sections for the current homepage
 * (Frontend/index.html): the nav + hero, and section 3 (the problem).
 *
 * The homepage still runs on the Tailwind CDN with a dark global theme, so each
 * section renders inside its own shadow root on its host element: page styles
 * cannot restyle the sections and their Tailwind reset cannot leak into the
 * rest of the page. Hosts keep their ids, so in-page links (#problem) work.
 *
 * Built by `npm run build:embed` into Frontend/landing-hero/ (see vercel.json).
 */
import { StrictMode } from "react";
import type { MouseEvent, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import fontCss from "./fonts.css?inline";
import appCss from "./index.css?inline";
import { LandingConfigProvider, type LandingConfig } from "./config";
import { Hero } from "./components/Hero";
import { Navbar } from "./components/Navbar";
import { ProblemSection } from "./components/ProblemSection";

// Only sections that exist on the current homepage. "Why Revluma" and "FAQ"
// return once those sections are rebuilt. "Platform" leads to the problem
// section until the capabilities section (blueprint section 5) is rebuilt.
export const EMBED_CONFIG: LandingConfig = {
  navLinks: [
    { label: "Platform", href: "#problem" },
    { label: "How It Works", href: "#how-it-works" },
  ],
  signInHref: "/login",
  joinHref: "#join",
  signUpHref: "/auth/signup",
  // The homepage's Alpine waitlist modal listens for `open-waitlist` on window.
  onJoin: (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    window.dispatchEvent(new CustomEvent("open-waitlist"));
  },
};

/** Host element id -> what renders in its shadow root. */
export const SECTIONS: Record<string, () => ReactNode> = {
  "revluma-hero": () => (
    <>
      <Navbar />
      <Hero />
    </>
  ),
  problem: () => <ProblemSection />,
};

function mountSection(hostId: string, render: () => ReactNode) {
  const host = document.getElementById(hostId);
  if (!host || host.shadowRoot) return;

  const shadow = host.attachShadow({ mode: "open" });
  const styles = document.createElement("style");
  styles.textContent = appCss;
  const root = document.createElement("div");
  root.className = "rl-root";
  shadow.append(styles, root);

  createRoot(root).render(
    <StrictMode>
      <LandingConfigProvider value={EMBED_CONFIG}>{render()}</LandingConfigProvider>
    </StrictMode>,
  );
  host.removeAttribute("data-pending");
}

function mount() {
  // @font-face only takes effect at document level.
  if (!document.querySelector("style[data-revluma-fonts]")) {
    const fonts = document.createElement("style");
    fonts.dataset.revlumaFonts = "";
    fonts.textContent = fontCss;
    document.head.appendChild(fonts);
  }
  for (const [hostId, render] of Object.entries(SECTIONS)) mountSection(hostId, render);
}

mount();
