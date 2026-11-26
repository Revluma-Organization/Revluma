import { useRef, type CSSProperties } from "react";
import { ArrowUpRight, Check } from "lucide-react";
import { FINAL_CTA } from "@/content";
import { useLandingConfig } from "@/config";
import { useReveal } from "@/useReveal";

/**
 * Final CTA: a full-width, compact band on plain white (no card, no glow).
 * The closing headline, the free-trial CTA (real sign-up page) and
 * the Founding Merchants apply link (opens the homepage waitlist), then the
 * trial terms. Reuses the hero's pill CTA (.fm-cta) and the reveal classes.
 */

const vars = (v: Record<string, string | number>) => v as CSSProperties;

export function FinalCtaSection({ id }: { id?: string }) {
  const { signUpHref, joinHref, onJoin } = useLandingConfig();
  const wrap = useRef<HTMLDivElement>(null);
  useReveal(wrap);

  return (
    <section id={id} aria-labelledby="fc-title" className="fc-section py-12 sm:py-14 lg:py-16">
      <div ref={wrap} className="relative mx-auto flex max-w-5xl flex-col items-center px-5 text-center sm:px-8">
        <h2
          id="fc-title"
          className="fx-up font-headline text-[clamp(1.75rem,6.4vw,2.3rem)] font-black leading-[1.06] tracking-[-0.03em] text-ink [font-synthesis:none] [text-wrap:balance] sm:text-[clamp(2.2rem,3.8vw,2.9rem)]"
          style={vars({ "--i": 0 })}
        >
          <span className="block">{FINAL_CTA.headline.lead}</span>
          <span className="block text-indigo-deep">{FINAL_CTA.headline.accent}</span>
        </h2>

        <p className="fx-up mt-3 max-w-[36rem] text-[0.96rem] leading-relaxed text-ink-muted [text-wrap:pretty] sm:text-[1.02rem]" style={vars({ "--i": 1 })}>
          {FINAL_CTA.description}
        </p>

        <div className="fc-actions fx-up" style={vars({ "--i": 2 })}>
          <a href={signUpHref} className="fm-cta group" data-magnetic>
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

        <ul className="fc-notes fx-up" style={vars({ "--i": 3 })}>
          {FINAL_CTA.notes.map((n) => (
            <li key={n}>
              <Check size={13} strokeWidth={2.6} aria-hidden="true" />
              {n}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
