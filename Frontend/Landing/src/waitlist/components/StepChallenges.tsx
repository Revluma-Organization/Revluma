import { CHALLENGES, PROBLEM_DISCOVERY } from "../schema";
import type { ApplicationState } from "../useApplication";
import { ChoiceGroup, MultiChoice } from "./fields";
import { StepFrame } from "./StepFrame";

export const STEP2_LABELS: Record<string, string> = {
  challenges: "Your biggest challenges",
  challenge_other: "Other challenge",
  problem_discovery: "How you find problems",
};

/** Step 2: what's hard today and how problems surface. */
export function StepChallenges({ state }: { state: ApplicationState }) {
  const { answers: a, errors, update, blur } = state;
  const otherId = "wl-challenge_other";
  return (
    <StepFrame
      step={2}
      total={4}
      title="Your challenges"
      description="What makes running your store harder than it should be? There are no wrong answers."
      errors={errors}
      labels={STEP2_LABELS}
      showSummary={state.attempted}
      attemptKey={state.attemptKey}
      save={state.save}
      onBack={state.back}
      onContinue={state.continueStep}
      continueLabel="Continue"
    >
      <MultiChoice
        name="challenges"
        legend="Which of these do you face today?"
        description="Choose all that apply."
        options={CHALLENGES}
        value={a.challenges}
        error={errors.challenges}
        onValue={(v) => update("challenges", v)}
        extra={{
          other: (
            <div className={`wl-field${errors.challenge_other ? " is-invalid" : ""}`}>
              <label className="wl-label" htmlFor={otherId}>
                Tell us more <span className="wl-optional">Optional</span>
              </label>
              <textarea
                id={otherId}
                name="challenge_other"
                className="wl-input wl-textarea"
                rows={3}
                maxLength={300}
                value={a.challenge_other}
                onChange={(event) => update("challenge_other", event.target.value)}
                onBlur={() => blur("challenge_other")}
                aria-invalid={errors.challenge_other ? true : undefined}
                aria-describedby={`${otherId}-count ${otherId}-error`}
              />
              <p id={`${otherId}-count`} className="wl-hint wl-hint--count">
                {a.challenge_other.length} / 300
              </p>
              <p id={`${otherId}-error`} className="wl-error" aria-live="polite">
                {errors.challenge_other ?? null}
              </p>
            </div>
          ),
        }}
      />
      <ChoiceGroup
        name="problem_discovery"
        legend="How do you usually find out something is wrong?"
        options={PROBLEM_DISCOVERY}
        value={a.problem_discovery}
        error={errors.problem_discovery}
        onValue={(v) => update("problem_discovery", v)}
        variant="cards"
      />
    </StepFrame>
  );
}
