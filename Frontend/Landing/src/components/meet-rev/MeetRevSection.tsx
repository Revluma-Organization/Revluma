import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleSlash,
  Copy,
  LayoutGrid,
  Loader2,
  Mic,
  Phone,
  Plug,
  Plus,
  RotateCcw,
  Send,
  ShieldCheck,
  Square,
  ThumbsDown,
  ThumbsUp,
  Volume2,
} from "lucide-react";
import { MEET_REV } from "@/content";
import { useReveal } from "@/useReveal";
import orbStill from "@/assets/rev-orb.png";
import orbAnimated from "@/assets/rev-orb.webp";
import revlumaIcon from "@/assets/revluma-icon.png";

/**
 * "Meet Rev": a mock of the real Rev Intelligence chat (Frontend/Dashboard
 * RevIntell + RevAnswerView), with sample data that is clearly labelled.
 *
 * Same surfaces as the app: the dark workspace sidebar, the breadcrumb bar,
 * indigo user bubbles, Rev answers as plain text with the evidence pill,
 * "Facts" / "Hypotheses (not verified)" / "Unknowns and limits" sections,
 * citation markers, "Sources:", the "How I checked" disclosure,
 * "Recommended next steps", follow-up chips, the action row, the orb loader
 * with the investigation card, and the composer with its stop button.
 *
 * The visitor drives it one exchange at a time by tapping Rev's follow-up
 * chip, exactly as in the app. Only the current exchange is in focus; the
 * one before stays above it, faded, like a scrolled conversation. Reduced
 * motion shows each answer immediately.
 */

type TurnId = keyof typeof MEET_REV.turns;
const ORDER: TurnId[] = ["ask", "verify", "interpret", "recommend"];
const INVESTIGATE_MS = 2600;
const THINK_MS = 1500;

const vars = (v: Record<string, string | number>) => v as CSSProperties;

function prefersReducedMotion() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function Orb({ size, glow = false }: { size: number; glow?: boolean }) {
  return (
    <picture className={`mr-orb${glow ? " mr-orb--glow" : ""}`} style={{ width: size, height: size }}>
      <source srcSet={orbStill} media="(prefers-reduced-motion: reduce)" />
      <img src={orbAnimated} alt="" width={size} height={size} loading="lazy" decoding="async" />
    </picture>
  );
}

/* ---- App chrome ------------------------------------------------------------ */

function Sidebar() {
  return (
    <aside className="mr-side" aria-hidden="true">
      <div className="mr-side__brand">
        <img src={revlumaIcon} alt="" width={22} height={22} />
        Revluma
      </div>
      <p className="mr-side__label">Workspace</p>
      <span className="mr-side__item">
        <LayoutGrid size={16} />
        Command Center
      </span>
      <span className="mr-side__item is-active">
        <Orb size={20} />
        Rev Intell
        <b>AI</b>
      </span>
      <span className="mr-side__item">
        <Plug size={16} />
        Integrations
      </span>
      <div className="mr-side__user">
        <i>S</i>
        <span>
          Sample merchant
          <em>sample-store</em>
        </span>
      </div>
    </aside>
  );
}

function Topbar() {
  return (
    <div className="mr-top">
      <p className="mr-crumbs" aria-hidden="true">
        Dashboard <span>/</span> <strong>Rev Intelligence</strong>
      </p>
      <span className="mr-tag">{MEET_REV.sampleLabel}</span>
      <span className="mr-revpill" aria-hidden="true">
        <Orb size={16} />
        Rev Intell
      </span>
    </div>
  );
}

function Composer({ busy }: { busy: boolean }) {
  return (
    <div className="mr-dock" aria-hidden="true">
      <div className="mr-input">
        <p>{MEET_REV.inputPlaceholder}</p>
        <div className="mr-input__bar">
          <Plus size={18} />
          <span className="mr-input__right">
            <Mic size={15} />
            <Phone size={15} />
            {busy ? (
              <i className="mr-send mr-send--stop">
                <Square size={11} fill="currentColor" />
              </i>
            ) : (
              <i className="mr-send">
                <Send size={14} />
              </i>
            )}
          </span>
        </div>
      </div>
      <p className="mr-footer">{MEET_REV.footer}</p>
    </div>
  );
}

/* ---- Messages -------------------------------------------------------------- */

function UserBubble({ children }: { children: ReactNode }) {
  return (
    <div className="mr-user">
      <p>{children}</p>
    </div>
  );
}

