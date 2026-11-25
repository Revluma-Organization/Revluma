import { Hero } from "./components/Hero";
import { Navbar } from "./components/Navbar";
import { FeaturesSection } from "./components/features/FeaturesSection";
import { HowItWorksSection } from "./components/how-it-works/HowItWorksSection";
import { MeetRevSection } from "./components/meet-rev/MeetRevSection";
import { FoundingSection } from "./components/founding/FoundingSection";
import { FaqSection } from "./components/faq/FaqSection";
import { PricingSection } from "./components/pricing/PricingSection";

export default function App() {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to content
      </a>
      <Navbar />
      <main id="main">
        <Hero />
        <FeaturesSection id="platform" />
        <HowItWorksSection id="how-it-works" />
        <MeetRevSection id="meet-rev" />
        <FoundingSection id="founding-merchants" />
        <FaqSection id="faq" />
        <PricingSection id="pricing" />
      </main>
    </>
  );
}
