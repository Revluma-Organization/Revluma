import { ArrowDown } from "lucide-react";
import { revTokens } from "@/lib/revTokens";

/**
 * "Back to latest" pill (ChatGPT-UI study §6: auto-scroll pins to the stream
 * unless the merchant scrolls up, then offers a one-tap return — reading an
 * older answer is never hijacked, and rejoining the live stream is one click).
 *
 * Always mounted so both show and hide animate (150ms functional transition,
 * inside the app-wide reduced-motion kill switch); when hidden it is
 * aria-hidden, unfocusable and click-through.
 */
export function JumpToLatest({ visible, onClick, dark = false }: {
  visible: boolean;
  onClick: () => void;
  dark?: boolean;
}) {
  const t = revTokens(dark ? "dark" : "light");
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Back to latest message"
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      data-rev-jump-to-latest
      className="absolute bottom-4 left-1/2 inline-flex min-h-11 -translate-x-1/2 items-center gap-1.5 rounded-full px-4 transition-opacity duration-150"
      style={{
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
        background: t.overlay,
        border: `1px solid ${t.border}`,
        boxShadow: t.shadow,
        color: t.strong,
        fontSize: "0.74rem",
        fontWeight: 650,
        cursor: "pointer",
        zIndex: 20,
      }}
    >
      <ArrowDown size={13} aria-hidden="true" />
      Back to latest
    </button>
  );
}

export default JumpToLatest;