function Marker({ n }: { n: number }) {
  const source = MEET_REV.sources.find((s) => s.n === n);
  return (
    <span className="mr-marker" title={source ? `Source ${n}: ${source.label}` : undefined}>
      <span className="sr-only">(source </span>
      {n}
      <span className="sr-only">)</span>
    </span>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="mr-sec">
      <h3>{label}</h3>
      <ul>{children}</ul>
    </section>
  );
}

function Sources() {
  return (
    <div className="mr-sources" aria-label="Evidence cited in this answer">
      <span>Sources:</span>
      {MEET_REV.sources.map((s) => (
        <span key={s.n} className="mr-source">
          <b>{s.n}.</b>
          {s.label}
        </span>
      ))}
    </div>
  );
}

function ActionRow() {
  return (
    <div className="mr-actions" aria-hidden="true">
      <span>
        <Copy size={11} />
        Copy
      </span>
      <span>
        <Volume2 size={11} />
        Read aloud
      </span>
      <span>
        <ThumbsUp size={11} />
      </span>
      <span>
        <ThumbsDown size={11} />
      </span>
      <span>
        <RotateCcw size={11} />
        Ask again
      </span>
    </div>
  );
}

function CheckIcon({ status }: { status: string }) {
  return status === "completed" ? <Check size={13} strokeWidth={3} className="is-done" /> : <CircleSlash size={12} className="is-missing" />;
}

