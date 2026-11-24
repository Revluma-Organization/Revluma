import { useRef, type CSSProperties, type ReactNode } from "react";
import { ArrowDownRight, Check, CircleAlert, ListOrdered, MessageCircleQuestion, ScanSearch, type LucideIcon } from "lucide-react";
import { WHY_REVLUMA } from "@/content";
import { useReveal } from "@/useReveal";
import orbStill from "@/assets/rev-orb.png";

/**
 * "Why Revluma" (section 7): three reasons a store needs Revluma, as three
 * cards. Each card pairs a small product-style vignette (built from the app's
 * own patterns: a metric with Rev's explanation, a list of store signals, a
 * ranked list of findings with evidence pills) with the reason itself. The
 * vignettes are decorative and carry no money figures. Replaces the old
 * comparison table. Reuses the features intro and reveal classes (fx-*).
 */

type ReasonId = (typeof WHY_REVLUMA.reasons)[number]["id"];

const ICONS: Record<ReasonId, LucideIcon> = {
  why: MessageCircleQuestion,
  hidden: ScanSearch,
  first: ListOrdered,
};

const vars = (v: Record<string, string | number>) => v as CSSProperties;
const V = WHY_REVLUMA.visuals;

function WhyVisual() {
  return (
    <div className="wr-vis wr-vis--why">
      <div className="wr-metric">
        <span className="wr-metric__label">{V.why.metric}</span>
        <span className="wr-metric__change">
          <ArrowDownRight size={13} strokeWidth={2.4} />
          {V.why.change}
        </span>
        <svg className="wr-spark" viewBox="0 0 120 32" preserveAspectRatio="none">
          <path pathLength={1} d="M0 8 L20 9 L40 7 L55 20 L70 23 L90 22 L120 24" />
        </svg>
      </div>
      <p className="wr-ask">{V.why.question}</p>
      <div className="wr-answer">
        <img src={orbStill} alt="" width={18} height={18} loading="lazy" decoding="async" />
        <p>{V.why.answer}</p>
      </div>
    </div>
  );
}

function HiddenVisual() {
  return (
    <ul className="wr-vis wr-vis--hidden">
      {V.hidden.map((s, i) => (
        <li key={s.label} className={`wr-signal is-${s.tone}`} style={vars({ "--r": i })}>
          <i />
          <span>{s.label}</span>
          <b>{s.state}</b>
        </li>
      ))}
    </ul>
  );
}

function FirstVisual() {
  return (
    <ol className="wr-vis wr-vis--first">
      {V.first.map((f, i) => (
        <li key={f.label} className="wr-rank" style={vars({ "--r": i })}>
          <span className="wr-rank__n">{i + 1}</span>
          <span className="wr-rank__label">{f.label}</span>
          <span className={`wr-pill is-${f.tone}`}>
            {f.tone === "ok" ? <Check size={10} strokeWidth={3} /> : <CircleAlert size={10} strokeWidth={2.6} />}
            {f.pill}
          </span>
        </li>
      ))}
    </ol>
  );
}

const VISUALS: Record<ReasonId, () => ReactNode> = {
  why: WhyVisual,
  hidden: HiddenVisual,
  first: FirstVisual,
};

export function WhyRevlumaSection({ id }: { id?: string }) {
  const intro = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLOListElement>(null);
  useReveal(intro);
  useReveal(grid);

  return (
    <section id={id} aria-labelledby="wr-title" className="wr-section relative overflow-hidden py-14 sm:py-16 lg:py-20">
      <div className="relative mx-auto max-w-page px-5 sm:px-8">
        <div ref={intro} className="mx-auto max-w-[46rem] text-center">
          <p className="fx-intro__eyebrow fx-up" style={vars({ "--i": 0 })}>
            {WHY_REVLUMA.eyebrow}
          </p>
          <h2
            id="wr-title"
            className="fx-up mt-4 font-headline text-[clamp(1.6rem,6vw,2.1rem)] font-black leading-[1.08] tracking-[-0.03em] text-ink [font-synthesis:none] [text-wrap:balance] sm:text-[clamp(2rem,3.6vw,2.6rem)]"
            style={vars({ "--i": 1 })}
          >
            <span className="block">{WHY_REVLUMA.headline.lead}</span>
            <span className="wr-accent block">{WHY_REVLUMA.headline.accent}</span>
          </h2>
          <p
            className="fx-up mx-auto mt-3 max-w-[36rem] text-[0.92rem] leading-relaxed text-ink-muted [text-wrap:pretty] sm:text-[0.98rem]"
            style={vars({ "--i": 2 })}
          >
            {WHY_REVLUMA.description}
          </p>
        </div>

        <ol ref={grid} className="wr-grid" aria-label="Three reasons your store needs Revluma">
          {WHY_REVLUMA.reasons.map((r, i) => {
            const Icon = ICONS[r.id];
            const Visual = VISUALS[r.id];
            return (
              <li key={r.id} className="wr-card" style={vars({ "--c": i })} aria-labelledby={`wr-${r.id}`}>
                <div className="wr-stage" aria-hidden="true">
                  <Visual />
                </div>
                <div className="wr-copy">
                  <p className="wr-kicker" aria-hidden="true">
                    <span className="wr-icon">
                      <Icon size={15} strokeWidth={1.9} />
                    </span>
                    {r.kicker}
                  </p>
                  <h3 id={`wr-${r.id}`} className="wr-title">
                    <span className="sr-only">Reason {i + 1}: </span>
                    {r.title}
                  </h3>
                  <p className="wr-body">{r.body}</p>
                  <p className="wr-proof">
                    <Check size={13} strokeWidth={2.6} aria-hidden="true" />
                    {r.proof}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
