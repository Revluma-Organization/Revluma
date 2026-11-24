import { Hero } from "./components/Hero";
import { Navbar } from "./components/Navbar";
import { ProblemSection } from "./components/ProblemSection";

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
        <ProblemSection id="problem" />
      </main>
    </>
  );
}
