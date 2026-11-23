/**
 * Embed build of the landing hero for the current homepage (Frontend/index.html).
 *
 * The homepage still runs on the Tailwind CDN with a dark global theme, so the
 * hero renders inside a shadow root: page styles cannot restyle the hero and
 * the hero's Tailwind reset cannot leak into the rest of the page.
 *
 * Built by `npm run build:embed` into Frontend/landing-hero/ (see vercel.json).
 */
import { StrictMode } from "react";
import type { MouseEvent } from "react";
import { createRoot } from "react-dom/client";
import fontCss from "./fonts.css?inline";
import appCss from "./index.css?inline";
import { LandingConfigProvider, type LandingConfig } from "./config";
import { Hero } from "./components/Hero";
import { Navbar } from "./components/Navbar";

// Only sections that exist on the current homepage. "Why Revluma" and "FAQ"
// return once those sections are rebuilt.
export const EMBED_CONFIG: LandingConfig = {
  navLinks: [
    { label: "Platform", href: "#features" },
    { label: "How It Works", href: "#how-it-works" },
  ],
  signInHref: "/login",
  joinHref: "#join",
  exploreHref: "#features",
  // The homepage's Alpine waitlist modal listens for `open-waitlist` on window.
  onJoin: (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    window.dispatchEvent(new CustomEvent("open-waitlist"));
  },
};

function mount() {
  const host = document.getElementById("revluma-hero");
  if (!host || host.shadowRoot) return;

  // @font-face only takes effect at document level.
  if (!document.querySelector("style[data-revluma-fonts]")) {
    const fonts = document.createElement("style");
    fonts.dataset.revlumaFonts = "";
    fonts.textContent = fontCss;
    document.head.appendChild(fonts);
  }

  const shadow = host.attachShadow({ mode: "open" });
  const styles = document.createElement("style");
  styles.textContent = appCss;
  const root = document.createElement("div");
  root.className = "rl-root";
  shadow.append(styles, root);

  createRoot(root).render(
    <StrictMode>
      <LandingConfigProvider value={EMBED_CONFIG}>
        <Navbar />
        <Hero />
      </LandingConfigProvider>
    </StrictMode>,
  );
  host.removeAttribute("data-pending");
}

mount();
