import { useRef, type CSSProperties } from "react";
import { Lightbulb, PlugZap, ScanSearch, type LucideIcon } from "lucide-react";
import { HOW_IT_WORKS } from "@/content";
import { useReveal } from "@/useReveal";

/**
 * "How it works": an infographic of three steps. Small white raised circles
 * carry a line icon each; a gradient path weaves around them (over the first,
 * under the second, over the third) and ends in an arrow, with dashed outlines
 * closing the open sides. Each step's copy sits beneath its circle, left
 * aligned.
 *
 * From 900px the circles and path are one scalable SVG-backed diagram; below
 * that the same steps become a vertical timeline. The intro reuses the
 * features section's eyebrow and reveal classes (fx-*); everything else is in
 * how-it-works.css, and all motion is off with reduced motion.
 */

type StepId = (typeof HOW_IT_WORKS.steps)[number]["id"];

const ICONS: Record<StepId, LucideIcon> = {
  connect: PlugZap,
  analyze: ScanSearch,
  understand: Lightbulb,
};

/* Diagram geometry, in viewBox units, matching the reference: circle centres
   sit at the middle of three equal columns (D apart) and the path is made only
   of arcs around them, each RX = D/2 wide, so neighbouring arcs meet
   tangentially between the circles and the line flows as one smooth S-curve
   (over circle 1, under circle 2, over circle 3) into the arrow. */
const W = 1200;
const CX = [200, 600, 1000] as const;
const D = CX[1] - CX[0];
const RX = D / 2;
const RY = RX; // true circles, as in the reference
const PAD = 22;
const CY = RY + PAD;
const H = 2 * CY;
const NODE = 115; // circle diameter (86px at the 900px diagram width)

const pt = (cx: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  return [cx + RX * Math.cos(a), CY + RY * Math.sin(a)] as const;
};
const f = (n: number) => +n.toFixed(1);
const xy = (p: readonly [number, number]) => `${f(p[0])} ${f(p[1])}`;
const arc = (large: 0 | 1, sweep: 0 | 1, to: readonly [number, number]) => `A ${RX} ${RY} 0 ${large} ${sweep} ${xy(to)}`;

// Angles are measured clockwise from 3 o'clock (SVG y points down).
const START = pt(CX[0], 84); // just right of the bottom of circle 1
const END_DEG = 286; // just past the top of circle 3
const END = pt(CX[2], END_DEG);
const MAIN = [
  `M ${xy(START)}`,
  arc(1, 1, pt(CX[0], 0)), // around the left of circle 1 and over it
  arc(0, 0, pt(CX[1], 0)), // under circle 2
  arc(0, 1, END), // up and over circle 3
].join(" ");

// Arrowhead at the end of the path, along its tangent.
const ARROW = (() => {
  const a = (END_DEG * Math.PI) / 180;
  const t = [-RX * Math.sin(a), RY * Math.cos(a)];
  const len = Math.hypot(t[0], t[1]);
  const dir = [t[0] / len, t[1] / len];
  const nrm = [-dir[1], dir[0]];
  const tip = [END[0] + dir[0] * 22, END[1] + dir[1] * 22];
  const b1 = [END[0] + nrm[0] * 13, END[1] + nrm[1] * 13];
  const b2 = [END[0] - nrm[0] * 13, END[1] - nrm[1] * 13];
  return `M ${f(tip[0])} ${f(tip[1])} L ${f(b1[0])} ${f(b1[1])} L ${f(b2[0])} ${f(b2[1])} Z`;
})();

// Dashed outlines on the sides the path leaves open, as in the reference.
const D2 = `M ${xy(pt(CX[1], 180))} ${arc(0, 1, pt(CX[1], 0))}`; // over circle 2
const D3 = `M ${xy(pt(CX[2], END_DEG + 30))} ${arc(1, 1, pt(CX[2], 180))}`; // rest of circle 3

const vars = (v: Record<string, string | number>) => v as CSSProperties;
const pct = (n: number, of: number) => `${(n / of) * 100}%`;

