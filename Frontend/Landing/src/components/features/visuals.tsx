import { Bell, Check, CircleCheck, CircleHelp, Eye, LayoutDashboard, Lightbulb, Plug, Radar, Settings, ShieldCheck, Sparkles } from "lucide-react";
import { Cite, ConfidencePill, Kicker, Meter, ProductWindow, SeverityPill, row, type Severity } from "./primitives";

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
  state: string;
  impact: 1 | 2 | 3;
}[] = [
  {
    severity: "high",
    title: "Refunds rising in Summer Linen",
    category: "Refunds",
    when: "2h ago",
    state: "New discovery",
    impact: 3,
  },
  {
    severity: "medium",
    title: "Fewer mobile checkouts completing",
    category: "Checkouts",
    when: "Yesterday",
    state: "Ongoing",
    impact: 2,
  },
  {
    severity: "medium",
    title: "Best seller close to selling out",
    category: "Inventory",
    when: "Today",
    state: "New discovery",
    impact: 2,
  },
];

const SIGNALS: {
  text: string;
  source: string;
  when: string;
  life: "new" | "ongoing" | "resolved";
}[] = [
  {
    text: "Refund requests above their usual level",
    source: "Refunds",
    when: "12m",
    life: "new",
  },
  {
    text: "Mobile checkout completions below baseline",
    source: "Checkouts",
    when: "1h",
    life: "ongoing",
  },
  {
    text: "Linen Shirt stock falling faster than usual",
    source: "Inventory",
    when: "3h",
    life: "new",
  },
  {
    text: "Discount code use back to normal",
    source: "Orders",
    when: "1d",
    life: "resolved",
  },
];

