import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowUp, ArrowUpRight, Check, CircleHelp, CircleSlash, Database, Lightbulb, RotateCcw, ShieldCheck } from "lucide-react";
import { MEET_REV } from "@/content";
import { useReveal } from "@/useReveal";
import orbStill from "@/assets/rev-orb.png";
import orbAnimated from "@/assets/rev-orb.webp";

/**
 * "Meet Rev": the intelligence interface, shown through one worked
 * interaction from a clearly labelled sample store. The conversation mirrors
 * the real Rev answer layout (evidence state, checks that ran, facts with
 * numbered sources, hypotheses marked as not verified, unknowns and limits,
 * recommendations that change nothing).
 *
 * A guide beside the window names the six things Rev does; hovering, focusing
 * or tapping one highlights the matching part of the answer. When the section
 * is reached the conversation plays through once (question, checks, answer);
 * Replay runs it again. All motion is in meet-rev.css and is off with reduced
 * motion, which shows the finished conversation.
 */

type StepId = (typeof MEET_REV.steps)[number]["id"];

const vars = (v: Record<string, string | number>) => v as CSSProperties;
const STEP_NO = Object.fromEntries(MEET_REV.steps.map((s, i) => [s.id, i + 1])) as Record<StepId, number>;

/* Timeline of the play-through, in seconds. */
const T = {
  ask: 0.2,
  investigate: 0.8,
  check: (i: number) => 1.1 + i * 0.4,
  answer: 2.75,
  summary: 2.95,
  verify: 3.2,
  bar: (i: number) => 3.4 + i * 0.07,
  interpret: 3.6,
  gaps: 3.8,
  sources: 4.0,
  recommend: 4.2,
  followUps: 4.5,
};

function Orb({ size }: { size: number }) {
  return (
    <picture className="mr-orb" style={{ width: size, height: size }}>
      <source srcSet={orbStill} media="(prefers-reduced-motion: reduce)" />
      <img src={orbAnimated} alt="" width={size} height={size} loading="lazy" decoding="async" />
    </picture>
  );
}

function Cite({ n }: { n: number }) {
  const source = MEET_REV.sources.find((s) => s.n === n);
  return (
    <span className="mr-cite" title={source ? `Source ${n}: ${source.label}` : undefined}>
      <span className="sr-only">(source </span>
      {n}
      <span className="sr-only">)</span>
    </span>
  );
}

function Block({ id, focus, at, className = "", children }: { id: StepId; focus: StepId | null; at: number; className?: string; children: ReactNode }) {
  const state = focus === null ? undefined : focus === id ? "on" : "off";
  return (
    <div className={`mr-block mr-play ${className}`} data-step={id} data-focus={state} style={vars({ "--t": `${at}s` })}>
      <span className="mr-marker" aria-hidden="true">
        {STEP_NO[id]}
      </span>
      {children}
    </div>
  );
}

function Chart() {
  const { chart } = MEET_REV;
  const max = 60;
  const summary = chart.days.map((d) => `${d.day} ${d.value}%`).join(", ");
  return (
    <figure className="mr-chart" aria-label={`${chart.label}: ${summary}. The week before averaged ${chart.previousWeek}%.`}>
      <figcaption className="mr-chart__label">
        {chart.label}
        <span>Sample</span>
      </figcaption>
      <div className="mr-chart__plot" aria-hidden="true">
        <span className="mr-chart__ref" style={vars({ "--y": chart.previousWeek / max })}>
          <em>Week before · {chart.previousWeek}%</em>
        </span>
        {chart.days.map((d, i) => (
          <span key={d.day} className={`mr-chart__col${i >= 2 ? " is-low" : ""}`}>
            <span className="mr-chart__bar mr-grow" style={vars({ height: `${(d.value / max) * 100}%`, "--t": `${T.bar(i)}s` })}>
              <b>{d.value}</b>
            </span>
            <i>{d.day}</i>
          </span>
        ))}
      </div>
    </figure>
  );
}

