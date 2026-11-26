import {
  ArrowDownWideNarrow,
  Bell,
  Check,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Eye,
  FileText,
  LayoutDashboard,
  Lightbulb,
  Minus,
  Plug,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import orb from "@/assets/rev-orb.png";
import { Cite, Kicker, Meter, ProductWindow, SeverityMark, row, vars, type Severity } from "./primitives";

/*
 * One coherent sample store runs through all four visuals: refunds rising in
 * a "Summer Linen" collection is detected (01), investigated (02), ranked
 * first (03) and turned into a recommended next step that is monitored (04).
 * Labels and states come from the app; there are no money figures.
 */

/* ---------------------------------------------------------------------------
 * 01 Detect: the Command Center
 * ------------------------------------------------------------------------- */

const ISSUES: {
  severity: Severity;
  title: string;
  category: string;
  when: string;
  isNew: boolean;
  impact: 1 | 2 | 3;
}[] = [
  { severity: "high", title: "Refunds rising in Summer Linen", category: "Refunds", when: "2h ago", isNew: true, impact: 3 },
  { severity: "medium", title: "Fewer mobile checkouts completing", category: "Checkouts", when: "yesterday", isNew: false, impact: 2 },
  { severity: "medium", title: "Best seller close to selling out", category: "Inventory", when: "today", isNew: true, impact: 2 },
];

type Life = "new" | "ongoing" | "resolved";
const LIFE_WORD: Record<Life, string> = { new: "New", ongoing: "Ongoing", resolved: "Resolved" };

const SIGNALS: { text: string; source: string; when: string; life: Life }[] = [
  { text: "Refund requests above their usual level", source: "Refunds", when: "12m", life: "new" },
  { text: "Mobile checkout completions below baseline", source: "Checkouts", when: "1h", life: "ongoing" },
  { text: "Linen Shirt stock falling faster than usual", source: "Inventory", when: "3h", life: "new" },
  { text: "Discount code use back to normal", source: "Orders", when: "1d", life: "resolved" },
];

const KPIS: { label: string; value: number; of?: number; note: string }[] = [
  { label: "Open issues", value: 3, note: "1 high priority" },
  { label: "New signals", value: 2, note: "In the last 3 hours" },
  { label: "Sources", value: 4, of: 4, note: "All synced and up to date" },
];

export function DetectVisual() {
  return (
    <>
      <ProductWindow app="Command Center">
        <div className="fx-cc">
          <nav className="fx-cc__rail" aria-hidden="true">
            <i className="is-active">
              <LayoutDashboard size={14} strokeWidth={1.75} />
            </i>
            <i>
              <Sparkles size={14} strokeWidth={1.75} />
            </i>
            <i>
              <Plug size={14} strokeWidth={1.75} />
            </i>
            <i>
              <Settings size={14} strokeWidth={1.75} />
            </i>
          </nav>

          <div className="fx-cc__main">
            <header className="fx-cc__head fx-in" style={row(0)}>
              <div>
                <h4>Overview</h4>
                <p className="fx-cc__sync">
                  <i aria-hidden="true" />
                  Updated just now
                </p>
              </div>
              <p className="fx-posture">
                <TriangleAlert size={12} strokeWidth={2} aria-hidden="true" />
                <span className="fx-posture__label">Business posture</span>
                <b>Attention needed</b>
              </p>
            </header>

            <ul className="fx-kpis fx-in" style={row(1)} aria-label="Key figures">
              {KPIS.map((kpi) => (
                <li key={kpi.label}>
                  <span className="fx-kpis__label">{kpi.label}</span>
                  <span className="fx-kpis__value">
                    {kpi.value}
                    {kpi.of && <small> of {kpi.of}</small>}
                  </span>
                  <span className="fx-kpis__note">{kpi.note}</span>
                </li>
              ))}
            </ul>

            <section className="fx-panel fx-in" style={row(2)}>
              <header className="fx-panel__head">
                <h4>Detected issues</h4>
                <span>3 open</span>
              </header>
              <div className="fx-cols" aria-hidden="true">
                <span>Issue</span>
                <span>Impact</span>
              </div>
              <ul className="fx-issues">
                {ISSUES.map((issue, i) => (
                  <li key={issue.title} style={row(i + 3)}>
                    <div>
                      <p className="fx-issues__title">
                        {issue.title}
                        {issue.isNew && <span className="fx-tag">New</span>}
                      </p>
                      <p className="fx-issues__meta">
                        <SeverityMark level={issue.severity} />
                        <span aria-hidden="true">·</span>
                        <span>{issue.category}</span>
                        <span aria-hidden="true">·</span>
                        <span>Detected {issue.when}</span>
                      </p>
                    </div>
                    <Meter label="Impact" level={issue.impact} />
                  </li>
                ))}
              </ul>
            </section>

            <section className="fx-panel fx-in" style={row(3)}>
              <header className="fx-panel__head">
                <h4>Recent signals</h4>
                <span className="fx-live">
                  <i aria-hidden="true" />
                  Watching
                </span>
              </header>
              <ul className="fx-feed">
                {SIGNALS.map((signal) => (
                  <li key={signal.text}>
                    <time>{signal.when}</time>
                    <p>
                      {signal.text}
                      <span>{signal.source}</span>
                    </p>
                    <span className={`fx-state fx-state--${signal.life}`}>
                      <i aria-hidden="true" />
                      {LIFE_WORD[signal.life]}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      </ProductWindow>

      <div className="fx-toast" aria-hidden="true">
        <span className="fx-toast__icon">
          <Bell size={13} strokeWidth={2} />
        </span>
        <div className="fx-toast__text">
          <b>New signal detected</b>
          <span>Refund requests above their usual level</span>
        </div>
        <span className="fx-toast__time">now</span>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------------------
 * 02 Investigate: Rev Intelligence
 * ------------------------------------------------------------------------- */

const CHECKS = ["Orders", "Refunds", "Products", "Customers"];
const FACTORS = ["Fit-related return reasons", "Concentrated in one collection", "Size guidance differs from other collections"];
const SOURCES: { n: number; title: string; detail: string }[] = [
  { n: 1, title: "Refunds", detail: "Summer Linen collection" },
  { n: 2, title: "Refunds · return reasons", detail: "Compared with the previous period" },
  { n: 3, title: "Products", detail: "Size guide content" },
];
const ACTIVE_SOURCE = 2;

export function InvestigateVisual() {
  return (
    <ProductWindow
      app="Rev Intelligence"
      status={
        <span className="fx-status">
          <CircleCheck size={12} strokeWidth={2} aria-hidden="true" />
          Investigation complete
        </span>
      }
    >
      <div className="fx-rev">
        <div className="fx-rev__thread">
          <p className="fx-rev__ask fx-in" style={row(0)}>
            Why are refunds rising in Summer Linen?
          </p>

          <div className="fx-rev__by fx-in" style={row(1)}>
            <img src={orb} alt="" />
            <b>Rev</b>
            <div className="fx-rev__checks">
              <span className="fx-sr">Checks that ran:</span>
              <ul>
                {CHECKS.map((check, i) => (
                  <li key={check} style={row(i)}>
                    <Check size={11} strokeWidth={2.5} aria-hidden="true" />
                    {check}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="fx-rev__issue fx-in" style={row(2)}>
            <div>
              <Kicker>Business issue</Kicker>
              <p>Refunds rising in the Summer Linen collection</p>
            </div>
            <SeverityMark level="high" suffix="priority" />
          </div>

          <div className="fx-rev__factors fx-in" style={row(3)}>
            <Kicker>Contributing factors</Kicker>
            <ol>
              {FACTORS.map((factor) => (
                <li key={factor}>{factor}</li>
              ))}
            </ol>
          </div>

          <div className="fx-findings fx-in" style={row(4)}>
            <div className="fx-finding fx-finding--fact">
              <b>
                <CircleCheck size={12} strokeWidth={2} aria-hidden="true" /> Verified fact
              </b>
              <div>
                <p>
                  Refunds are concentrated in Summer Linen. <Cite n={1} />
                </p>
                <p>
                  Fit is the most common return reason there. <Cite n={2} />
                </p>
              </div>
            </div>
            <div className="fx-finding fx-finding--hypothesis">
              <b>
                <Lightbulb size={12} strokeWidth={2} aria-hidden="true" /> Hypothesis
              </b>
              <div>
                <p>
                  Size guidance on these products may be unclear. <Cite n={3} />
                </p>
              </div>
            </div>
            <div className="fx-finding fx-finding--unknown">
              <b>
                <CircleHelp size={12} strokeWidth={2} aria-hidden="true" /> Unknown
              </b>
              <div>
                <p>Return reasons are missing for some orders.</p>
              </div>
            </div>
          </div>
        </div>

        <aside className="fx-rev__sources fx-in" style={row(5)} aria-label="Evidence record">
          <Kicker>Evidence record</Kicker>
          <ol>
            {SOURCES.map((source) => (
              <li key={source.n} className={source.n === ACTIVE_SOURCE ? "is-active" : undefined}>
                <span className="fx-src__head">
                  <Cite n={source.n} />
                  <span className="fx-src__title">{source.title}</span>
                </span>
                <span className="fx-src__detail">{source.detail}</span>
                <span className="fx-src__ok">
                  <ShieldCheck size={11} strokeWidth={2} aria-hidden="true" />
                  Evidence verified
                </span>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </ProductWindow>
  );
}

/* ---------------------------------------------------------------------------
 * 03 Prioritize: Top priorities
 * ------------------------------------------------------------------------- */

type Confidence = "high" | "moderate" | "low";
const CONFIDENCE_WORD: Record<Confidence, string> = { high: "High", moderate: "Moderate", low: "Low" };

const PRIORITIES: {
  severity: Severity;
  confidence: Confidence;
  title: string;
  category: string;
  impact: 1 | 2 | 3;
  urgency: 1 | 2 | 3;
  evidence: 1 | 2 | 3;
}[] = [
  { severity: "high", confidence: "high", title: "Refunds rising in Summer Linen", category: "Refunds", impact: 3, urgency: 3, evidence: 3 },
  { severity: "medium", confidence: "moderate", title: "Fewer mobile checkouts completing", category: "Checkouts", impact: 2, urgency: 2, evidence: 2 },
  { severity: "medium", confidence: "high", title: "Best seller close to selling out", category: "Inventory", impact: 2, urgency: 1, evidence: 3 },
  { severity: "low", confidence: "low", title: "Repeat purchases slowing", category: "Customers", impact: 1, urgency: 1, evidence: 1 },
];

const WHY_FIRST = ["Affects one of your highest-selling collections", "Refund requests are still increasing", "Backed by verified order and refund evidence"];

export function PrioritizeVisual() {
  return (
    <ProductWindow app="Command Center">
      <div className="fx-prio">
        <header className="fx-prio__head fx-in" style={row(0)}>
          <div>
            <h4>Top priorities</h4>
            <p>The issues Revluma believes deserve attention first</p>
          </div>
          <span className="fx-prio__sort">
            <ArrowDownWideNarrow size={12} strokeWidth={2} aria-hidden="true" />
            Ranked by impact, urgency, evidence
          </span>
        </header>

        <div className="fx-prio__table fx-in" style={row(1)}>
          <div className="fx-prio__cols" aria-hidden="true">
            <span>#</span>
            <span>Issue</span>
            <span>Impact</span>
            <span>Urgency</span>
            <span>Evidence</span>
            <span>Confidence</span>
          </div>
          <ol className="fx-prio__list">
            {PRIORITIES.map((item, i) => (
              <li key={item.title} className={`fx-prio__item${i === 0 ? " is-first" : ""}`} style={row(i + 2)}>
                <span className="fx-prio__rank">{String(i + 1).padStart(2, "0")}</span>
                <div className="fx-prio__main">
                  <p className="fx-prio__title">{item.title}</p>
                  <p className="fx-prio__meta">
                    <SeverityMark level={item.severity} suffix="priority" />
                    <span aria-hidden="true">·</span>
                    <span>{item.category}</span>
                  </p>
                </div>
                <div className="fx-prio__scores">
                  <Meter label="Impact" level={item.impact} />
                  <Meter label="Urgency" level={item.urgency} />
                  <Meter label="Evidence" level={item.evidence} />
                  <span className={`fx-conf fx-conf--${item.confidence}`}>
                    {CONFIDENCE_WORD[item.confidence]}
                    <span className="fx-conf__suffix"> confidence</span>
                  </span>
                </div>
                {i === 0 && (
                  <div className="fx-prio__why">
                    <Kicker>Why this is ranked here</Kicker>
                    <ul>
                      {WHY_FIRST.map((reason) => (
                        <li key={reason}>
                          <Check size={11} strokeWidth={2.5} aria-hidden="true" />
                          {reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </ProductWindow>
  );
}

/* ---------------------------------------------------------------------------
 * 04 Advise & Monitor: recommendation + monitoring
 * ------------------------------------------------------------------------- */

const STEPS = ["Recommended", "Reviewed", "Monitoring", "Verified"];
const CURRENT_STEP = 2;

type Tone = "good" | "flat" | "warn";
const TONE_ICON: Record<Tone, LucideIcon> = { good: TrendingUp, flat: Minus, warn: CircleAlert };
const SYNC_WORD: Record<Tone, string> = { good: "improving", flat: "no change", warn: "needs attention" };

const WATCHING: { label: string; state: string; tone: Tone; history: Tone[] }[] = [
  {
    label: "Refund requests · Summer Linen",
    state: "Improving",
    tone: "good",
    history: ["warn", "warn", "warn", "flat", "good", "good", "good"],
  },
  {
    label: "Fit-related return reasons",
    state: "No change yet",
    tone: "flat",
    history: ["warn", "warn", "warn", "warn", "flat", "flat", "flat"],
  },
  {
    label: "Mobile checkout completion",
    state: "Needs attention",
    tone: "warn",
    history: ["flat", "flat", "warn", "warn", "warn", "warn", "warn"],
  },
];

export function AdviseVisual() {
  return (
    <ProductWindow app="Rev Intelligence">
      <div className="fx-adv">
        <section className="fx-rec fx-in" style={row(0)}>
          <p className="fx-rec__label">
            <Sparkles size={12} strokeWidth={2} aria-hidden="true" />
            Recommended next step
          </p>
          <p className="fx-rec__step">Review size guidance on Summer Linen product pages</p>
          <p className="fx-rec__why">
            <b>Why it matters: </b>
            fit is the most common return reason in this collection, and its size guidance differs from your other collections.
          </p>
          <div className="fx-rec__evidence">
            <span>
              <FileText size={11} strokeWidth={2} aria-hidden="true" />
              Evidence
            </span>
            <Cite n={1} label="Refunds" />
            <Cite n={2} label="Return reasons" />
            <Cite n={3} label="Products" />
          </div>
          <p className="fx-rec__verify">
            <Target size={13} strokeWidth={2} aria-hidden="true" />
            <span>
              <b>What to verify: </b>
              refund requests for the collection move back toward their usual level.
            </span>
          </p>
        </section>

        <ol className="fx-steps fx-in" style={row(1)} aria-label="Progress">
          {STEPS.map((step, i) => {
            const state = i < CURRENT_STEP ? "is-done" : i === CURRENT_STEP ? "is-current" : "";
            return (
              <li key={step} className={state} aria-current={i === CURRENT_STEP ? "step" : undefined}>
                <span>
                  {i < CURRENT_STEP && <Check size={11} strokeWidth={2.5} aria-hidden="true" />}
                  {step}
                </span>
              </li>
            );
          })}
        </ol>

        <section className="fx-panel fx-mon fx-in" style={row(2)}>
          <header className="fx-panel__head">
            <h4>
              <Eye size={13} strokeWidth={2} aria-hidden="true" />
              Monitoring
            </h4>
            <span>Last 7 syncs</span>
          </header>
          <ul>
            {WATCHING.map((signal) => {
              const Icon = TONE_ICON[signal.tone];
              return (
                <li key={signal.label}>
                  <span className="fx-mon__label">{signal.label}</span>
                  <span className="fx-hist" role="img" aria-label={`Last 7 syncs: ${signal.history.map((h) => SYNC_WORD[h]).join(", ")}`}>
                    {signal.history.map((h, d) => (
                      <i key={d} className={`is-${h}`} style={vars({ "--d": d })} />
                    ))}
                  </span>
                  <b className={`fx-mon__state fx-mon__state--${signal.tone}`}>
                    <Icon size={12} strokeWidth={2} aria-hidden="true" />
                    {signal.state}
                  </b>
                </li>
              );
            })}
          </ul>
        </section>

        <p className="fx-adv__foot">
          <ShieldCheck size={12} strokeWidth={2} aria-hidden="true" />
          Review only · Revluma will not change your store
        </p>
      </div>
    </ProductWindow>
  );
}
