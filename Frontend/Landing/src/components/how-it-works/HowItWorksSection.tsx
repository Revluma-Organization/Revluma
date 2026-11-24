import { useRef, type CSSProperties } from "react";
import { Lightbulb, Plug, ScanSearch, type LucideIcon } from "lucide-react";
import { HOW_IT_WORKS } from "@/content";
import { useReveal } from "@/useReveal";

/**
 * "How it works": three steps side by side. Each step is a pearl-white sphere
 * (icon, step number, step label) with its headline and description beneath.
 * A hairline connector runs behind the spheres with a small signal travelling
 * from step to step. The intro reuses the features section's eyebrow and
 * reveal classes (fx-*); orb styles and motion live in how-it-works.css, and
 * all motion is off with reduced motion.
 */

type StepId = (typeof HOW_IT_WORKS.steps)[number]["id"];

const ICONS: Record<StepId, LucideIcon> = {
  connect: Plug,
  analyze: ScanSearch,
  understand: Lightbulb,
};

const vars = (v: Record<string, string | number>) => v as CSSProperties;

export function HowItWorksSection({ id }: { id?: string }) {
  const intro = useRef<HTMLDivElement>(null);
  const steps = useRef<HTMLDivElement>(null);
  useReveal(intro);
  useReveal(steps);

  return (
    <section id={id} aria-labelledby="hiw-title" className="hiw-section relative overflow-hidden py-20 sm:py-28 lg:py-36">
      <div className="hiw-sheen" aria-hidden="true" />
      <div className="relative mx-auto max-w-page px-5 sm:px-8">
        <div ref={intro} className="hiw-intro mx-auto max-w-[62rem] text-center">
          <p className="fx-intro__eyebrow hiw-eyebrow fx-up" style={vars({ "--i": 0 })}>
            {HOW_IT_WORKS.eyebrow}
          </p>
          <h2
            id="hiw-title"
            className="fx-up mt-5 font-headline text-[clamp(1.85rem,7vw,2.75rem)] font-black leading-[1.07] tracking-[-0.03em] text-ink [font-synthesis:none] [text-wrap:balance] sm:text-[clamp(2.3rem,5vw,3.6rem)]"
            style={vars({ "--i": 1 })}
          >
            <span className="block">{HOW_IT_WORKS.headline.lead}</span>
            <span className="block text-indigo-deep">{HOW_IT_WORKS.headline.accent}</span>
          </h2>
          <p
            className="fx-up mx-auto mt-6 max-w-[40rem] text-[1.02rem] leading-relaxed text-ink-muted [text-wrap:pretty] sm:text-[1.1rem]"
            style={vars({ "--i": 2 })}
          >
            {HOW_IT_WORKS.description}
          </p>
        </div>

        <div ref={steps} className="hiw-track">
          <div className="hiw-rail" aria-hidden="true">
            <i />
          </div>
          <ol className="hiw-steps">
            {HOW_IT_WORKS.steps.map((step, i) => {
              const Icon = ICONS[step.id];
              const num = String(i + 1).padStart(2, "0");
              return (
                <li key={step.id} className="hiw-step" style={vars({ "--s": i })} aria-labelledby={`hiw-step-${step.id}`}>
                  <div className="hiw-orb-wrap">
                    <div className="hiw-orb">
                      <div className="hiw-orb__inner">
                        <Icon className="hiw-orb__icon" strokeWidth={1.6} aria-hidden="true" />
                        <span className="hiw-orb__num" aria-hidden="true">
                          {num}
                        </span>
                        <p className="hiw-orb__label">
                          <span className="sr-only">Step {i + 1}: </span>
                          {step.label}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="hiw-copy">
                    <h3 id={`hiw-step-${step.id}`} className="hiw-copy__title">
                      {step.title}
                    </h3>
                    <p className="hiw-copy__body">{step.body}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