function Conversation({ focus }: { focus: StepId | null }) {
  const r = MEET_REV;
  return (
    <div className="mr-thread">
      <Block id="ask" focus={focus} at={T.ask} className="mr-ask">
        <p className="mr-bubble">{r.question}</p>
      </Block>

      <div className="mr-answer">
        <div className="mr-answer__head mr-play" style={vars({ "--t": `${T.investigate}s` })}>
          <Orb size={30} />
          <span className="mr-answer__name">Rev</span>
          <span className="mr-pill">
            <span className="mr-pill__live">Investigating</span>
            <span className="mr-pill__final mr-swap" style={vars({ "--t": `${T.answer}s` })}>
              Partial evidence
            </span>
          </span>
        </div>

        <Block id="investigate" focus={focus} at={T.investigate} className="mr-checks">
          <p className="mr-checks__title">
            Checks that ran
            <span>
              {r.period[0].toUpperCase() + r.period.slice(1)}, compared with {r.comparedTo}
            </span>
          </p>
          <ul>
            {r.checks.map((check, i) => (
              <li key={check.label} className={`mr-play ${check.status === "done" ? "is-done" : "is-missing"}`} style={vars({ "--t": `${T.check(i)}s` })}>
                {check.status === "done" ? <Check size={13} strokeWidth={3} aria-hidden="true" /> : <CircleSlash size={13} aria-hidden="true" />}
                <span>{check.label}</span>
                <em>{check.status === "done" ? "completed" : "note" in check ? check.note : "unavailable"}</em>
              </li>
            ))}
          </ul>
        </Block>

        <p className="mr-summary mr-play" style={vars({ "--t": `${T.summary}s` })}>
          {r.summary}
        </p>

        <Block id="verify" focus={focus} at={T.verify} className="mr-facts">
          <h4 className="mr-h">
            <ShieldCheck size={13} aria-hidden="true" />
            Facts
          </h4>
          <div className="mr-facts__grid">
            <ul>
              {r.facts.map((fact) => (
                <li key={fact.text}>
                  {fact.text} <Cite n={fact.cite} />
                </li>
              ))}
            </ul>
            <Chart />
          </div>
        </Block>

        <div className="mr-split">
          <Block id="interpret" focus={focus} at={T.interpret} className="mr-note mr-note--hyp">
            <h4 className="mr-h">
              <Lightbulb size={13} aria-hidden="true" />
              Hypotheses · not verified
            </h4>
            <ul>
              {r.hypotheses.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          </Block>
          <Block id="gaps" focus={focus} at={T.gaps} className="mr-note mr-note--gap">
            <h4 className="mr-h">
              <CircleHelp size={13} aria-hidden="true" />
              Unknowns and limits
            </h4>
            <ul>
              {r.unknowns.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          </Block>
        </div>

        <div className="mr-sources mr-play" style={vars({ "--t": `${T.sources}s` })}>
          <p>Based on recorded store data for {r.period}</p>
          <div>
            <span>Sources:</span>
            {r.sources.map((s) => (
              <span key={s.n} className="mr-source">
                <b>{s.n}</b>
                {s.label}
              </span>
            ))}
            <span className="mr-evidence">
              <Database size={12} aria-hidden="true" />
              Evidence ({r.sources.length})
            </span>
          </div>
        </div>

        <Block id="recommend" focus={focus} at={T.recommend} className="mr-recs">
          <h4 className="mr-h mr-h--caps">Recommended next steps</h4>
          <p className="mr-recs__note">Recommendations only. Nothing was changed or sent.</p>
          <ul>
            {r.recommendations.map((rec) => (
              <li key={rec.label}>
                <Check size={13} strokeWidth={2.5} aria-hidden="true" />
                <div>
                  <p className="mr-recs__label">{rec.label}</p>
                  <p className="mr-recs__why">
                    {rec.why}
                    {"measure" in rec ? ` Measure: ${rec.measure}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Block>

        <div className="mr-follow mr-play" style={vars({ "--t": `${T.followUps}s` })} aria-hidden="true">
          {r.followUps.map((f) => (
            <span key={f}>
              {f}
              <ArrowUpRight size={12} strokeWidth={1.8} />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function MeetRevSection({ id }: { id?: string }) {
  const intro = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  useReveal(intro);
  useReveal(stage);
  const [focus, setFocus] = useState<StepId | null>(null);
  const [pinned, setPinned] = useState<StepId | null>(null);
  const [run, setRun] = useState(0);
  const active = focus ?? pinned;

  return (
    <section id={id} aria-labelledby="mr-title" className="mr-section relative overflow-hidden py-20 sm:py-24 lg:py-28">
      <div className="mr-glow" aria-hidden="true" />
      <div className="relative mx-auto max-w-page px-4 sm:px-8">
        <div ref={intro} className="mx-auto max-w-[62rem] text-center">
          <p className="mr-eyebrow fx-up" style={vars({ "--i": 0 })}>
            <Orb size={22} />
            {MEET_REV.eyebrow}
          </p>
          <h2
            id="mr-title"
            className="fx-up mt-5 font-headline text-[clamp(1.75rem,6.6vw,2.4rem)] font-black leading-[1.07] tracking-[-0.03em] text-white [font-synthesis:none] [text-wrap:balance] sm:text-[clamp(2.2rem,4.4vw,3.3rem)]"
            style={vars({ "--i": 1 })}
          >
            <span className="block">{MEET_REV.headline.lead}</span>
            <span className="mr-accent block">{MEET_REV.headline.accent}</span>
          </h2>
          <p
            className="fx-up mx-auto mt-5 max-w-[40rem] text-[0.98rem] leading-relaxed text-white/70 [text-wrap:pretty] sm:text-[1.05rem]"
            style={vars({ "--i": 2 })}
          >
            {MEET_REV.description}
          </p>
        </div>

        <div ref={stage} className="mr-stage">
          <ol className="mr-guide" aria-label="What Rev does in this example">
            {MEET_REV.steps.map((step, i) => (
              <li key={step.id}>
                <button
                  type="button"
                  className="mr-guide__item"
                  aria-pressed={pinned === step.id}
                  data-active={active === step.id ? "" : undefined}
                  onMouseEnter={() => setFocus(step.id)}
                  onMouseLeave={() => setFocus(null)}
                  onFocus={() => setFocus(step.id)}
                  onBlur={() => setFocus(null)}
                  onClick={() => setPinned((p) => (p === step.id ? null : step.id))}
                >
                  <span className="mr-guide__no" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span>
                    <span className="mr-guide__title">{step.title}</span>
                    <span className="mr-guide__body">{step.body}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>

          <figure className="mr-window" aria-label={`Example Rev conversation. ${MEET_REV.sampleLabel}.`}>
            <div className="mr-window__bar">
              <span className="mr-window__dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className="mr-window__app">
                <Orb size={18} />
                Rev Intelligence
              </span>
              <span className="mr-window__tag">
                <span className="mr-window__tag-full">{MEET_REV.sampleLabel}</span>
                <span className="mr-window__tag-short" aria-hidden="true">
                  Sample data
                </span>
              </span>
              <button type="button" className="mr-replay" onClick={() => setRun((n) => n + 1)}>
                <RotateCcw size={12} aria-hidden="true" />
                Replay
              </button>
            </div>
            <Conversation key={run} focus={active} />
            <div className="mr-composer" aria-hidden="true">
              <span>Ask Rev about your store…</span>
              <i>
                <ArrowUp size={14} strokeWidth={2.4} />
              </i>
            </div>
          </figure>
        </div>
      </div>
    </section>
  );
}
