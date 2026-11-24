import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowUp, Check, CircleSlash, RotateCcw } from "lucide-react";
import { MEET_REV } from "@/content";
import { useReveal } from "@/useReveal";
import orbStill from "@/assets/rev-orb.png";
import orbAnimated from "@/assets/rev-orb.webp";

/**
 * "Meet Rev": a real conversation with Rev, one step at a time, in a dark
 * Rev window on the light landing canvas (sample store, clearly labelled).
 *
 * The visitor drives it. The first question is answered when the window is
 * reached (Rev visibly investigates first); after that each suggested reply
 * ("How do you know?", "What could be causing it?", "What should I do?")
 * adds one exchange, and each of Rev's replies does a single job: the
 * answer, the verified facts, the possible explanations and what Rev can't
 * see, then the recommended next steps. Only the current exchange is in
 * focus; the one before stays above it, faded, for context. With reduced
 * motion replies appear immediately.
 */

type TurnId = keyof typeof MEET_REV.turns;
const ORDER: TurnId[] = ["ask", "verify", "interpret", "recommend"];
const NEXT_REPLY: Partial<Record<TurnId, TurnId>> = { ask: "verify", verify: "interpret", interpret: "recommend" };

const INVESTIGATE_MS = 2400;
const TYPING_MS = 1100;

const vars = (v: Record<string, string | number>) => v as CSSProperties;

function prefersReducedMotion() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

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

function UserMessage({ children }: { children: ReactNode }) {
  return (
    <div className="mr-msg mr-msg--user">
      <p className="mr-bubble">{children}</p>
    </div>
  );
}

function RevMessage({ children, pill }: { children: ReactNode; pill?: string }) {
  return (
    <div className="mr-msg mr-msg--rev">
      <div className="mr-rev__head">
        <Orb size={24} />
        <span className="mr-rev__name">Rev</span>
        {pill ? <span className="mr-pill">{pill}</span> : null}
      </div>
      <div className="mr-rev__body">{children}</div>
    </div>
  );
}

