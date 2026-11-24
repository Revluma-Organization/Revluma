import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowUpRight, Check, CircleHelp, CircleSlash, Database, Lightbulb, RotateCcw, ShieldCheck } from "lucide-react";
import { MEET_REV } from "@/content";
import { useReveal } from "@/useReveal";
import orbStill from "@/assets/rev-orb.png";
import orbAnimated from "@/assets/rev-orb.webp";

/**
 * "Meet Rev": the intelligence interface, shown through one worked
 * interaction from a clearly labelled sample store: a dark Rev window on the
 * same light canvas as the other landing sections.
 * The answer mirrors the real Rev layout (evidence state, checks that ran,
 * facts with numbered sources, hypotheses marked as not verified, unknowns
 * and limits, recommendations that change nothing).
 *
 * Compact by design: on wide screens the window splits into the
 * investigation (left) and the answer (right). A row of six numbered steps
 * above it names what Rev does; hovering, focusing or tapping one highlights
 * the matching part. The conversation plays through once when reached and
 * again on Replay. All motion is in meet-rev.css and is off with reduced
 * motion, which shows the finished conversation.
 */

type StepId = (typeof MEET_REV.steps)[number]["id"];

const vars = (v: Record<string, string | number>) => v as CSSProperties;
const STEP_NO = Object.fromEntries(MEET_REV.steps.map((s, i) => [s.id, i + 1])) as Record<StepId, number>;

/* Timeline of the play-through, in seconds. */
const T = {
  ask: 0.2,
  investigate: 0.7,
  check: (i: number) => 0.95 + i * 0.35,
  answer: 2.4,
  summary: 2.5,
  bar: (i: number) => 2.7 + i * 0.06,
  verify: 2.9,
  interpret: 3.2,
  gaps: 3.35,
  recommend: 3.6,
  followUps: 3.9,
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
  const max = 56;
  const summary = chart.days.map((d) => `${d.day} ${d.value}%`).join(", ");
  return (
    <figure
      className="mr-chart mr-play"
      style={vars({ "--t": `${T.summary}s` })}
      aria-label={`${chart.label} by day: ${summary}. The week before averaged ${chart.previousWeek}%.`}
    >
      <figcaption className="mr-chart__label">
        {chart.label}
        <span>Week before · {chart.previousWeek}%</span>
      </figcaption>
      <div className="mr-chart__plot" aria-hidden="true">
        <span className="mr-chart__ref" style={vars({ "--y": chart.previousWeek / max })} />
        {chart.days.map((d, i) => (
          <span key={d.day} className={`mr-chart__col${i >= 2 ? " is-low" : ""}`}>
            <span className="mr-chart__bar mr-grow" style={vars({ height: `${(d.value / max) * 100}%`, "--t": `${T.bar(i)}s` })} />
            <i>{d.day}</i>
          </span>
        ))}
      </div>
    </figure>
  );
}

function FollowUps({ where }: { where: "left" | "right" }) {
  return (
    <div className={`mr-follow mr-follow--${where} mr-play`} style={vars({ "--t": `${T.followUps}s` })} aria-hidden="true">
      {MEET_REV.followUps.map((f) => (
        <span key={f}>
          {f}
          <ArrowUpRight size={11} strokeWidth={1.8} />
        </span>
      ))}
    </div>
  );
}

