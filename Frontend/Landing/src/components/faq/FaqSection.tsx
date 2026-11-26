import { useId, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, ArrowUpRight, Check } from "lucide-react";
import { FAQ, FOUNDING } from "@/content";
import { useLandingConfig } from "@/config";
import { useReveal } from "@/useReveal";
import revlumaIcon from "@/assets/revluma-icon.png";

/**
 * Section 11: FAQ. Answers the questions that could stop a merchant joining,
 * describing the product as it is today (see the FAQ block in content.ts).
 *
 * Left: headline and intro, then a "Still have a question?" card with the
 * Founding Merchants CTA (it opens the homepage's waitlist through the
 * landing config). Right: the questions as individual cards; the open card
 * inverts to near-black while the rest stay white. On small screens the card
 * follows the questions. Each question is a button
 * (aria-expanded / aria-controls); answers stay in the DOM so they're
 * searchable, and are hidden from assistive tech and the tab order while
 * collapsed. The first question starts open.
 */

type Item = (typeof FAQ.items)[number];

const vars = (v: Record<string, string | number>) => v as CSSProperties;

function Answer({ item }: { item: Item }) {
  const { joinHref, onJoin } = useLandingConfig();
  const [first, ...rest] = item.a;
  return (
    <>
      <p>{first}</p>
      {"data" in item ? (
        <ul className="faq-data" aria-label="Shopify data Revluma reads">
          {item.data.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      ) : null}
      {"grades" in item ? (
        <ul className="faq-grades">
          {item.grades.map((g) => (
            <li key={g.label}>
              <span className={`faq-pill faq-pill--${g.tone}`}>{g.label}</span>
              <span>{g.body}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {rest.map((p) => (
        <p key={p}>{p}</p>
      ))}
      {"cta" in item ? (
        <a href={joinHref} onClick={onJoin} className="faq-inline-cta">
          {FOUNDING.cta}
          <ArrowUpRight size={15} strokeWidth={2.2} aria-hidden="true" />
        </a>
      ) : null}
    </>
  );
}

function Question({ item, index, open, onToggle }: { item: Item; index: number; open: boolean; onToggle: () => void }) {
  const uid = useId();
  const qId = `${uid}-q`;
  const aId = `${uid}-a`;
  return (
    <li className={`faq-item fx-up${open ? " is-open" : ""}`} style={vars({ "--i": index })}>
      <h3 className="faq-item__h">
        <button type="button" id={qId} className="faq-q" aria-expanded={open} aria-controls={aId} onClick={onToggle}>
          <span className="faq-q__n" aria-hidden="true">
            {index + 1}.
          </span>
          <span className="faq-q__text">{item.q}</span>
          <span className="faq-q__mark" aria-hidden="true">
            <span className="faq-q__bar" />
            <span className="faq-q__bar faq-q__bar--v" />
          </span>
        </button>
      </h3>
      <div id={aId} role="region" aria-labelledby={qId} className="faq-a" aria-hidden={!open}>
        <div className="faq-a__clip">
          <div className="faq-a__body">
            <Answer item={item} />
          </div>
        </div>
      </div>
    </li>
  );
}

export function FaqSection({ id }: { id?: string }) {
  const { joinHref, onJoin } = useLandingConfig();
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set([FAQ.items[0].id]));
  const intro = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const aside = useRef<HTMLDivElement>(null);
  useReveal(intro);
  useReveal(list);
  useReveal(aside);

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <section id={id} aria-labelledby="faq-title" className="faq-section py-16 sm:py-20 lg:py-24">
      <div className="faq-grid mx-auto max-w-page px-5 sm:px-8">
        <div ref={intro} className="faq-intro">
          <h2
            id="faq-title"
            className="fx-up font-headline text-[clamp(1.75rem,6.4vw,2.3rem)] font-black leading-[1.08] tracking-[-0.03em] text-ink [font-synthesis:none] [text-wrap:balance] sm:text-[clamp(2.1rem,3.8vw,2.85rem)]"
            style={vars({ "--i": 0 })}
          >
            <span className="block">{FAQ.headline.lead}</span>
            <span className="block text-indigo-deep">{FAQ.headline.accent}</span>
          </h2>
          <p className="fx-up mt-4 max-w-[30rem] text-[0.98rem] leading-relaxed text-ink-muted [text-wrap:pretty] sm:text-[1.04rem]" style={vars({ "--i": 1 })}>
            {FAQ.description}
          </p>
        </div>

        <div ref={list} className="faq-main">
          <ol className="faq-list" aria-label="Frequently asked questions">
            {FAQ.items.map((item, i) => (
              <Question key={item.id} item={item} index={i} open={open.has(item.id)} onToggle={() => toggle(item.id)} />
            ))}
          </ol>
        </div>

        <div ref={aside} className="faq-aside">
          <div className="faq-ask fx-up sx-drift" style={vars({ "--i": 0, "--sx-d": "22px" })}>
            <span className="faq-ask__orb faq-ask__orb--a" aria-hidden="true" />
            <span className="faq-ask__orb faq-ask__orb--b" aria-hidden="true" />
            <div className="faq-ask__avatars" aria-hidden="true">
              <img src={revlumaIcon} alt="" width={32} height={32} className="faq-ask__avatar" />
              <span className="faq-ask__avatar faq-ask__avatar--a" />
              <span className="faq-ask__avatar faq-ask__avatar--b" />
              <span className="faq-ask__plus">+</span>
              <span className="faq-ask__you">You</span>
            </div>
            <p className="faq-ask__title">{FAQ.aside.title}</p>
            <p className="faq-ask__body">{FAQ.aside.body}</p>
            <a href={joinHref} onClick={onJoin} className="faq-ask__cta">
              <span>{FOUNDING.cta}</span>
              <span className="faq-ask__cta-arrow" aria-hidden="true">
                <ArrowRight size={15} strokeWidth={2.4} />
              </span>
            </a>
            <p className="faq-ask__note">
              <Check size={13} strokeWidth={2.6} aria-hidden="true" />
              For Shopify stores
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
