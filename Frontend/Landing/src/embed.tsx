/**
 * Embed build of the rebuilt landing sections for the current homepage
 * (Frontend/index.html): the nav + hero, the features section ("What
 * Revluma does"), how it works (three steps), Meet Rev, the Founding Merchants
 * Program, merchant feedback, the FAQ, pricing, the final CTA and the footer.
 *
 * The homepage still runs on the Tailwind CDN with a dark global theme, so each
 * section renders inside its own shadow root on its host element: page styles
 * cannot restyle the sections and their Tailwind reset cannot leak into the
 * rest of the page. Hosts keep their ids, so in-page links (#platform,
 * #how-it-works) work.
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
import { FeaturesSection } from "./components/features/FeaturesSection";
import { HowItWorksSection } from "./components/how-it-works/HowItWorksSection";
import { MeetRevSection } from "./components/meet-rev/MeetRevSection";
import { FoundingSection } from "./components/founding/FoundingSection";
import { ReviewsSection } from "./components/reviews/ReviewsSection";
import { FaqSection } from "./components/faq/FaqSection";
import { PricingSection } from "./components/pricing/PricingSection";
import { FinalCtaSection } from "./components/final-cta/FinalCtaSection";
import { FooterSection } from "./components/footer/FooterSection";

// Only sections that exist on the current homepage. "Platform" leads to the
// features section (what Revluma does).
export const EMBED_CONFIG: LandingConfig = {
  navLinks: [
    { label: "Platform", href: "#platform" },
    { label: "How It Works", href: "#how-it-works" },
    { label: "FAQ", href: "#faq" },
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
  platform: () => <FeaturesSection />,
  "how-it-works": () => <HowItWorksSection />,
  "meet-rev": () => <MeetRevSection />,
  "founding-merchants": () => <FoundingSection />,
  reviews: () => <ReviewsSection />,
  faq: () => <FaqSection />,
  pricing: () => <PricingSection />,
  "get-started": () => <FinalCtaSection />,
  "site-footer": () => <FooterSection />,
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