export function DetectVisual() {
  return (
    <>
      <ProductWindow app="Command Center">
        <div className="fx-cc">
          <nav className="fx-cc__rail" aria-hidden="true">
            <i className="is-active">
              <LayoutDashboard size={14} />
            </i>
            <i>
              <Sparkles size={14} />
            </i>
            <i>
              <Plug size={14} />
            </i>
            <i>
              <Settings size={14} />
            </i>
          </nav>
          <div className="fx-cc__main">
            <div className="fx-cc__head fx-in" style={row(0)}>
              <div>
                <Kicker>Business posture</Kicker>
                <p className="fx-cc__posture">
                  <i aria-hidden="true" />
                  Attention needed
                </p>
              </div>
              <span className="fx-chip">
                <Radar size={12} aria-hidden="true" />
                Updated just now
              </span>
            </div>

            <div className="fx-cc__grid">
              <section className="fx-panel">
                <header className="fx-panel__head">
                  <h4>Detected issues</h4>
                  <span>3 open</span>
                </header>
                <ul className="fx-cc__issues">
                  {ISSUES.map((issue, i) => (
                    <li key={issue.title} className="fx-in" style={row(i + 1)}>
                      <div className="fx-cc__issue-top">
                        <SeverityPill level={issue.severity} />
                        <span className="fx-cc__state">{issue.state}</span>
                      </div>
                      <p className="fx-cc__issue-title">{issue.title}</p>
                      <div className="fx-cc__issue-meta">
                        <span>
                          {issue.category} · Detected {issue.when}
                        </span>
                        <Meter label="Impact" level={issue.impact} />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="fx-panel fx-cc__signals">
                <header className="fx-panel__head">
                  <h4>Recent signals</h4>
                  <span className="fx-live">
                    <i aria-hidden="true" />
                    Watching
                  </span>
                </header>
                <ul>
                  {SIGNALS.map((signal, i) => (
                    <li key={signal.text} className={`fx-in fx-signal fx-signal--${signal.life}`} style={row(i + 2)}>
                      <i aria-hidden="true" />
                      <div>
                        <p>{signal.text}</p>
                        <span>
                          {signal.source} · {signal.when}
                        </span>
                      </div>
                      <b>{signal.life}</b>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>
        </div>
      </ProductWindow>
      <div className="fx-callout fx-callout--detect" aria-hidden="true">
        <span className="fx-callout__icon">
          <Bell size={14} />
        </span>
        <div className="fx-callout__text">
          <b>New signal detected</b>
          <span>Refund requests above their usual level</span>
        </div>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------------------
 * 02 Investigate: Rev Intelligence
 * ------------------------------------------------------------------------- */

const CHECKS = ["Orders", "Refunds", "Products", "Customers"];
const FACTORS = ["Fit-related return reasons", "Concentrated in one collection", "Size guidance differs from other collections"];

export function InvestigateVisual() {
  return (
    <>
      <ProductWindow
        app="Rev Intelligence"
        status={
          <span className="fx-status fx-status--ok">
            <CircleCheck size={12} aria-hidden="true" />
            Investigation complete
          </span>
        }
      >
        <div className="fx-rev">
          <p className="fx-rev__ask fx-in" style={row(0)}>
            Why are refunds rising in Summer Linen?
          </p>

          <div className="fx-rev__issue fx-in" style={row(1)}>
            <div>
              <Kicker>Business issue</Kicker>
              <p>Refunds rising in the Summer Linen collection</p>
            </div>
            <SeverityPill level="high" />
          </div>

          <div className="fx-rev__checks fx-in" style={row(2)}>
            <Kicker>Checks that ran</Kicker>
            <ul>
              {CHECKS.map((check, i) => (
                <li key={check} style={row(i)}>
                  <Check size={11} strokeWidth={3} aria-hidden="true" />
                  {check}
                </li>
              ))}
            </ul>
          </div>

          <div className="fx-rev__cols">
            <div className="fx-rev__factors fx-in" style={row(3)}>
              <Kicker>Contributing factors</Kicker>
              <ul>
                {FACTORS.map((factor) => (
                  <li key={factor}>{factor}</li>
                ))}
              </ul>
            </div>

            <div className="fx-rev__findings">
              <div className="fx-finding fx-finding--fact fx-in" style={row(4)}>
                <b>
                  <Check size={11} strokeWidth={3} aria-hidden="true" /> Verified fact
                </b>
                <p>
                  Refunds are concentrated in Summer Linen. <Cite n={1} />
                </p>
                <p>
                  Fit is the most common return reason there. <Cite n={2} />
                </p>
              </div>
              <div className="fx-finding fx-finding--hypothesis fx-in" style={row(5)}>
                <b>
                  <Lightbulb size={11} aria-hidden="true" /> Hypothesis
                </b>
                <p>
                  Size guidance on these products may be unclear. <Cite n={3} />
                </p>
              </div>
              <div className="fx-finding fx-finding--unknown fx-in" style={row(6)}>
                <b>
                  <CircleHelp size={11} aria-hidden="true" /> Unknown
                </b>
                <p>Return reasons are missing for some orders.</p>
              </div>
            </div>
          </div>
        </div>
      </ProductWindow>
      <div className="fx-callout fx-callout--evidence" aria-hidden="true">
        <Kicker>Evidence record</Kicker>
        <p>
          <Cite n={2} label="Refunds · return reasons" />
        </p>
        <span className="fx-callout__meta">
          <ShieldCheck size={12} />
          Evidence verified · Compared with the previous period
        </span>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------------------
 * 03 Prioritize: Top priorities
 * ------------------------------------------------------------------------- */

const PRIORITIES: {
  severity: Severity;
  confidence: "high" | "moderate" | "low";
  title: string;
  impact: 1 | 2 | 3;
  urgency: 1 | 2 | 3;
  evidence: 1 | 2 | 3;
}[] = [
  {
    severity: "high",
    confidence: "high",
    title: "Refunds rising in Summer Linen",
    impact: 3,
    urgency: 3,
    evidence: 3,
  },
  {
    severity: "medium",
    confidence: "moderate",
    title: "Fewer mobile checkouts completing",
    impact: 2,
    urgency: 2,
    evidence: 2,
  },
  {
    severity: "medium",
    confidence: "high",
    title: "Best seller close to selling out",
    impact: 2,
    urgency: 1,
    evidence: 3,
  },
  {
    severity: "low",
    confidence: "low",
    title: "Repeat purchases slowing",
    impact: 1,
    urgency: 1,
    evidence: 1,
  },
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
          <span className="fx-chip">
            <i className="fx-dot" aria-hidden="true" />4 ranked
          </span>
        </header>

        <div className="fx-prio__legend fx-in" style={row(0)} aria-hidden="true">
          <span>Ranked by</span>
          <b>Impact</b>
          <b>Urgency</b>
          <b>Evidence</b>
        </div>

        <ol className="fx-prio__list">
          {PRIORITIES.map((item, i) => (
            <li key={item.title} className={`fx-prio__item fx-in${i === 0 ? " is-first" : ""}`} style={row(i + 1)}>
              <span className="fx-prio__rank">
                {String(i + 1).padStart(2, "0")}
                {i === 0 && <em>First</em>}
              </span>
              <div className="fx-prio__main">
                <div className="fx-prio__pills">
                  <SeverityPill level={item.severity} />
                  <ConfidencePill level={item.confidence} />
                </div>
                <p className="fx-prio__title">{item.title}</p>
                {i === 0 && (
                  <div className="fx-prio__why">
                    <Kicker>Why this is ranked here</Kicker>
                    <ul>
                      {WHY_FIRST.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <div className="fx-prio__meters">
                <Meter label="Impact" level={item.impact} />
                <Meter label="Urgency" level={item.urgency} />
                <Meter label="Evidence" level={item.evidence} />
              </div>
            </li>
          ))}
        </ol>
      </div>
    </ProductWindow>
  );
}

/* ---------------------------------------------------------------------------
 * 04 Advise & Monitor: recommendation + monitoring
 * ------------------------------------------------------------------------- */

const STEPS = ["Recommended", "Reviewed", "Monitoring", "Verified"];
const CURRENT_STEP = 2;

const WATCHING: {
  label: string;
  state: string;
  tone: "good" | "flat" | "warn";
  history: ("warn" | "flat" | "good")[];
}[] = [
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
        <section className="fx-adv__rec fx-in" style={row(0)}>
          <p className="fx-adv__label">
            <CircleCheck size={13} aria-hidden="true" />
            Recommended next step
          </p>
          <p className="fx-adv__step">Review size guidance on Summer Linen product pages</p>
          <p className="fx-adv__why">
            <b>Why it matters: </b>
            fit is the most common return reason in this collection, and its size guidance differs from your other collections.
          </p>
          <div className="fx-adv__evidence">
            <span>Evidence</span>
            <Cite n={1} label="Refunds" />
            <Cite n={2} label="Return reasons" />
            <Cite n={3} label="Products" />
          </div>
          <p className="fx-adv__verify">
            <b>What to verify: </b>
            refund requests for the collection move back toward their usual level.
          </p>
        </section>

        <ol className="fx-adv__steps fx-in" style={row(1)} aria-label="Progress">
          {STEPS.map((step, i) => (
            <li key={step} className={i < CURRENT_STEP ? "is-done" : i === CURRENT_STEP ? "is-current" : ""} style={row(i)}>
              <i aria-hidden="true">{i < CURRENT_STEP ? <Check size={10} strokeWidth={3.5} /> : null}</i>
              {step}
            </li>
          ))}
        </ol>

        <section className="fx-panel fx-adv__mon fx-in" style={row(2)}>
          <header className="fx-panel__head">
            <h4>
              <Eye size={13} aria-hidden="true" />
              Monitoring
            </h4>
            <span>Last 7 syncs</span>
          </header>
          <ul>
            {WATCHING.map((signal, s) => (
              <li key={signal.label}>
                <span className="fx-adv__signal">{signal.label}</span>
                <span className="fx-adv__history" aria-hidden="true">
                  {signal.history.map((h, d) => (
                    <i key={d} className={`is-${h}`} style={row(s * 3 + d)} />
                  ))}
                </span>
                <b className={`fx-adv__state fx-adv__state--${signal.tone}`}>{signal.state}</b>
              </li>
            ))}
          </ul>
        </section>

        <p className="fx-adv__foot">
          <ShieldCheck size={12} aria-hidden="true" />
          Review only · Revluma will not change your store
        </p>
      </div>
    </ProductWindow>
  );
}
