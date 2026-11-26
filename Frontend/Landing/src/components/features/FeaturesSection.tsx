import { useRef, type ComponentType, type ReactNode } from "react";
import { ListOrdered, MessageSquareText, Radar, ShieldCheck, Telescope, type LucideIcon } from "lucide-react";
import { FEATURES } from "@/content";
import { useReveal } from "@/useReveal";
import { AdviseVisual, DetectVisual, InvestigateVisual, PrioritizeVisual } from "./visuals";
import { vars } from "./primitives";

/**
 * "What Revluma does": four large editorial showcases (Detect, Investigate,
 * Prioritize, Advise & Monitor), stacked and alternating text / product
 * visual, each answering "what does this do for my business?".
 *
 * Text and visual reveal independently on scroll (useReveal adds is-in), so
 * on phones, where the visual sits under the text, it animates when it is
 * actually reached. All motion is in features.css and is off with reduced
 * motion.
 */

type FeatureId = (typeof FEATURES.items)[number]["id"];

const VISUALS: Record<FeatureId, ComponentType> = {
  detect: DetectVisual,
  investigate: InvestigateVisual,
  prioritize: PrioritizeVisual,
  advise: AdviseVisual,
};

const ICONS: Record<FeatureId, LucideIcon> = {
  detect: Radar,
  investigate: Telescope,
  prioritize: ListOrdered,
  advise: MessageSquareText,
};

function Revealed({ className, children }: { className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useReveal(ref);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

export function FeaturesSection({ id }: { id?: string }) {
  return (
    <section id={id} aria-labelledby="features-title" className="fx-section relative overflow-x-clip bg-canvas py-20 sm:py-28 lg:py-36">
      <div className="mx-auto max-w-page px-5 sm:px-8">
        <Revealed className="fx-intro mx-auto max-w-[52rem] text-center">
          <p className="fx-intro__eyebrow fx-up" style={vars({ "--i": 0 })}>
            {FEATURES.eyebrow}
          </p>
          <h2
            id="features-title"
            className="fx-up mt-5 font-headline text-[clamp(1.85rem,7vw,2.75rem)] font-black leading-[1.07] tracking-[-0.03em] text-ink [font-synthesis:none] [text-wrap:balance] sm:text-[clamp(2.3rem,5.2vw,3.9rem)]"
            style={vars({ "--i": 1 })}
          >
            <span className="block">{FEATURES.headline.lead}</span>
            <span className="block text-indigo-deep">{FEATURES.headline.accent}</span>
          </h2>
          <p
            className="fx-up mx-auto mt-6 max-w-[40rem] text-[1.02rem] leading-relaxed text-ink-muted [text-wrap:pretty] sm:text-[1.1rem]"
            style={vars({ "--i": 2 })}
          >
            {FEATURES.description}
          </p>
        </Revealed>

        <ol className="mt-16 space-y-20 sm:mt-20 sm:space-y-24 lg:mt-28 lg:space-y-36">
          {FEATURES.items.map((item, i) => {
            const Visual = VISUALS[item.id];
            const Icon = ICONS[item.id];
            const flipped = i % 2 === 1;
            return (
              <li key={item.id} className={`fx-show fx-show--${item.id}${flipped ? " fx-show--flip" : ""}`} aria-labelledby={`feature-${item.id}`}>
                <Revealed className="fx-show__text">
                  <p className="fx-show__eyebrow fx-up" style={vars({ "--i": 0 })}>
                    <span className="fx-show__icon">
                      <Icon size={15} aria-hidden="true" />
                    </span>
                    <span className="fx-show__num">{String(i + 1).padStart(2, "0")}</span>
                    <span className="fx-show__rule" aria-hidden="true" />
                    {item.step}
                  </p>
                  <h3 id={`feature-${item.id}`} className="fx-show__title fx-up" style={vars({ "--i": 1 })}>
                    {item.title}
                  </h3>
                  <p className="fx-show__body fx-up" style={vars({ "--i": 2 })}>
                    {item.body}
                  </p>
                  {"note" in item && (
                    <p className="fx-show__note fx-up" style={vars({ "--i": 3 })}>
                      <ShieldCheck size={15} aria-hidden="true" />
                      {item.note}
                    </p>
                  )}
                </Revealed>
                <Revealed className="fx-stage sx-tilt">
                  <div className="fx-stage__inner" data-spot>
                    <Visual />
                  </div>
                </Revealed>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
