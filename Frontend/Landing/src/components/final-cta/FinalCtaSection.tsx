import { useRef, type CSSProperties } from "react";
import { ArrowUpRight, Check, Sparkles } from "lucide-react";
import { FINAL_CTA } from "@/content";
import { useLandingConfig } from "@/config";
import { useReveal } from "@/useReveal";
import orbStill from "@/assets/rev-orb.png";
import orbAnimated from "@/assets/rev-orb.webp";

/**
 * Final CTA: one contained card, narrower than the page, on the light canvas.
 * Rev's orb, the closing headline, the free-trial CTA (real sign-up page) and
 * the Founding Merchants apply link (opens the homepage waitlist), then the
 * trial terms. Reuses the hero's pill CTA (.fm-cta) and the reveal classes.
 */

const vars = (v: Record<string, string | number>) => v as CSSProperties;

export function FinalCtaSection({ id }: { id?: string }) {
  const { signUpHref, joinHref, onJoin } = useLandingConfig();
  const card = useRef<HTMLDivElement>(null);
  useReveal(card);

  return (
    <section id={id} aria-labelledby="fc-title" className="fc-section py-16 sm:py-20 lg:py-24">
      <div className="mx-auto max-w-page px-5 sm:px-8">
        <div ref={card} className="fc-card">
          <div className="fc-glow" aria-hidden="true" />
          <div className="fc-grid" aria-hidden="true" />

          <div className="relative flex flex-col items-center text-center">
            <picture className="fc-orb fx-up" style={vars({ "--i": 0 })} aria-hidden="true">
              <source srcSet={orbStill} media="(prefers-reduced-motion: reduce)" />
              <img src={orbAnimated} alt="" width={64} height={64} loading="lazy" decoding="async" />
            </picture>

            <p className="fm-eyebrow fx-up mt-5" style={vars({ "--i": 1 })}>
              <span className="fm-eyebrow__icon" aria-hidden="true">
                <Sparkles size={12} strokeWidth={2.2} />
              </span>
              {FINAL_CTA.eyebrow}
            </p>

            <h2
              id="fc-title"
              className="fx-up mt-5 max-w-[40rem] font-headline text-[clamp(1.85rem,6.6vw,2.4rem)] font-black leading-[1.06] tracking-[-0.03em] text-ink [font-synthesis:none] [text-wrap:balance] sm:text-[clamp(2.3rem,4.2vw,3.1rem)]"
              style={vars({ "--i": 2 })}
            >
              <span className="block">{FINAL_CTA.headline.lead}</span>
              <span className="block text-indigo-deep">{FINAL_CTA.headline.accent}</span>
            </h2>

            <p
              className="fx-up mt-5 max-w-[34rem] text-[0.98rem] leading-relaxed text-ink-muted [text-wrap:pretty] sm:text-[1.06rem]"
              style={vars({ "--i": 3 })}
            >
              {FINAL_CTA.description}
            </p>

            <div className="fc-actions fx-up" style={vars({ "--i": 4 })}>
              <a href={signUpHref} className="fm-cta group">
                {FINAL_CTA.primary}
                <span className="fm-cta__arrow" aria-hidden="true">
                  <ArrowUpRight size={15} className="fm-cta__a1" />
                  <ArrowUpRight size={15} className="fm-cta__a2" />
                </span>
              </a>
              <a href={joinHref} onClick={onJoin} className="fc-secondary">
                {FINAL_CTA.secondary}
              </a>
            </div>

            <ul className="fc-notes fx-up" style={vars({ "--i": 5 })}>
              {FINAL_CTA.notes.map((n) => (
                <li key={n}>
                  <Check size={13} strokeWidth={2.6} aria-hidden="true" />
                  {n}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
