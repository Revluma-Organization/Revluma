import {
  useRef,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  CircleHelp,
  ListOrdered,
  Package,
  PackageOpen,
  ReceiptText,
  Search,
  ShoppingCart,
  Undo2,
  Users,
  Warehouse,
} from "lucide-react";
import { PROBLEM } from "@/content";
import { useReveal } from "@/useReveal";

/**
 * Section 3, "The problem": helps merchants recognise the problem before the
 * solution is introduced. A headline that mirrors the hero's split headline,
 * a short intro, and three problem cards, each with a small live illustration
 * of that problem:
 *   1. Information without answers: the data is all there, the question
 *      "What's driving this?" gets no answer (only thinking dots).
 *   2. Disconnected evidence: clues from different parts of the store float
 *      apart, their links broken.
 *   3. Unclear priorities: several issues keep swapping places, none ranked.
 * Illustrations use labels only, never figures. Motion is in
 * ProblemSection.css and is off with reduced motion.
 */

const vars = (v: Record<string, string | number>) => v as CSSProperties;

function Reveal({
  as: Tag = "div",
  className = "",
  i = 0,
  children,
}: {
  as?: "div" | "p" | "li" | "span";
  className?: string;
  i?: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useReveal(ref);
  return (
    <Tag
      ref={ref as never}
      className={`pr-reveal ${className}`}
      style={vars({ "--i": i })}
    >
      {children}
    </Tag>
  );
}

/* ---- 1. Information without answers ------------------------------------ */

const DATA_TILES = [
  { label: "Orders", Icon: ReceiptText, bars: [5, 8, 6, 9, 7] },
  { label: "Products", Icon: Package, bars: [7, 5, 8, 6, 9] },
  { label: "Inventory", Icon: Warehouse, bars: [9, 7, 6, 8, 5] },
  { label: "Customers", Icon: Users, bars: [6, 9, 7, 5, 8] },
];

function AnswersArt() {
  return (
    <div className="pr-answers">
      <div className="pr-answers__grid">
        {DATA_TILES.map(({ label, Icon, bars }, t) => (
          <div key={label} className="pr-tile">
            <span className="pr-tile__icon">
              <Icon size={13} aria-hidden="true" />
            </span>
            <span className="pr-tile__label">{label}</span>
            <span className="pr-tile__bars" aria-hidden="true">
              {bars.map((h, b) => (
                <i
                  key={b}
                  style={vars({ "--h": h, "--bd": `${(t * 5 + b) * -0.37}s` })}
                />
              ))}
            </span>
          </div>
        ))}
      </div>
      <div className="pr-ask">
        <span className="pr-ask__q">What's driving this?</span>
        <span className="pr-ask__a" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </div>
    </div>
  );
}

/* ---- 2. Disconnected evidence ------------------------------------------ */

// Clue chips around a centre "case" (positions in % of the illustration).
const CLUES = [
  { label: "Refunds", Icon: Undo2, x: 6, y: 12, ax: 34, ay: 30 },
  { label: "Products", Icon: Package, x: 58, y: 8, ax: 66, ay: 28 },
  { label: "Checkouts", Icon: ShoppingCart, x: 4, y: 70, ax: 33, ay: 72 },
  { label: "Customers", Icon: Users, x: 56, y: 74, ax: 67, ay: 74 },
];

function EvidenceArt() {
  return (
    <div className="pr-evidence">
      {/* Broken links: each runs from a clue towards the centre and stops short. */}
      <svg
        className="pr-evidence__links"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d="M30 26 L 41 40" />
        <path d="M70 24 L 59 40" />
        <path d="M30 76 L 41 61" />
        <path d="M70 78 L 59 61" />
      </svg>
      <span className="pr-evidence__case" aria-hidden="true">
        <Search size={18} />
        <b>?</b>
      </span>
      {CLUES.map(({ label, Icon, x, y }, i) => (
        <span
          key={label}
          className={`pr-clue pr-clue--${i}`}
          style={vars({ left: `${x}%`, top: `${y}%` })}
        >
          <Icon size={13} aria-hidden="true" />
          {label}
        </span>
      ))}
    </div>
  );
}

/* ---- 3. Unclear priorities --------------------------------------------- */

const ISSUES = [
  { label: "Refunds rising", Icon: Undo2, tone: "#E11D48" },
  { label: "Stock running low", Icon: PackageOpen, tone: "#D97706" },
  { label: "Checkouts abandoned", Icon: ShoppingCart, tone: "#7C3AED" },
];

function PrioritiesArt() {
  return (
    <div className="pr-priorities">
      <div className="pr-priorities__list">
        {ISSUES.map(({ label, Icon, tone }, i) => (
          <div
            key={label}
            className={`pr-issue pr-issue--${i}`}
            style={vars({ "--n": i, "--tone": tone })}
          >
            <span className="pr-issue__icon">
              <Icon size={13} aria-hidden="true" />
            </span>
            <span className="pr-issue__label">{label}</span>
            <span className="pr-issue__rank" aria-hidden="true">
              ?
            </span>
          </div>
        ))}
      </div>
      <span className="pr-which">
        <ListOrdered size={13} aria-hidden="true" />
        Which first?
      </span>
    </div>
  );
}

const ART: Record<(typeof PROBLEM.items)[number]["id"], ComponentType> = {
  answers: AnswersArt,
  evidence: EvidenceArt,
  priorities: PrioritiesArt,
};

export function ProblemSection({ id }: { id?: string }) {
  return (
    <section
      id={id}
      aria-labelledby="problem-title"
      className="relative overflow-x-clip bg-canvas py-20 sm:py-24 lg:py-32"
    >
      <div className="mx-auto max-w-page px-5 sm:px-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)] lg:items-end lg:gap-16">
          <div>
            <Reveal
              as="p"
              className="inline-flex items-center gap-2 rounded-full border border-indigo-brand/15 bg-indigo-wash px-3 py-1 text-[0.78rem] font-semibold text-indigo-deep"
            >
              <CircleHelp size={14} aria-hidden="true" />
              {PROBLEM.eyebrow}
            </Reveal>
            <h2
              id="problem-title"
              className="mt-5 font-headline text-[clamp(1.7rem,6.6vw,2.6rem)] font-black leading-[1.08] tracking-[-0.03em] text-ink [font-synthesis:none] sm:text-[clamp(2rem,4.6vw,3.3rem)] lg:text-[clamp(2.4rem,3.6vw,3.15rem)] [text-wrap:balance]"
            >
              <Reveal as="span" className="block" i={1}>
                {PROBLEM.headline.lead}
              </Reveal>
              <Reveal as="span" className="block text-indigo-deep" i={2}>
                {PROBLEM.headline.accent}
              </Reveal>
            </h2>
          </div>
          <Reveal
            as="p"
            i={3}
            className="max-w-[30rem] text-[1rem] leading-relaxed text-ink-muted sm:text-[1.04rem] lg:pb-2"
          >
            {PROBLEM.intro}
          </Reveal>
        </div>

        <ol className="mt-12 grid gap-5 lg:mt-16 lg:grid-cols-3 lg:gap-6">
          {PROBLEM.items.map((item, i) => {
            const Art = ART[item.id];
            return (
              <Reveal
                as="li"
                key={item.id}
                i={i}
                className="pr-card group flex flex-col gap-1 rounded-[1.6rem] border border-line bg-white p-3 shadow-[0_24px_48px_-32px_rgba(12,10,29,0.28)] hover:border-indigo-brand/20 hover:shadow-[0_30px_60px_-30px_rgba(31,6,172,0.32)] sm:flex-row sm:gap-3 lg:flex-col lg:gap-1"
              >
                <div className="pr-art relative h-[11.5rem] shrink-0 overflow-hidden rounded-[1.15rem] sm:h-auto sm:min-h-[11.5rem] sm:w-[21rem] lg:h-[12rem] lg:w-auto">
                  <Art />
                </div>
                <div className="flex flex-1 flex-col px-3 pb-4 pt-5 sm:justify-center sm:py-4 lg:justify-start lg:pb-5 lg:pt-6">
                  <span className="text-[0.75rem] font-semibold tracking-[0.12em] text-indigo-brand">
                    0{i + 1}
                  </span>
                  <h3 className="mt-2 text-[1.2rem] font-semibold leading-snug tracking-[-0.015em] text-ink">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-[0.95rem] leading-relaxed text-ink-muted">
                    {item.body}
                  </p>
                </div>
              </Reveal>
            );
          })}
        </ol>

        <Reveal
          as="p"
          className="mt-12 flex items-center justify-center gap-4 text-center text-[1rem] font-semibold tracking-[-0.01em] text-ink [text-wrap:balance] sm:text-[1.08rem] lg:mt-16"
        >
          <span
            aria-hidden="true"
            className="hidden h-px w-14 bg-gradient-to-r from-transparent to-indigo-brand/40 sm:block"
          />
          {PROBLEM.closing}
          <span
            aria-hidden="true"
            className="hidden h-px w-14 bg-gradient-to-l from-transparent to-indigo-brand/40 sm:block"
          />
        </Reveal>
      </div>
    </section>
  );
}
