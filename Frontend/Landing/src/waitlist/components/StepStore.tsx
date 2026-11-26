import { useState } from "react";
import { MONTHLY_ORDERS, STORE_AGE, normaliseShopifyUrl } from "../schema";
import { REFERRAL_FORMAT } from "../referral";
import type { ApplicationState } from "../useApplication";
import { ChoiceGroup, TextField } from "./fields";
import { StepFrame } from "./StepFrame";

export const STEP1_LABELS: Record<string, string> = {
  full_name: "Full name",
  work_email: "Work email",
  store_name: "Brand or store name",
  store_url: "Shopify store URL",
  phone: "Phone or WhatsApp",
  store_age: "How long your store has been running",
  monthly_orders: "Monthly orders",
};

/** Step 1: who you are and the store you run. */
export function StepStore({ state }: { state: ApplicationState }) {
  const { answers: a, errors, update, blur } = state;
  const started = Boolean(state.app);
  const [showReferral, setShowReferral] = useState(false);
  const [referralError, setReferralError] = useState<string | undefined>();
  const storeHost = normaliseShopifyUrl(a.store_url)?.replace("https://", "");

  return (
    <StepFrame
      step={1}
      total={4}
      title="About your store"
      description="Tell us who you are and which Shopify store you run. We only use this to review your application and contact you."
      errors={errors}
      labels={STEP1_LABELS}
      showSummary={state.attempted}
      attemptKey={state.attemptKey}
      save={state.save}
      onContinue={state.continueStep}
      continueLabel="Continue"
    >
      <div className="wl-grid">
        <TextField
          name="full_name"
          label="Full name"
          autoComplete="name"
          value={a.full_name}
          error={errors.full_name}
          onValue={(v) => update("full_name", v)}
          onBlur={() => blur("full_name")}
          maxLength={120}
          required
        />
        <TextField
          name="work_email"
          label="Work email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="you@yourstore.com"
          value={a.work_email}
          error={errors.work_email}
          onValue={(v) => update("work_email", v)}
          onBlur={() => blur("work_email")}
          maxLength={254}
          required
        />
        <TextField
          name="store_name"
          label="Brand or store name"
          autoComplete="organization"
          value={a.store_name}
          error={errors.store_name}
          onValue={(v) => update("store_name", v)}
          onBlur={() => blur("store_name")}
          maxLength={120}
          required
        />
        <TextField
          name="store_url"
          label="Shopify store URL"
          inputMode="url"
          autoComplete="url"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="yourstore.myshopify.com"
          value={a.store_url}
          error={errors.store_url}
          onValue={(v) => update("store_url", v)}
          onBlur={() => blur("store_url")}
          maxLength={300}
          hint={
            storeHost && !errors.store_url ? (
              <>
                We'll save it as <strong>{storeHost}</strong>. No store connection needed.
              </>
            ) : (
              "Your myshopify.com address or your store's own domain."
            )
          }
          required
        />
        <TextField
          name="phone"
          label="Phone or WhatsApp"
          optional
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+234 801 234 5678"
          value={a.phone}
          error={errors.phone}
          onValue={(v) => update("phone", v)}
          onBlur={() => blur("phone")}
          maxLength={32}
          hint="Include your country code. Only used if email doesn't reach you."
        />
        {started ? null : showReferral || state.referral ? (
          <TextField
            name="referral_code"
            label="Referral code"
            optional
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            placeholder="RV-XXXXXXXX"
            value={state.referral ?? ""}
            error={referralError}
            onValue={(v) => {
              setReferralError(undefined);
              state.setReferral(v.toUpperCase().replace(/\s+/g, ""));
            }}
            onBlur={() => setReferralError(state.referral && !REFERRAL_FORMAT.test(state.referral) ? "Referral codes look like RV-XXXXXXXX." : undefined)}
            maxLength={20}
            hint="From the merchant who shared Revluma with you."
          />
        ) : (
          <div className="wl-field wl-field--link">
            <button type="button" className="wl-link" onClick={() => setShowReferral(true)}>
              Have a referral code?
            </button>
          </div>
        )}
      </div>
      <ChoiceGroup
        name="store_age"
        legend="How long has your store been running?"
        options={STORE_AGE}
        value={a.store_age}
        error={errors.store_age}
        onValue={(v) => update("store_age", v)}
      />
      <ChoiceGroup
        name="monthly_orders"
        legend="How many orders do you get in a typical month?"
        options={MONTHLY_ORDERS}
        value={a.monthly_orders}
        error={errors.monthly_orders}
        onValue={(v) => update("monthly_orders", v)}
      />
      {/* Bot trap: hidden from people and assistive tech; anything typed here means a bot. */}
      <div className="wl-hp" aria-hidden="true">
        <label htmlFor="wl-hp">Leave this empty</label>
        <input ref={state.honeypot} id="wl-hp" name="hp_field" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>
    </StepFrame>
  );
}