/** The investigation card Rev shows while it works (InvestigationTimeline). */
function Investigation({ done }: { done: number }) {
  const total = MEET_REV.checks.length;
  const shown = MEET_REV.checks.slice(0, done);
  const unavailable = shown.filter((c) => c.status !== "completed").length;
  const complete = shown.length - unavailable;
  return (
    <div className="mr-inv">
      <div className="mr-inv__head">
        <Loader2 size={14} className="mr-spin" />
        <strong>Investigating your store evidence</strong>
        <span>
          {complete}/{total} checks{unavailable ? ` · ${unavailable} unavailable` : ""}
        </span>
        <ChevronDown size={14} className="mr-inv__chev" />
      </div>
      <ul>
        {shown.map((c) => (
          <li key={c.label}>
            <CheckIcon status={c.status} />
            {c.label}
            {"note" in c ? <em>{c.note}</em> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Pending({ id, done }: { id: TurnId; done: number }) {
  return (
    <div className="mr-rev" role="status" aria-label="Rev is preparing a response">
      <Orb size={46} glow />
      {id === "ask" ? <Investigation done={done} /> : <p className="mr-working">{MEET_REV.turns[id].working}</p>}
    </div>
  );
}

function FollowUp({ label, onClick, hint }: { label: string; onClick?: () => void; hint: boolean }) {
  return (
    <div className="mr-follow">
      <button type="button" className="mr-chip" onClick={onClick} disabled={!onClick} tabIndex={onClick ? undefined : -1}>
        {label}
        {label === MEET_REV.turns.recommend.followUp ? (
          <RotateCcw size={12} aria-hidden="true" />
        ) : (
          <ArrowUpRight size={13} strokeWidth={1.8} aria-hidden="true" />
        )}
      </button>
      {hint ? <span className="mr-hint">{MEET_REV.hint}</span> : null}
    </div>
  );
}

function Answer({ id, onFollowUp }: { id: TurnId; onFollowUp?: () => void }) {
  const t = MEET_REV.turns;
  let body: ReactNode;
  switch (id) {
    case "ask":
      body = (
        <>
          <p className="mr-pillrow">
            <span className="mr-state">Partial evidence</span>
            <span>3 of 4 sources checked</span>
          </p>
          <p className="mr-text">{t.ask.summary}</p>
          <details className="mr-how">
            <summary>
              <ShieldCheck size={13} aria-hidden="true" />
              How I checked
              <ChevronDown size={13} className="mr-how__chev" aria-hidden="true" />
            </summary>
            <div>
              <p className="mr-how__label">Checks that ran</p>
              <ul aria-label="Checks that ran">
                {MEET_REV.checks.map((c) => (
                  <li key={c.label}>
                    <CheckIcon status={c.status} />
                    {c.label} {c.status === "completed" ? "completed" : <em>unavailable · {"note" in c ? c.note : ""}</em>}
                  </li>
                ))}
              </ul>
            </div>
          </details>
        </>
      );
      break;
    case "verify":
      body = (
        <>
          <p className="mr-text">{t.verify.lead}</p>
          <div className="mr-text">
            <Section label="Facts">
              {t.verify.facts.map((f) => (
                <li key={f.text}>
                  {f.text}
                  <Marker n={f.cite} />
                </li>
              ))}
            </Section>
          </div>
          <p className="mr-period">{t.verify.period}</p>
          <Sources />
        </>
      );
      break;
    case "interpret":
      body = (
        <>
          <p className="mr-text">{t.interpret.lead}</p>
          <div className="mr-text">
            <Section label="Hypotheses (not verified)">
              {t.interpret.hypotheses.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </Section>
            <Section label="Unknowns and limits">
              {t.interpret.unknowns.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </Section>
          </div>
        </>
      );
      break;
    case "recommend":
      body = (
        <>
          <p className="mr-text">{t.recommend.lead}</p>
          <div className="mr-recs">
            <p className="mr-recs__label">Recommended next steps</p>
            <p className="mr-recs__note">{t.recommend.note}</p>
            {t.recommend.recommendations.map((r) => (
              <div key={r.label} className="mr-rec">
                <Check size={13} aria-hidden="true" />
                <div>
                  <p className="mr-rec__label">{r.label}</p>
                  <p className="mr-rec__why">
                    {r.why}
                    {"measure" in r ? ` Measure: ${r.measure}` : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </>
      );
      break;
  }
  return (
    <article className="mr-rev mr-rev--answer">
      {body}
      {onFollowUp ? (
        <>
          <FollowUp label={t[id].followUp} onClick={onFollowUp} hint={id === "ask"} />
          <ActionRow />
        </>
      ) : null}
    </article>
  );
}

/* ---- Conversation ---------------------------------------------------------- */

function Conversation() {
  const appRef = useRef<HTMLElement>(null);
  const timers = useRef<number[]>([]);
  const [turn, setTurn] = useState(0);
  const [pending, setPending] = useState(true);
  const [started, setStarted] = useState(false);
  const [checksDone, setChecksDone] = useState(0);

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  const run = useCallback((index: number) => {
    clearTimers();
    setTurn(index);
    if (prefersReducedMotion()) {
      setChecksDone(MEET_REV.checks.length);
      setPending(false);
      return;
    }
    setPending(true);
    if (index === 0) {
      setChecksDone(0);
      MEET_REV.checks.forEach((_, i) => timers.current.push(window.setTimeout(() => setChecksDone(i + 1), 450 + i * 480)));
    }
    timers.current.push(window.setTimeout(() => setPending(false), index === 0 ? INVESTIGATE_MS : THINK_MS));
  }, []);

  // Rev answers the first question once the window is on screen.
  useEffect(() => {
    const el = appRef.current;
    if (!el || started) return;
    if (typeof IntersectionObserver === "undefined" || prefersReducedMotion()) {
      setStarted(true);
      setChecksDone(MEET_REV.checks.length);
      setPending(false);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          setStarted(true);
          run(0);
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [run, started]);

  useEffect(() => clearTimers, []);

  const current = ORDER[turn];
  const next = turn < ORDER.length - 1 ? turn + 1 : 0;

  let reply: ReactNode = null;
  if (!pending) reply = <Answer id={current} onFollowUp={() => run(next)} />;
  else if (started) reply = <Pending id={current} done={checksDone} />;

  return (
    <figure ref={appRef} className="mr-app" aria-label={`Example Rev Intelligence conversation. ${MEET_REV.sampleLabel}.`}>
      <Sidebar />
      <div className="mr-main">
        <Topbar />
        <div className="mr-chat" role="log" aria-live="polite" aria-label="Conversation with Rev">
          <div className="mr-thread">
            {turn > 0 ? (
              <div className="mr-past" aria-hidden="true">
                <UserBubble>{MEET_REV.turns[ORDER[turn - 1]].user}</UserBubble>
                <Answer id={ORDER[turn - 1]} />
              </div>
            ) : null}
            <div key={current} className="mr-turn" data-step={current}>
              <UserBubble>{MEET_REV.turns[current].user}</UserBubble>
              {reply}
            </div>
          </div>
        </div>
        <Composer busy={pending && started} />
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
      <div className="relative mx-auto max-w-[1160px] px-4 sm:px-8">
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
            className="fx-up mx-auto mt-3 max-w-[38rem] text-[0.92rem] leading-relaxed text-ink-muted [text-wrap:pretty] sm:text-[0.98rem]"
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
