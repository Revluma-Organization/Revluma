import { useRef, type CSSProperties } from "react";
import { ArrowUpRight, BadgeCheck, Check, Compass, KeyRound, MessagesSquare, type LucideIcon } from "lucide-react";
import { FOUNDING } from "@/content";
import { useLandingConfig } from "@/config";
import { useReveal } from "@/useReveal";
import orbStill from "@/assets/rev-orb.png";
import orbAnimated from "@/assets/rev-orb.webp";
import revlumaIcon from "@/assets/revluma-icon.png";

/**
 * Founding Merchants Program: an honest early-access invitation.
 *
 * Left: the invitation (eyebrow, headline, copy), the one CTA (it opens the
 * homepage's Founding Merchants waitlist through the landing config, like the
 * hero's CTA) and how the programme works in three steps. Right: one
 * membership card: an indigo "Founding Merchant" pass, then what founding
 * merchants get and what we ask in return. No number of places is stated.
 * Reuses the hero's CTA treatment and the features reveal classes (fx-*).
 */

type OfferId = (typeof FOUNDING.offer.items)[number]["id"];

const OFFER_ICONS: Record<OfferId, LucideIcon> = {
  access: KeyRound,
  team: MessagesSquare,
  shape: Compass,
};

const vars = (v: Record<string, string | number>) => v as CSSProperties;

function Pass() {
  return (
    <div className="fm-pass">
      <div className="fm-pass__top">
        <span className="fm-pass__brand">
          <img src={revlumaIcon} alt="" width={22} height={22} />
          Revluma
        </span>
        <picture className="fm-pass__orb">
          <source srcSet={orbStill} media="(prefers-reduced-motion: reduce)" />
          <img src={orbAnimated} alt="" width={40} height={40} loading="lazy" decoding="async" />
        </picture>
      </div>
      <p className="fm-pass__label">
        <BadgeCheck size={18} strokeWidth={2} />
        {FOUNDING.pass.label}
      </p>
      <p className="fm-pass__program">{FOUNDING.pass.program}</p>
      <div className="fm-pass__fields">
        {FOUNDING.pass.fields.map((f) => (
          <div key={f.label}>
            <span className="fm-pass__k">{f.label}</span>
            <span className="fm-pass__v">
              {f.label === "Status" ? <i aria-hidden="true" /> : null}
              {f.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FoundingSection({ id }: { id?: string }) {
  const { joinHref, onJoin } = useLandingConfig();
  const copy = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  useReveal(copy);
  useReveal(card);

  return (
    <section id={id} aria-labelledby="fm-title" className="fm-section relative overflow-hidden py-16 sm:py-20 lg:py-24">
      <div className="relative mx-auto grid max-w-page items-center gap-12 px-5 sm:px-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-16">
        <div ref={copy} className="max-w-[36rem]">
          <p className="fm-eyebrow fx-up" style={vars({ "--i": 0 })}>
            <span className="fm-eyebrow__icon" aria-hidden="true">
              <BadgeCheck size={13} strokeWidth={2.2} />
            </span>
            {FOUNDING.eyebrow}
          </p>
          <h2
            id="fm-title"
            className="fx-up mt-5 font-headline text-[clamp(1.75rem,6.4vw,2.3rem)] font-black leading-[1.08] tracking-[-0.03em] text-ink [font-synthesis:none] [text-wrap:balance] sm:text-[clamp(2.1rem,3.8vw,2.85rem)]"
            style={vars({ "--i": 1 })}
          >
            <span className="block">{FOUNDING.headline.lead}</span>
            <span className="block text-indigo-deep">{FOUNDING.headline.accent}</span>
          </h2>
          <p className="fx-up mt-4 text-[0.98rem] leading-relaxed text-ink-muted [text-wrap:pretty] sm:text-[1.04rem]" style={vars({ "--i": 2 })}>
            {FOUNDING.description}
          </p>

          <div className="fx-up mt-7" style={vars({ "--i": 3 })}>
            <a href={joinHref} onClick={onJoin} className="fm-cta group">
              {FOUNDING.cta}
              <span className="fm-cta__arrow" aria-hidden="true">
                <ArrowUpRight size={15} className="fm-cta__a1" />
                <ArrowUpRight size={15} className="fm-cta__a2" />
              </span>
            </a>
            <p className="mt-3 text-[0.8rem] leading-relaxed text-ink-muted">{FOUNDING.ctaNote}</p>
          </div>

          <ol className="fm-steps fx-up" style={vars({ "--i": 4 })} aria-label="How the program works">
            {FOUNDING.steps.map((s, i) => (
              <li key={s.title} className="fm-step">
                <span className="fm-step__n" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <p className="fm-step__title">{s.title}</p>
                  <p className="fm-step__body">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div ref={card} className="fm-stage">
          <div className="fm-card">
            <div aria-hidden="true">
              <Pass />
            </div>
            <div className="fm-card__body">
              <h3 className="fm-card__title">{FOUNDING.offer.title}</h3>
              <ul className="fm-offer">
                {FOUNDING.offer.items.map((o) => {
                  const Icon = OFFER_ICONS[o.id];
                  return (
                    <li key={o.id}>
                      <span className="fm-offer__icon" aria-hidden="true">
                        <Icon size={17} strokeWidth={1.8} />
                      </span>
                      <div>
                        <p className="fm-offer__title">{o.title}</p>
                        <p className="fm-offer__body">{o.body}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <h3 className="fm-card__title fm-card__title--ask">{FOUNDING.ask.title}</h3>
              <ul className="fm-ask">
                {FOUNDING.ask.items.map((a) => (
                  <li key={a}>
                    <Check size={14} strokeWidth={2.6} aria-hidden="true" />
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