/** Rev at work before the first answer: each check lands in turn. */
function Investigating() {
  return (
    <div className="mr-msg mr-msg--rev" role="status">
      <div className="mr-rev__head">
        <Orb size={24} />
        <span className="mr-rev__name">Rev</span>
        <span className="mr-working">{MEET_REV.investigating}</span>
      </div>
      <ul className="mr-checks mr-checks--live" aria-hidden="true">
        {MEET_REV.checks.map((c, i) => (
          <li key={c.label} className={c.status === "done" ? "is-done" : "is-missing"} style={vars({ "--d": `${0.25 + i * 0.45}s` })}>
            {c.status === "done" ? <Check size={12} strokeWidth={3} /> : <CircleSlash size={12} />}
            {c.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Typing() {
  return (
    <div className="mr-msg mr-msg--rev" role="status">
      <div className="mr-rev__head">
        <Orb size={24} />
        <span className="mr-rev__name">Rev</span>
        <span className="mr-dots" aria-label="Rev is typing">
          <i />
          <i />
          <i />
        </span>
      </div>
    </div>
  );
}

function Chart() {
  const { chart } = MEET_REV;
  const max = 56;
  const summary = chart.days.map((d) => `${d.day} ${d.value}%`).join(", ");
  return (
    <figure className="mr-chart" aria-label={`${chart.label} by day: ${summary}. The week before averaged ${chart.previousWeek}%.`}>
      <figcaption className="mr-chart__label">
        {chart.label}
        <span>Week before · {chart.previousWeek}%</span>
      </figcaption>
      <div className="mr-chart__plot" aria-hidden="true">
        <span className="mr-chart__ref" style={vars({ "--y": chart.previousWeek / max })} />
        {chart.days.map((d, i) => (
          <span key={d.day} className={`mr-chart__col${i >= 2 ? " is-low" : ""}`}>
            <span className="mr-chart__bar" style={vars({ height: `${(d.value / max) * 100}%`, "--d": `${i * 0.06}s` })} />
            <i>{d.day}</i>
          </span>
        ))}
      </div>
    </figure>
  );
}

function Reply({ id }: { id: TurnId }) {
  const t = MEET_REV.turns;
  switch (id) {
    case "ask":
      return (
        <RevMessage pill="Partial evidence">
          <p className="mr-lead mr-lead--strong">{t.ask.summary}</p>
          <ul className="mr-checks" aria-label="Checks that ran">
            {MEET_REV.checks.map((c) => (
              <li key={c.label} className={c.status === "done" ? "is-done" : "is-missing"}>
                {c.status === "done" ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : <CircleSlash size={12} aria-hidden="true" />}
                {c.label}
                {"note" in c ? <em>{c.note}</em> : null}
              </li>
            ))}
          </ul>
        </RevMessage>
      );
    case "verify":
      return (
        <RevMessage pill="Evidence verified">
          <p className="mr-lead">{t.verify.lead}</p>
          <ul className="mr-list mr-list--facts">
            {t.verify.facts.map((f) => (
              <li key={f.text}>
                {f.text} <Cite n={f.cite} />
              </li>
            ))}
          </ul>
          <Chart />
          <p className="mr-sources">
            Sources:
            {MEET_REV.sources.map((s) => (
              <span key={s.n} className="mr-source">
                <b>{s.n}</b>
                {s.label}
              </span>
            ))}
          </p>
        </RevMessage>
      );
    case "interpret":
      return (
        <RevMessage>
          <p className="mr-lead">
            <span className="mr-tag">Not verified</span>
            {t.interpret.lead}
          </p>
          <ul className="mr-list mr-list--hyp">
            {t.interpret.hypotheses.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
          <p className="mr-lead mr-lead--sub">{t.interpret.gapsLead}</p>
          <ul className="mr-list mr-list--gap">
            {t.interpret.unknowns.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </RevMessage>
      );
    case "recommend":
      return (
        <RevMessage>
          <p className="mr-lead">{t.recommend.lead}</p>
          <ol className="mr-recs">
            {t.recommend.recommendations.map((r) => (
              <li key={r.label}>
                <strong>{r.label}</strong>, {r.why}
              </li>
            ))}
          </ol>
          <p className="mr-note">
            <Check size={12} strokeWidth={2.5} aria-hidden="true" />
            {t.recommend.note}
          </p>
        </RevMessage>
      );
  }
}

function Conversation() {
  const windowRef = useRef<HTMLElement>(null);
  const timer = useRef<number>();
  // Index of the latest exchange shown, and whether Rev is still working on it.
  const [turn, setTurn] = useState(0);
  const [pending, setPending] = useState(true);
  const [started, setStarted] = useState(false);

  const answerAfter = useCallback((ms: number) => {
    window.clearTimeout(timer.current);
    if (ms <= 0 || prefersReducedMotion()) {
      setPending(false);
      return;
    }
    setPending(true);
    timer.current = window.setTimeout(() => setPending(false), ms);
  }, []);

  // Answer the first question once the window is on screen.
  useEffect(() => {
    const el = windowRef.current;
    if (!el || started) return;
    if (typeof IntersectionObserver === "undefined" || prefersReducedMotion()) {
      setStarted(true);
      answerAfter(0);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          setStarted(true);
          answerAfter(INVESTIGATE_MS);
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [answerAfter, started]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const current = ORDER[turn];
  const next = NEXT_REPLY[current];
  let reply: ReactNode = <Reply id={current} />;
  if (pending) reply = turn > 0 ? <Typing /> : started ? <Investigating /> : null;

  const send = (id: TurnId) => {
    setTurn(ORDER.indexOf(id));
    answerAfter(TYPING_MS);
  };
  const restart = () => {
    setTurn(0);
    answerAfter(INVESTIGATE_MS);
  };

  return (
    <figure ref={windowRef} className="mr-window" aria-label={`Example Rev conversation. ${MEET_REV.sampleLabel}.`}>
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
      </div>

      <div className="mr-thread" role="log" aria-live="polite" aria-label="Conversation with Rev">
        {/* The previous exchange stays as faded context; the current one is the focus. */}
        {turn > 0 ? (
          <div className="mr-past" aria-hidden="true">
            <div className="mr-turn">
              <UserMessage>{MEET_REV.turns[ORDER[turn - 1]].user}</UserMessage>
              <Reply id={ORDER[turn - 1]} />
            </div>
          </div>
        ) : null}
        <div key={current} className="mr-turn mr-turn--current" data-step={current}>
          <UserMessage>{MEET_REV.turns[current].user}</UserMessage>
          {reply}
        </div>
      </div>

      <div className="mr-composer">
        <div className="mr-suggest" data-ready={!pending ? "" : undefined}>
          {next ? (
            <>
              <button type="button" className="mr-chip" disabled={pending} onClick={() => send(next)}>
                {MEET_REV.turns[next].user}
              </button>
              <span className="mr-hint">{MEET_REV.hint}</span>
            </>
          ) : (
            <button type="button" className="mr-chip mr-chip--ghost" disabled={pending} onClick={restart}>
              <RotateCcw size={12} aria-hidden="true" />
              {MEET_REV.restart}
            </button>
          )}
        </div>
        <div className="mr-input" aria-hidden="true">
          <span>{MEET_REV.inputPlaceholder}</span>
          <i>
            <ArrowUp size={14} strokeWidth={2.4} />
          </i>
        </div>
      </div>
    </figure>
  );
}

export function MeetRevSection({ id }: { id?: string }) {
  const intro = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  useReveal(intro);
  useReveal(stage);

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
            className="fx-up mx-auto mt-3 max-w-[34rem] text-[0.92rem] leading-relaxed text-ink-muted [text-wrap:pretty] sm:text-[0.98rem]"
            style={vars({ "--i": 2 })}
          >
            {MEET_REV.description}
          </p>
        </div>

        <div ref={stage} className="mr-stage">
          <Conversation />
        </div>
      </div>
    </section>
  );
}
