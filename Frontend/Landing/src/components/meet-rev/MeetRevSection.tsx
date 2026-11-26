import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  ArrowDown,
  Check,
  ChevronDown,
  CircleSlash,
  Copy,
  CornerDownRight,
  EyeOff,
  HelpCircle,
  LayoutGrid,
  Loader2,
  Mic,
  Minus,
  Phone,
  Plug,
  Plus,
  RotateCcw,
  Send,
  ShieldCheck,
  Square,
  Target,
  ThumbsDown,
  ThumbsUp,
  TrendingDown,
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
 * indigo user bubbles, the evidence pill, "Facts" / "Hypotheses (not
 * verified)" / "Unknowns and limits", citation markers, "Sources:", the
 * "How I checked" disclosure, "Recommended next steps", the follow-up chip,
 * the action row, the investigation card and the composer.
 *
 * Answers read like a full analyst reply (see design-system/revluma/pages/
 * landing-meet-rev.md): a one-line answer first, then headed sections with
 * a KPI strip, a daily chart, an order split, an evidence ladder and a
 * numbered plan. Each block unfolds once, top to bottom, like streamed
 * text. The chat pane scrolls like a real conversation and keeps every
 * exchange; "Start over" clears it. Reduced motion shows each answer whole.
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

function Composer({ busy, suggestion }: { busy: boolean; suggestion?: ReactNode }) {
  return (
    <div className="mr-dock">
      {/* Rev's suggested follow-up sits on the composer, always in view, so the
          visitor never has to hunt for the way forward. */}
      <div className="mr-suggest">{suggestion}</div>
      <div className="mr-input" aria-hidden="true">
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
      <p className="mr-footer" aria-hidden="true">
        {MEET_REV.footer}
      </p>
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

function Section({ label, tone, children }: { label: string; tone?: "fact" | "guess" | "limit"; children: ReactNode }) {
  return (
    <section className={`mr-sec${tone ? ` mr-sec--${tone}` : ""}`}>
      <h3>{label}</h3>
      <ul>{children}</ul>
    </section>
  );
}

/** A small heading inside an answer, like the bold section titles in a long chat reply. */
function Heading({ children }: { children: ReactNode }) {
  return <h3 className="mr-h">{children}</h3>;
}

function RevHeader() {
  return (
    <div className="mr-revhead" aria-hidden="true">
      <Orb size={22} />
      <b>Rev</b>
      <span className="mr-ai">AI</span>
    </div>
  );
}

function Sources() {
  return (
    <div className="mr-sources" aria-label="Evidence cited in this answer">
      <span>Sources:</span>
      {MEET_REV.sources.map((s) => (
        <span key={s.n} className="mr-source">
          <b>{s.n}</b>
          <span>
            <strong>{s.label}</strong>
            <em>{s.detail}</em>
          </span>
        </span>
      ))}
    </div>
  );
}

function ActionRow() {
  return (
    <div className="mr-actions" aria-hidden="true">
      <span>
        <Copy size={12} />
        Copy
      </span>
      <span>
        <Volume2 size={12} />
        Read aloud
      </span>
      <span>
        <ThumbsUp size={12} />
      </span>
      <span>
        <ThumbsDown size={12} />
      </span>
      <span>
        <RotateCcw size={12} />
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
        <strong className="mr-shimmer">Investigating your store evidence</strong>
        <span>
          {complete}/{total} checks{unavailable ? ` · ${unavailable} unavailable` : ""}
        </span>
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
    <div className="mr-rev mr-rev--pending" role="status" aria-label="Rev is preparing a response">
      <RevHeader />
      {id === "ask" ? (
        <Investigation done={done} />
      ) : (
        <p className="mr-working">
          <span className="mr-shimmer">{MEET_REV.turns[id].working}</span>
          <span className="mr-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </p>
      )}
    </div>
  );
}

function FollowUp({ label, onClick, hint }: { label: string; onClick?: () => void; hint: boolean }) {
  return (
    <div className="mr-follow">
      <button type="button" className="mr-chip" onClick={onClick} disabled={!onClick} tabIndex={onClick ? undefined : -1}>
        {label === MEET_REV.turns.recommend.followUp ? (
          <RotateCcw size={13} aria-hidden="true" />
        ) : (
          <CornerDownRight size={14} strokeWidth={1.8} aria-hidden="true" />
        )}
        {label}
      </button>
      {hint ? <span className="mr-hint">{MEET_REV.hint}</span> : null}
    </div>
  );
}

/* ---- Rich answer blocks ---------------------------------------------------- */

function Kpis() {
  return (
    <ul className="mr-kpis" aria-label="What changed last week">
      {MEET_REV.turns.ask.kpis.map((k) => (
        <li key={k.label} className={`is-${k.tone}`}>
          <span className="mr-kpi__label">{k.label}</span>
          <span className="mr-kpi__value">
            {k.tone === "down" ? <TrendingDown size={14} aria-hidden="true" /> : <Minus size={14} aria-hidden="true" />}
            {k.value}
          </span>
          <span className="mr-kpi__note">{k.note}</span>
        </li>
      ))}
    </ul>
  );
}

const CHART_MAX = 60;

function DailyChart() {
  const c = MEET_REV.turns.ask.chart;
  const summary = c.days.map((d) => `${d.day} ${d.value}%`).join(", ");
  return (
    <figure className="mr-chart" aria-label={`${c.title}: ${summary}. The week before averaged ${c.baseline}%.`}>
      <figcaption>
        <span>
          <b>{c.title}</b>
          <em>{c.caption}</em>
        </span>
        <span className="mr-chart__flag">{c.callout}</span>
      </figcaption>
      <div className="mr-chart__plot" aria-hidden="true" style={vars({ "--base": c.baseline / CHART_MAX })}>
        <i className="mr-chart__base">
          <span>{c.baseline}%</span>
        </i>
        {c.days.map((d, i) => (
          <div key={d.day} className={`mr-bar${d.value < c.baseline - 5 ? " is-low" : ""}`} style={vars({ "--h": d.value / CHART_MAX, "--i": i })}>
            <span className="mr-bar__val">{d.value}</span>
            <span className="mr-bar__fill" />
            <span className="mr-bar__day">{d.day}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}

function OrderSplit() {
  const s = MEET_REV.turns.verify.split;
  const total = s.parts.reduce((n, p) => n + p.value, 0);
  return (
    <div className="mr-split">
      <p className="mr-split__title">
        {s.title}
        <Marker n={1} />
      </p>
      <div className="mr-split__bar" aria-hidden="true">
        {s.parts.map((p, i) => (
          <span key={p.label} className={i === 0 ? "is-main" : undefined} style={vars({ flexGrow: p.value })} />
        ))}
      </div>
      <ul className="mr-split__legend">
        {s.parts.map((p, i) => (
          <li key={p.label} className={i === 0 ? "is-main" : undefined}>
            <i aria-hidden="true" />
            {p.label}
            <b>
              {p.value} of {total}
            </b>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RuledOut() {
  return (
    <div className="mr-ruled">
      <p className="mr-ruled__title">Ruled out</p>
      <ul>
        {MEET_REV.turns.verify.ruledOut.map((r) => (
          <li key={r.label}>
            <Check size={12} strokeWidth={3} aria-hidden="true" />
            <span>
              <b>{r.label}</b>
              {r.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Ladder() {
  return (
    <ul className="mr-ladder" aria-label="How sure Rev is">
      {MEET_REV.turns.interpret.ladder.map((l, i) => (
        <li key={l.level} className={`is-${i}`}>
          <span className="mr-ladder__level">
            {i === 0 ? (
              <ShieldCheck size={13} aria-hidden="true" />
            ) : i === 1 ? (
              <HelpCircle size={13} aria-hidden="true" />
            ) : (
              <EyeOff size={13} aria-hidden="true" />
            )}
            {l.level}
          </span>
          <span className="mr-ladder__text">{l.text}</span>
        </li>
      ))}
    </ul>
  );
}

function Answer({ id, latest = false }: { id: TurnId; latest?: boolean }) {
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
          <details className="mr-how">
            <summary>
              <ShieldCheck size={13} aria-hidden="true" />
              How I checked
              <span className="mr-how__meta">Orders, checkouts, products</span>
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
          <p className="mr-text mr-lead">{t.ask.summary}</p>
          <Heading>What changed</Heading>
          <Kpis />
          <Heading>When it started</Heading>
          <DailyChart />
          <aside className="mr-callout">
            <b>Bottom line</b>
            <p>{t.ask.takeaway}</p>
          </aside>
        </>
      );
      break;
    case "verify":
      body = (
        <>
          <p className="mr-text mr-lead">{t.verify.lead}</p>
          <div className="mr-text">
            <Section label="Facts" tone="fact">
              {t.verify.facts.map((f) => (
                <li key={f.text}>
                  {f.text}
                  <Marker n={f.cite} />
                </li>
              ))}
            </Section>
          </div>
          <OrderSplit />
          <RuledOut />
          <p className="mr-period">{t.verify.period}</p>
          <Sources />
        </>
      );
      break;
    case "interpret":
      body = (
        <>
          <p className="mr-text mr-lead">{t.interpret.lead}</p>
          <Ladder />
          <div className="mr-text mr-cols">
            <Section label="Hypotheses (not verified)" tone="guess">
              {t.interpret.hypotheses.map((h, i) => (
                <li key={h}>
                  {h}
                  <span className="mr-test">
                    <b>How to check:</b> {t.interpret.tests[i]}
                  </span>
                </li>
              ))}
            </Section>
            <Section label="Unknowns and limits" tone="limit">
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
          <p className="mr-text mr-lead">{t.recommend.lead}</p>
          <div className="mr-recs">
            <p className="mr-recs__label">Recommended next steps</p>
            <ol>
              {t.recommend.recommendations.map((r, i) => (
                <li key={r.label} className={`mr-rec${i === 0 ? " is-first" : ""}`}>
                  <span className="mr-rec__n" aria-hidden="true">
                    {i + 1}
                  </span>
                  <div>
                    <span className="mr-rec__when">{r.when}</span>
                    <p className="mr-rec__label">{r.label}</p>
                    <p className="mr-rec__why">{r.why}</p>
                    {"measure" in r ? (
                      <p className="mr-rec__measure">
                        <Target size={12} aria-hidden="true" />
                        Success looks like: {r.measure}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
            <p className="mr-recs__note">
              <ShieldCheck size={12} aria-hidden="true" />
              {t.recommend.note}
            </p>
          </div>
          <p className="mr-text">{t.recommend.closing}</p>
        </>
      );
      break;
  }
  return (
    <article className="mr-rev mr-rev--answer">
      <RevHeader />
      {body}
      {latest ? <ActionRow /> : null}
    </article>
  );
}

/* ---- Conversation ---------------------------------------------------------- */

function Conversation() {
  const appRef = useRef<HTMLElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const turnRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const [turn, setTurn] = useState(0);
  const [pending, setPending] = useState(true);
  const [started, setStarted] = useState(false);
  const [checksDone, setChecksDone] = useState(0);
  const [below, setBelow] = useState(false);

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

  const measure = useCallback(() => {
    const chat = chatRef.current;
    if (chat) setBelow(chat.scrollHeight - chat.scrollTop - chat.clientHeight > 48);
  }, []);

  // Like a real chat: each new question scrolls up to the top of the window
  // and Rev's answer unfolds beneath it. Only the chat pane scrolls, never the page.
  useEffect(() => {
    const chat = chatRef.current;
    const current = turnRef.current;
    if (!chat || !current) return;
    const top = turn === 0 ? 0 : Math.max(0, current.offsetTop - 12);
    const target = Math.min(top, chat.scrollHeight - chat.clientHeight);
    if (typeof chat.scrollTo === "function") chat.scrollTo({ top: target, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    else chat.scrollTop = target;
    const id = window.setTimeout(measure, 450);
    return () => window.clearTimeout(id);
  }, [turn, pending, measure]);

  const toBottom = () => {
    const chat = chatRef.current;
    if (chat && typeof chat.scrollTo === "function") chat.scrollTo({ top: chat.scrollHeight, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  };

  const current = ORDER[turn];
  const next = turn < ORDER.length - 1 ? turn + 1 : 0;

  let reply: ReactNode = null;
  if (!pending) reply = <Answer id={current} latest />;
  else if (started) reply = <Pending id={current} done={checksDone} />;

  return (
    <figure ref={appRef} className="mr-app" aria-label={`Example Rev Intelligence conversation. ${MEET_REV.sampleLabel}.`}>
      <Sidebar />
      <div className="mr-main">
        <Topbar />
        <div className="mr-chatwrap">
          <div ref={chatRef} className="mr-chat" role="log" aria-live="polite" aria-label="Conversation with Rev" onScroll={measure}>
            <div className="mr-thread">
              {ORDER.slice(0, turn).map((id) => (
                <div key={id} className="mr-exchange mr-exchange--past">
                  <UserBubble>{MEET_REV.turns[id].user}</UserBubble>
                  <Answer id={id} />
                </div>
              ))}
              <div ref={turnRef} key={current} className="mr-exchange mr-turn" data-step={current}>
                <UserBubble>{MEET_REV.turns[current].user}</UserBubble>
                {reply}
              </div>
            </div>
          </div>
          <button
            type="button"
            className={`mr-down${below ? " is-on" : ""}`}
            onClick={toBottom}
            tabIndex={below ? undefined : -1}
            aria-label="Scroll to the latest message"
          >
            <ArrowDown size={15} aria-hidden="true" />
          </button>
        </div>
        <Composer
          busy={pending && started}
          suggestion={!pending ? <FollowUp label={MEET_REV.turns[current].followUp} onClick={() => run(next)} hint={current === "ask"} /> : null}
        />
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
    <section id={id} aria-labelledby="mr-title" className="mr-section relative overflow-hidden overflow-clip py-14 sm:py-16 lg:py-20">
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
