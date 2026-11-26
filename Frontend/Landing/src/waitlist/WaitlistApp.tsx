import { useEffect, useRef } from "react";
import { ArrowLeft, Info, LockKeyhole, RotateCw, TriangleAlert } from "lucide-react";
import revlumaLogo from "@/assets/revluma-icon.png";
import { MONTHLY_ORDERS, labelOf, normaliseShopifyUrl } from "./schema";
import { overallFill, stepFill } from "./progress";
import { scrollBehavior } from "./motion";
import { useApplication, type ApplicationState } from "./useApplication";
import { Pass } from "./components/Pass";
import { ProgressBar, ProgressRail } from "./components/ProgressRail";
import { StepStore } from "./components/StepStore";
import { StepChallenges } from "./components/StepChallenges";
import { StepPriorities } from "./components/StepPriorities";
import { ReviewStep } from "./components/ReviewStep";
import { SuccessView } from "./components/SuccessView";
import { ResumeByEmail } from "./components/ResumeByEmail";

/**
 * /waitlist: the Founding Merchants application. Three saved steps and a
 * review, with the answers kept on the server after every Continue so an
 * applicant can leave at any point and pick up exactly where they stopped.
 */

const STEP_NAMES = ["About your store", "Your challenges", "Pricing and priorities", "Review"];

function Notice({ state }: { state: ApplicationState }) {
  const notice = state.notice;
  if (!notice) return null;
  const Icon = notice.tone === "warn" ? TriangleAlert : Info;
  return (
    <div className={`wl-notice wl-notice--${notice.tone}`} role={notice.tone === "warn" ? "alert" : "status"}>
      <Icon size={16} strokeWidth={2.2} aria-hidden="true" />
      <p>{notice.text}</p>
      {notice.action === "resume" ? (
        <button type="button" className="wl-btn wl-btn--secondary wl-btn--sm" onClick={() => state.openResume()}>
          Email me a code
        </button>
      ) : (
        <button type="button" className="wl-notice__close" onClick={state.dismissNotice} aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  );
}

function Panel({ state }: { state: ApplicationState }) {
  if (state.view === "loading") {
    return (
      <div className="wl-step wl-skeleton" aria-busy="true" aria-live="polite">
        <span className="wl-sr">Loading your application</span>
        <i style={{ width: "28%" }} />
        <i style={{ width: "62%", height: 28 }} />
        <i style={{ width: "88%" }} />
        <i style={{ height: 48 }} />
        <i style={{ height: 48 }} />
        <i style={{ height: 48 }} />
      </div>
    );
  }
  if (state.view === "load-error") {
    return (
      <div className="wl-step wl-load-error" role="alert">
        <TriangleAlert size={22} strokeWidth={2} aria-hidden="true" />
        <h2 className="wl-step__title">We couldn't load the application</h2>
        <p className="wl-step__desc">Check your connection and try again. Anything you saved before is safe.</p>
        <button type="button" className="wl-btn wl-btn--primary" onClick={() => void state.load()}>
          <RotateCw size={16} strokeWidth={2.4} aria-hidden="true" />
          Try again
        </button>
      </div>
    );
  }
  if (state.view === "resume") {
    return <ResumeByEmail initialEmail={state.resumeEmail} onResumed={state.resumed} onCancel={state.closeResume} />;
  }
  if (state.view === "done" && state.app) {
    return <SuccessView app={state.app} justSubmitted={state.justSubmitted} />;
  }
  switch (state.screen) {
    case 1:
      return <StepStore state={state} />;
    case 2:
      return <StepChallenges state={state} />;
    case 3:
      return <StepPriorities state={state} />;
    default:
      return <ReviewStep state={state} />;
  }
}

export function WaitlistApp() {
  const state = useApplication();
  const card = useRef<HTMLDivElement>(null);
  const done = state.view === "done";
  const panelKey = `${state.view}-${state.view === "form" ? state.screen : ""}`;

  // Bring the top of the card into view when the step changes on a long page.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const top = card.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) window.scrollTo({ top: window.scrollY + top - 24, behavior: scrollBehavior() });
  }, [panelKey]);

  const store = normaliseShopifyUrl(state.answers.store_url)?.replace("https://", "") ?? null;
  const orders = state.answers.monthly_orders ? labelOf(MONTHLY_ORDERS, state.answers.monthly_orders) : null;
  const overall = overallFill(state.answers);
  // The review screen has nothing left to answer: its segment sits half full until submit.
  const fill = state.screen <= 3 ? stepFill(state.answers, state.screen as 1 | 2 | 3) : 0.5;
  const passStatus = done ? (state.app?.status === "accepted" ? "Accepted" : "Submitted") : state.app ? "In progress" : "Not started";

  return (
    <div className="wl">
      <header className="wl-nav-wrap">
        <nav className="wl-nav" aria-label="Revluma">
          <a className="wl-nav__brand" href="/" aria-label="Revluma home">
            <span className="wl-nav__mark">
              <img src={revlumaLogo} alt="" width={24} height={24} />
            </span>
            <span>Revluma</span>
          </a>
          <a className="wl-nav__back" href="/">
            <ArrowLeft size={15} strokeWidth={2.2} aria-hidden="true" />
            Back to site
          </a>
        </nav>
      </header>

      <main className="wl-main" id="main">
        <aside className="wl-aside">
          <p className="wl-eyebrow">
            <span aria-hidden="true" />
            Founding Merchants Program
          </p>
          <h1 className="wl-h1">
            Apply to become a <span>Founding Merchant</span>
          </h1>
          <p className="wl-lede">
            A few questions about your store and what's hard to understand today. It takes about four minutes, and every step is saved as you go.
          </p>
          <div className="wl-aside__pass">
            <Pass
              store={store}
              orders={orders}
              status={passStatus}
              answered={done ? overall.total : overall.done}
              total={overall.total}
              done={done}
              queue={state.app?.queue_position ?? null}
            />
          </div>
          {state.view === "form" || done ? (
            <div className="wl-aside__rail">
              <ProgressRail screen={state.screen} furthest={state.furthest} done={done} onJump={state.jump} disabled={state.save.kind === "saving"} />
            </div>
          ) : null}
          <div className="wl-aside__foot">
            {done ? null : (
              <p className="wl-saved-note">
                <LockKeyhole size={14} strokeWidth={2.2} aria-hidden="true" />
                Saved securely after each step. Come back in this browser any time.
              </p>
            )}
            {state.view === "form" ? (
              <p className="wl-aside__links">
                {state.app ? (
                  <button type="button" className="wl-link" onClick={() => void state.startOver()}>
                    Not you? Start a new application
                  </button>
                ) : (
                  <button type="button" className="wl-link" onClick={() => state.openResume(state.answers.work_email)}>
                    Started on another device? Continue with your email
                  </button>
                )}
              </p>
            ) : null}
          </div>
        </aside>

        <section className="wl-panel" aria-label={done ? "Application received" : `Application, ${STEP_NAMES[state.screen - 1]}`}>
          <Notice state={state} />
          <div ref={card} className="wl-card">
            {state.view === "form" || done ? <ProgressBar screen={state.screen} done={done} fill={fill} /> : null}
            <div key={panelKey} className={`wl-enter wl-enter--${state.direction > 0 ? "fwd" : "back"}`}>
              <Panel state={state} />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
