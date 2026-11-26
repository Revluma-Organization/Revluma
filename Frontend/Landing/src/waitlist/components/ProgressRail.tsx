import { Check } from "lucide-react";
import type { Screen } from "../useApplication";

const ITEMS = [
  { screen: 1, title: "About your store" },
  { screen: 2, title: "Your challenges" },
  { screen: 3, title: "Pricing and priorities" },
  { screen: 4, title: "Review and submit" },
] as const;

type Props = { screen: Screen; furthest: Screen; done: boolean; onJump: (screen: Screen) => void; disabled: boolean };

/** Vertical steps on wide screens. Earlier steps can be reopened; later ones unlock as each is saved. */
export function ProgressRail({ screen, furthest, done, onJump, disabled }: Props) {
  return (
    <nav className="wl-rail" aria-label="Application steps">
      <ol>
        {ITEMS.map((item) => {
          const complete = done || item.screen < furthest;
          const current = !done && item.screen === screen;
          const reachable = !done && !current && item.screen <= furthest;
          const state = current ? "current" : complete ? "complete" : "upcoming";
          const label = (
            <>
              <span className="wl-rail__dot" aria-hidden="true">
                {complete && !current ? <Check size={12} strokeWidth={3} /> : item.screen}
              </span>
              <span className="wl-rail__text">
                <span className="wl-rail__title">{item.title}</span>
                <span className="wl-rail__state">{current ? "In progress" : done && item.screen === 4 ? "Submitted" : complete ? "Saved" : "Not started"}</span>
              </span>
            </>
          );
          return (
            <li key={item.screen} className={`wl-rail__item is-${state}`}>
              {reachable ? (
                <button type="button" className="wl-rail__btn" onClick={() => onJump(item.screen)} disabled={disabled}>
                  {label}
                  <span className="wl-sr">, go to this step</span>
                </button>
              ) : (
                <span className="wl-rail__btn" aria-current={current ? "step" : undefined}>
                  {label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Compact progress for small screens (and a visual bar for everyone). */
export function ProgressBar({ screen, done }: { screen: Screen; done: boolean }) {
  const value = done ? 4 : screen;
  const title = done ? "Submitted" : ITEMS[screen - 1].title;
  return (
    <div className="wl-progress">
      <div className="wl-progress__meta">
        <span>{done ? "Application complete" : `Step ${screen} of 4`}</span>
        <span className="wl-progress__title">{title}</span>
      </div>
      <div
        className="wl-progress__track"
        role="progressbar"
        aria-label="Application progress"
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={value}
        aria-valuetext={done ? "Submitted" : `Step ${screen} of 4, ${title}`}
      >
        <span className="wl-progress__fill" style={{ transform: `scaleX(${value / 4})` }} />
      </div>
    </div>
  );
}
