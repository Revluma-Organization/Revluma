import { CAPABILITIES, FOUNDING_INTEREST, MAX_CAPABILITIES, PRICES } from "../schema";
import type { ApplicationState } from "../useApplication";
import { ChoiceGroup, MultiChoice } from "./fields";
import { StepFrame } from "./StepFrame";

export const STEP3_LABELS: Record<string, string> = {
  price_willingness: "What you would pay",
  capabilities: "Most valuable capabilities",
  founding_interest: "Founding Merchant interest",
};

/** Step 3: pricing, the capabilities that matter most, and interest in the programme. */
export function StepPriorities({ state }: { state: ApplicationState }) {
  const { answers: a, errors, update } = state;
  return (
    <StepFrame
      step={3}
      total={4}
      title="Pricing and priorities"
      description="Help us build the right thing at the right price. Your answers stay private to the Revluma team."
      errors={errors}
      labels={STEP3_LABELS}
      showSummary={state.attempted}
      attemptKey={state.attemptKey}
      save={state.save}
      onBack={state.back}
      onContinue={state.continueStep}
      continueLabel="Review application"
    >
      <ChoiceGroup
        name="price_willingness"
        legend="If Revluma solved your biggest challenge, what would you pay each month?"
        description="Prices in USD. Pick the amount that feels right, not the lowest."
        options={PRICES}
        value={a.price_willingness}
        error={errors.price_willingness}
        onValue={(v) => update("price_willingness", v)}
        variant="price"
        suffix="per month"
      />
      <MultiChoice
        name="capabilities"
        legend="Which capabilities would be most valuable to you?"
        description={`Choose up to ${MAX_CAPABILITIES}.`}
        options={CAPABILITIES}
        value={a.capabilities}
        max={MAX_CAPABILITIES}
        error={errors.capabilities}
        onValue={(v) => update("capabilities", v)}
      />
      <ChoiceGroup
        name="founding_interest"
        legend="Would you like to join the Founding Merchants Program?"
        description="Founding merchants use Revluma early and talk with our team about what to build next."
        options={FOUNDING_INTEREST}
        value={a.founding_interest}
        error={errors.founding_interest}
        onValue={(v) => update("founding_interest", v)}
        variant="cards"
      />
    </StepFrame>
  );
}
