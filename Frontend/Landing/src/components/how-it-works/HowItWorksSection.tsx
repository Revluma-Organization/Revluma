import { useRef, type CSSProperties } from "react";
import { HOW_IT_WORKS } from "@/content";
import { useReveal } from "@/useReveal";

/**
 * "How it works": three steps side by side. Each step is a pearl-white sphere
 * holding everything for that step: the step number at the top, the step
 * name, a bold subhead and the description. A hairline connector runs behind
 * the spheres with a small signal travelling from step to step. The intro
 * reuses the features section's eyebrow and reveal classes (fx-*); sphere
 * styles and motion live in how-it-works.css, and all motion is off with
 * reduced motion.
 */

const vars = (v: Record<string, string | number>) => v as CSSProperties;

export function HowItWorksSection({ id }: { id?: string }) {
  const intro = useRef<HTMLDivElement>(null);
  const steps = useRef<HTMLDivElement>(null);
  useReveal(intro);
  useReveal(steps);

  return (
    <section id={id} aria-labelledby="hiw-title" className="hiw-section relative overflow-hidden py-16 sm:py-20 lg:py-24">
      <div className="relative mx-auto max-w-page px-4 sm:px-8">
        <div ref={intro} className="hiw-intro mx-auto max-w-[52rem] text-center">
          <p className="fx-intro__eyebrow hiw-eyebrow fx-up" style={vars({ "--i": 0 })}>
            {HOW_IT_WORKS.eyebrow}
          </p>
          <h2
            id="hiw-title"
            className="fx-up mt-4 font-headline text-[clamp(1.6rem,6.4vw,2.2rem)] font-black leading-[1.08] tracking-[-0.03em] text-ink [font-synthesis:none] [text-wrap:balance] sm:text-[clamp(2rem,3.8vw,2.8rem)]"
            style={vars({ "--i": 1 })}
          >
            <span className="block">{HOW_IT_WORKS.headline.lead}</span>
            <span className="block text-indigo-deep">{HOW_IT_WORKS.headline.accent}</span>
          </h2>
          <p
            className="fx-up mx-auto mt-4 max-w-[38rem] text-[0.98rem] leading-relaxed text-ink-muted [text-wrap:pretty] sm:text-[1.04rem]"
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
              const num = String(i + 1).padStart(2, "0");
              return (
                <li key={step.id} className="hiw-step" style={vars({ "--s": i })} aria-labelledby={`hiw-step-${step.id}`}>
                  <div className="hiw-orb-wrap">
                    <div className="hiw-orb">
                      <div className="hiw-orb__inner">
                        <span className="hiw-orb__num" aria-hidden="true">
                          {num}
                        </span>
                        <h3 id={`hiw-step-${step.id}`} className="hiw-orb__label">
                          <span className="sr-only">Step {i + 1}: </span>
                          {step.label}
                        </h3>
                        <p className="hiw-orb__title">{step.title}</p>
                        <p className="hiw-orb__body">{step.body}</p>
                      </div>
                    </div>
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
