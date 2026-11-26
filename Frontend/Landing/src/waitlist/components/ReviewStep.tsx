import { useEffect, useRef, type ReactNode } from "react";
import { ArrowLeft, Loader2, PencilLine, RotateCw, Send } from "lucide-react";
import { CAPABILITIES, CHALLENGES, FOUNDING_INTEREST, MONTHLY_ORDERS, PRICES, PROBLEM_DISCOVERY, STORE_AGE, labelOf, type StepNumber } from "../schema";
import type { ApplicationState } from "../useApplication";
import { SaveStatus } from "./StepFrame";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="wl-review__row">
      <dt>{label}</dt>
      <dd>{children || <span className="wl-muted">Not provided</span>}</dd>
    </div>
  );
}

function Section({
  step,
  title,
  onEdit,
  disabled,
  children,
}: {
  step: StepNumber;
  title: string;
  onEdit: (s: StepNumber) => void;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <section className="wl-review__section" aria-labelledby={`wl-review-${step}`}>
      <div className="wl-review__head">
        <h3 id={`wl-review-${step}`}>{title}</h3>
        <button type="button" className="wl-btn wl-btn--edit" onClick={() => onEdit(step)} disabled={disabled} aria-label={`Edit ${title.toLowerCase()}`}>
          <PencilLine size={14} strokeWidth={2.2} aria-hidden="true" />
          Edit
        </button>
      </div>
      <dl className="wl-review__list">{children}</dl>
    </section>
  );
}

function List({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul className="wl-review__tags">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

/** Step 4: everything the server has saved, with edit links, then submit. */
export function ReviewStep({ state }: { state: ApplicationState }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const a = state.answers;
  const saving = state.save.kind === "saving";
  const failed = state.save.kind === "error";

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  const challengeLabels = a.challenges.map((c) => (c === "other" && a.challenge_other ? `Other: ${a.challenge_other}` : labelOf(CHALLENGES, c)));

  return (
    <div className="wl-step" aria-busy={saving || undefined}>
      <header className="wl-step__head">
        <p className="wl-step__count wl-step__count--step">Step 4 of 4</p>
        <h2 ref={heading} tabIndex={-1} className="wl-step__title">
          Review your application
        </h2>
        <p className="wl-step__desc">Everything below is saved. Check it over, edit anything, then submit when you're ready.</p>
      </header>

      <div className="wl-review">
        <Section step={1} title="About your store" onEdit={state.edit} disabled={saving}>
          <Row label="Name">{a.full_name}</Row>
          <Row label="Work email">{a.work_email}</Row>
          <Row label="Store">{a.store_name}</Row>
          <Row label="Shopify URL">{a.store_url.replace(/^https:\/\//, "")}</Row>
          <Row label="Phone or WhatsApp">{a.phone}</Row>
          <Row label="Store age">{labelOf(STORE_AGE, a.store_age)}</Row>
          <Row label="Monthly orders">{labelOf(MONTHLY_ORDERS, a.monthly_orders)}</Row>
        </Section>
        <Section step={2} title="Your challenges" onEdit={state.edit} disabled={saving}>
          <Row label="Challenges">
            <List items={challengeLabels} />
          </Row>
          <Row label="How you find problems">{labelOf(PROBLEM_DISCOVERY, a.problem_discovery)}</Row>
        </Section>
        <Section step={3} title="Pricing and priorities" onEdit={state.edit} disabled={saving}>
          <Row label="Would pay">
            {a.price_willingness ? (a.price_willingness === "free" ? "Free" : `${labelOf(PRICES, a.price_willingness)} per month`) : ""}
          </Row>
          <Row label="Most valuable">
            <List items={a.capabilities.map((c) => labelOf(CAPABILITIES, c))} />
          </Row>
          <Row label="Founding Merchants">{labelOf(FOUNDING_INTEREST, a.founding_interest)}</Row>
        </Section>
      </div>

      <p className="wl-consent">
        By submitting, you agree that Revluma may contact you by email about your application. See our <a href="/pages/privacyPolicy">privacy policy</a>.
      </p>

      <footer className="wl-step__foot">
        <button type="button" className="wl-btn wl-btn--ghost" onClick={state.back} disabled={saving}>
          <ArrowLeft size={16} strokeWidth={2.2} aria-hidden="true" />
          Back
        </button>
        <div className="wl-step__go">
          <SaveStatus save={state.save} />
          <button type="button" className="wl-btn wl-btn--primary" onClick={() => void state.submit()} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="wl-spin" size={16} strokeWidth={2.4} aria-hidden="true" />
                Submitting
              </>
            ) : failed ? (
              <>
                <RotateCw size={16} strokeWidth={2.4} aria-hidden="true" />
                Retry
              </>
            ) : (
              <>
                Submit application
                <Send size={15} strokeWidth={2.4} aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      </footer>
    </div>
  );
}