function Node({ id }: { id: StepId }) {
  const Icon = ICONS[id];
  return (
    <div className="hiw-node__disc">
      <Icon className="hiw-node__icon" strokeWidth={1.35} aria-hidden="true" />
    </div>
  );
}

export function HowItWorksSection({ id }: { id?: string }) {
  const intro = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useReveal(intro);
  useReveal(body);

  return (
    <section id={id} aria-labelledby="hiw-title" className="hiw-section relative overflow-hidden py-14 sm:py-16">
      <div className="relative mx-auto max-w-page px-5 sm:px-8">
        <div ref={intro} className="hiw-intro mx-auto max-w-[46rem] text-center">
          <p className="fx-intro__eyebrow hiw-eyebrow fx-up" style={vars({ "--i": 0 })}>
            {HOW_IT_WORKS.eyebrow}
          </p>
          <h2
            id="hiw-title"
            className="fx-up mt-4 font-headline text-[clamp(1.5rem,6vw,2rem)] font-black leading-[1.08] tracking-[-0.03em] text-ink [font-synthesis:none] [text-wrap:balance] sm:text-[clamp(1.8rem,3vw,2.35rem)]"
            style={vars({ "--i": 1 })}
          >
            <span className="block">{HOW_IT_WORKS.headline.lead}</span>
            <span className="block text-indigo-deep">{HOW_IT_WORKS.headline.accent}</span>
          </h2>
          <p
            className="fx-up mx-auto mt-3 max-w-[42rem] text-[0.92rem] leading-relaxed text-ink-muted [text-wrap:pretty] sm:text-[0.97rem]"
            style={vars({ "--i": 2 })}
          >
            {HOW_IT_WORKS.description}
          </p>
        </div>

        <div ref={body} className="hiw-body">
          {/* Desktop diagram: decorative; the steps themselves are the list below. */}
          <div className="hiw-diagram" aria-hidden="true" style={{ aspectRatio: `${W} / ${H}` }}>
            <svg className="hiw-diagram__svg" viewBox={`0 0 ${W} ${H}`} fill="none">
              <defs>
                <linearGradient id="hiw-grad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={W} y2="0">
                  <stop offset="0" stopColor="#2B13CF" />
                  <stop offset="0.5" stopColor="#5B34F0" />
                  <stop offset="1" stopColor="#8E5CFF" />
                </linearGradient>
              </defs>
              <path className="hiw-dash" d={D2} />
              <path className="hiw-dash hiw-dash--late" d={D3} />
              <path className="hiw-path" d={MAIN} pathLength={1} stroke="url(#hiw-grad)" />
              <path className="hiw-arrow" d={ARROW} fill="#8E5CFF" />
            </svg>
            {HOW_IT_WORKS.steps.map((step, i) => (
              <div
                key={step.id}
                className="hiw-node"
                style={vars({ "--s": i, left: pct(CX[i] - NODE / 2, W), top: pct(CY - NODE / 2, H), width: pct(NODE, W) })}
              >
                <Node id={step.id} />
              </div>
            ))}
          </div>

          <ol className="hiw-steps">
            {HOW_IT_WORKS.steps.map((step, i) => {
              const num = String(i + 1).padStart(2, "0");
              return (
                <li key={step.id} className="hiw-step" style={vars({ "--s": i })} aria-labelledby={`hiw-step-${step.id}`}>
                  {/* Phones and tablets: the circle sits beside the copy on a vertical line. */}
                  <div className="hiw-step__node" aria-hidden="true">
                    <Node id={step.id} />
                  </div>
                  <div className="hiw-step__copy">
                    <p className="hiw-step__kicker" aria-hidden="true">
                      Step {num}
                    </p>
                    <h3 id={`hiw-step-${step.id}`} className="hiw-step__label">
                      <span className="sr-only">Step {i + 1}: </span>
                      {step.label}
                    </h3>
                    <p className="hiw-step__title">{step.title}</p>
                    <p className="hiw-step__body">{step.body}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
