// Conversation title with a short "typed" reveal.
//
// When the title text changes (a new chat is named, or another conversation
// is opened) the characters appear left to right, each fading in from a soft
// blur, while a thin caret at the end of the line blinks and then fades out.
// ChatGPT types a freshly generated title into its sidebar in a similar way.
//
// ui-ux-pro-max guidance applied (motion: Stagger List / text split; ux:
// Reduced Motion, Excessive Motion):
//   - Headline-length text only: the reveal is capped at ~600ms in total no
//     matter how long the title is, and it runs once per change, never loops.
//   - Screen readers get the whole title once (sr-only text); the per-letter
//     spans and the caret are aria-hidden.
//   - prefers-reduced-motion: the final title renders immediately, no caret.
//   - The container keeps one line with an ellipsis, so the header never
//     shifts while the title types in.
import type { CSSProperties } from "react";

const MAX_REVEAL_MS = 600;
const MAX_STEP_MS = 28;

export function RevAnimatedTitle({ text, className = "", style }: {
  text: string;
  className?: string;
  style?: CSSProperties;
}) {
  const chars = Array.from(text);
  const step = chars.length ? Math.min(MAX_STEP_MS, MAX_REVEAL_MS / chars.length) : 0;
  const total = Math.round(step * chars.length);
  return (
    <p className={`min-w-0 truncate ${className}`} style={style} title={text} data-rev-title="">
      <span className="sr-only">{text}</span>
      {/* key restarts the reveal whenever the title text changes */}
      <span key={text} aria-hidden="true" className="rv-title-typed">
        {chars.map((char, index) => (
          <span key={index} className="rv-title-char" style={{ animationDelay: `${Math.round(index * step)}ms` }}>{char}</span>
        ))}
        <span className="rv-title-caret" style={{ animationDelay: `0ms, ${total + 120}ms` }} />
      </span>
    </p>
  );
}

export default RevAnimatedTitle;