function Conversation({ focus }: { focus: StepId | null }) {
  const r = MEET_REV;
  return (
    <div className="mr-body">
      {/* Left: the question and the investigation. */}
      <div className="mr-col mr-col--left">
        <div className="mr-ask-row">
          <Block id="ask" focus={focus} at={T.ask} className="mr-ask">
            <p className="mr-bubble">{r.question}</p>
          </Block>
        </div>

        <div className="mr-answer__head mr-play" style={vars({ "--t": `${T.investigate}s` })}>
          <Orb size={26} />
          <span className="mr-answer__name">Rev</span>
          <span className="mr-pill">
            <span className="mr-pill__live">Investigating</span>
            <span className="mr-pill__final mr-swap" style={vars({ "--t": `${T.answer}s` })}>
              Partial evidence
            </span>
          </span>
        </div>

        <Block id="investigate" focus={focus} at={T.investigate} className="mr-panel mr-checks">
          <p className="mr-checks__title">
            Checks that ran
            <span>
              {r.period[0].toUpperCase() + r.period.slice(1)} vs {r.comparedTo}
            </span>
          </p>
          <ul>
            {r.checks.map((check, i) => (
              <li key={check.label} className={`mr-play ${check.status === "done" ? "is-done" : "is-missing"}`} style={vars({ "--t": `${T.check(i)}s` })}>
                {check.status === "done" ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : <CircleSlash size={12} aria-hidden="true" />}
                <span>{check.label}</span>
                <em>{check.status === "done" ? "completed" : "note" in check ? check.note : "unavailable"}</em>
              </li>
            ))}
          </ul>
        </Block>

        <p className="mr-summary mr-play" style={vars({ "--t": `${T.summary}s` })}>
          {r.summary}
        </p>
        <Chart />
        <FollowUps where="left" />
      </div>

      {/* Right: what Rev verified, suspects, lacks and recommends. */}
      <div className="mr-col mr-col--right">
        <Block id="verify" focus={focus} at={T.verify} className="mr-panel mr-facts">
          <h4 className="mr-h">
            <ShieldCheck size={13} aria-hidden="true" />
            Facts
          </h4>
          <ul>
            {r.facts.map((fact) => (
              <li key={fact.text}>
                {fact.text} <Cite n={fact.cite} />
              </li>
            ))}
          </ul>
          <div className="mr-sources">
            <span>Sources:</span>
            {r.sources.map((s) => (
              <span key={s.n} className="mr-source">
                <b>{s.n}</b>
                {s.label}
              </span>
            ))}
            <span className="mr-evidence">
              <Database size={11} aria-hidden="true" />
              Evidence ({r.sources.length})
            </span>
          </div>
        </Block>

        <div className="mr-split">
          <Block id="interpret" focus={focus} at={T.interpret} className="mr-panel mr-note mr-note--hyp">
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
          <Block id="gaps" focus={focus} at={T.gaps} className="mr-panel mr-note mr-note--gap">
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

        <Block id="recommend" focus={focus} at={T.recommend} className="mr-panel mr-recs">
          <div className="mr-recs__head">
            <h4 className="mr-h mr-h--caps">Recommended next steps</h4>
            <p className="mr-recs__note">Recommendations only. Nothing was changed or sent.</p>
          </div>
          <ul>
            {r.recommendations.map((rec) => (
              <li key={rec.label}>
                <Check size={13} strokeWidth={2.5} aria-hidden="true" />
                <p>
                  <span className="mr-recs__label">{rec.label}</span> <span className="mr-recs__why">{rec.why}</span>
                </p>
              </li>
            ))}
          </ul>
        </Block>
        <FollowUps where="right" />
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
    <section id={id} aria-labelledby="mr-title" className="mr-section relative overflow-hidden py-14 sm:py-16 lg:py-20">
      <div className="mr-glow" aria-hidden="true" />
      <div className="relative mx-auto max-w-[1120px] px-4 sm:px-8">
        <div ref={intro} className="mx-auto max-w-[60rem] text-center">
          <p className="mr-eyebrow fx-up" style={vars({ "--i": 0 })}>
            <Orb size={20} />
            {MEET_REV.eyebrow}
          </p>
          <h2
            id="mr-title"
            className="fx-up mt-4 font-headline text-[clamp(1.6rem,6vw,2.1rem)] font-black leading-[1.08] tracking-[-0.03em] text-ink [font-synthesis:none] [text-wrap:balance] sm:text-[clamp(2rem,3.6vw,2.6rem)]"
            style={vars({ "--i": 1 })}
          >
            <span className="block">{MEET_REV.headline.lead}</span>
            <span className="mr-accent block">{MEET_REV.headline.accent}</span>
          </h2>
          <p
            className="fx-up mx-auto mt-3 max-w-[36rem] text-[0.92rem] leading-relaxed text-ink-muted [text-wrap:pretty] sm:text-[0.98rem]"
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
                  <span className="mr-guide__title">{step.title}</span>
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
                <Orb size={16} />
                Rev Intelligence
              </span>
              <span className="mr-window__tag">
                <span className="mr-window__tag-full">{MEET_REV.sampleLabel}</span>
                <span className="mr-window__tag-short" aria-hidden="true">
                  Sample data
                </span>
              </span>
              <button type="button" className="mr-replay" onClick={() => setRun((n) => n + 1)}>
                <RotateCcw size={11} aria-hidden="true" />
                Replay
              </button>
            </div>
            <Conversation key={run} focus={active} />
          </figure>
        </div>
      </div>
    </section>
  );
}
