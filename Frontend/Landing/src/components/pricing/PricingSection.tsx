import { useRef, useState, type CSSProperties } from "react";
import { ArrowRight, Check, CircleDollarSign, Lock, MessageCircleQuestion } from "lucide-react";
import { PRICING } from "@/content";
import { useLandingConfig } from "@/config";
import { useReveal } from "@/useReveal";

/**
 * Pricing, after the approved reference layout: centred heading, a
 * Monthly / Yearly switch, then one white panel holding Starter and
 * Enterprise with Premium raised above it as the indigo "Recommended" card.
 * Prices and features come from PRICING in content.ts. Starter and Premium
 * start at the real sign-up page; Enterprise emails the team.
 */

type Cycle = "monthly" | "yearly";
type Plan = (typeof PRICING.plans)[number];

const vars = (v: Record<string, string | number>) => v as CSSProperties;

function BillingSwitch({ cycle, onChange }: { cycle: Cycle; onChange: (c: Cycle) => void }) {
  return (
    <div className="pr-switch" role="radiogroup" aria-label="Billing period">
      <span className="pr-switch__thumb" data-cycle={cycle} aria-hidden="true" />
      {(["monthly", "yearly"] as const).map((c) => (
        <button key={c} type="button" role="radio" aria-checked={cycle === c} className="pr-switch__opt" onClick={() => onChange(c)}>
          {PRICING.billing[c]}
          {c === "yearly" ? <span className="pr-switch__save">{PRICING.billing.save}</span> : null}
        </button>
      ))}
    </div>
  );
}

function Price({ plan, cycle }: { plan: Plan; cycle: Cycle }) {
  if ("customPrice" in plan) {
    return (
      <div className="pr-price">
        <p className="pr-price__row">
          <span className="pr-price__custom">{plan.customPrice}</span>
        </p>
        <p className="pr-price__note">{plan.priceNote}</p>
      </div>
    );
  }
  const amount = plan.price[cycle];
  return (
    <div className="pr-price">
      <p className="pr-price__row">
        <span className="pr-price__amount" key={`${plan.id}-${cycle}`}>
          ${amount}
        </span>
        <span className="pr-price__per">/month</span>
      </p>
      <p className="pr-price__note">{cycle === "yearly" ? `Billed yearly · $${amount * 12}/year` : PRICING.billing.monthlyNote}</p>
    </div>
  );
}

function PlanCard({ plan, cycle, index }: { plan: Plan; cycle: Cycle; index: number }) {
  const { signUpHref } = useLandingConfig();
  const featured = "badge" in plan;
  const href = plan.cta.kind === "contact" ? PRICING.contactHref : signUpHref;
  return (
    <article
      className={`pr-card pr-card--${plan.id}${featured ? " pr-card--featured" : ""} fx-up`}
      style={vars({ "--i": index + 1 })}
      aria-labelledby={`pr-${plan.id}`}
    >
      {featured ? <span className="pr-badge">{plan.badge}</span> : null}
      <Price plan={plan} cycle={cycle} />
      <h3 id={`pr-${plan.id}`} className="pr-card__name">
        {plan.name}
      </h3>
      <p className="pr-card__desc">{plan.description}</p>
      {"includes" in plan ? <p className="pr-card__includes">{plan.includes}</p> : null}
      <ul className="pr-features">
        {plan.features.map((f) => (
          <li key={f}>
            <span className="pr-check" aria-hidden="true">
              <Check size={11} strokeWidth={3} />
            </span>
            {f}
          </li>
        ))}
      </ul>
      <a href={href} className="pr-btn">
        {plan.cta.label}
        {plan.cta.kind === "signup" ? <span className="sr-only"> with {plan.name}</span> : null}
      </a>
    </article>
  );
}

export function PricingSection({ id }: { id?: string }) {
  const [cycle, setCycle] = useState<Cycle>("monthly");
  const head = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  useReveal(head);
  useReveal(grid);

  return (
    <section id={id} aria-labelledby="pr-title" className="pr-section py-16 sm:py-20 lg:py-24">
      <div className="mx-auto max-w-page px-5 sm:px-8">
        <div ref={head} className="mx-auto flex max-w-[52rem] flex-col items-center text-center">
          <h2
            id="pr-title"
            className="fx-up font-headline text-[clamp(1.75rem,6.4vw,2.3rem)] font-black leading-[1.08] tracking-[-0.03em] text-ink [font-synthesis:none] [text-wrap:balance] sm:text-[clamp(2.1rem,3.8vw,2.85rem)]"
            style={vars({ "--i": 0 })}
          >
            {PRICING.headline.lead} <span className="text-indigo-deep">{PRICING.headline.accent}</span>
          </h2>
          <p className="fx-up mt-4 text-[0.98rem] leading-relaxed text-ink-muted [text-wrap:pretty] sm:text-[1.04rem]" style={vars({ "--i": 1 })}>
            {PRICING.description}
          </p>
          <div className="fx-up mt-8" style={vars({ "--i": 2 })}>
            <BillingSwitch cycle={cycle} onChange={setCycle} />
          </div>
        </div>

        <div ref={grid} className="pr-stage">
          <div className="pr-panel" aria-hidden="true" />
          <div className="pr-grid">
            {PRICING.plans.map((plan, i) => (
              <PlanCard key={plan.id} plan={plan} cycle={cycle} index={i} />
            ))}
          </div>
        </div>

        <div className="pr-foot">
          <p className="pr-foot__trial">{PRICING.trial}</p>
          <ul className="pr-foot__list">
            {PRICING.assurances.map((a) => (
              <li key={a.id}>
                {a.id === "readonly" ? (
                  <Lock size={13} strokeWidth={2.2} aria-hidden="true" />
                ) : (
                  <CircleDollarSign size={13} strokeWidth={2.2} aria-hidden="true" />
                )}
                {a.label}
              </li>
            ))}
            <li>
              <a href={PRICING.faqLink.href} className="pr-foot__link">
                <MessageCircleQuestion size={13} strokeWidth={2.2} aria-hidden="true" />
                {PRICING.faqLink.label}
                <ArrowRight size={13} strokeWidth={2.2} aria-hidden="true" />
              </a>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
