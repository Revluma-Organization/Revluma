import { useRef, type CSSProperties } from "react";
import { Check, ShieldCheck, Scale } from "lucide-react";
import { useScrollProgress, useStartWhenVisible } from "@/useHeroMotion";
import { LeakFunnel } from "./LeakFunnel";
import { RevScreen } from "./RevScreen";

/** Parallax depth for a scene layer: how far it follows the pointer (in cqw). */
const depth = (value: number) => ({ "--depth": value }) as CSSProperties;

/**
 * Hero composition from the approved reference: an accent circle, a laptop
 * on a concrete plinth, two floating cards, a hand-drawn arrow and a leaking glass funnel (the
 * headline's "losing revenue", in place of the reference's plant).
 * Every measurement is in container-query units, so the whole scene scales
 * as one piece from phones to wide desktops.
 *
 * Each part sits in its own .hv-layer so the pointer parallax can move it by
 * its depth; the entrance choreography lives in motion.css and starts once
 * the scene is on screen.
 */
export function HeroVisual() {
  const ref = useRef<HTMLDivElement>(null);
  useStartWhenVisible(ref);
  useScrollProgress(ref);
  return (
    <div
      ref={ref}
      className="hero-visual"
      role="img"
      aria-label="Illustration: a cracked glass funnel leaking revenue beside Rev Intelligence on a laptop, showing a sample investigation that separates verified facts, hypotheses and unknowns."
    >
      <div className="hero-visual__scene" aria-hidden="true">
        <div className="hv-layer hv-layer--circle" style={depth(-0.8)}>
          <div className="hv-circle" />
        </div>
        <div className="hv-layer hv-layer--funnel" style={depth(1.4)}>
          <LeakFunnel />
        </div>

        <div className="hv-layer hv-layer--plinth" style={depth(0.3)}>
          <div className="hv-plinth">
            <div className="hv-plinth__back" />
            <div className="hv-plinth__front" />
          </div>
        </div>

        <div className="hv-layer hv-layer--laptop" style={depth(0.8)}>
          <div className="hv-laptop">
            <div className="hv-laptop__lid">
              <span className="hv-laptop__camera" />
              <div className="hv-laptop__screen">
                <RevScreen />
              </div>
            </div>
            <div className="hv-laptop__base" />
          </div>
        </div>

        <div className="hv-layer hv-layer--evidence" style={depth(2.2)}>
          <div className="hv-card hv-card--evidence">
            <span className="hv-card__icon">
              <ShieldCheck />
            </span>
            <span className="hv-card__text">
              <strong>Evidence-backed</strong>
              <span>findings</span>
            </span>
            <span className="hv-card__check">
              <Check />
            </span>
          </div>
        </div>

        <div className="hv-layer hv-layer--facts" style={depth(1.8)}>
          <div className="hv-card hv-card--facts">
            <span className="hv-card__head">
              <span className="hv-card__icon hv-card__icon--small">
                <Scale />
              </span>
              <strong>Facts, not guesses</strong>
            </span>
            <span className="hv-card__legend">
              <i className="is-fact">Verified</i>
              <i className="is-hypothesis">Hypothesis</i>
              <i className="is-unknown">Unknown</i>
            </span>
          </div>
        </div>

        <div className="hv-layer hv-layer--arrow" style={depth(1.6)}>
          <svg className="hv-arrow" viewBox="0 0 120 170" fill="none">
            <path
              className="hv-arrow__line"
              pathLength={1}
              d="M70 6 C 40 10, 18 34, 30 58 C 40 78, 72 70, 66 50 C 60 30, 22 44, 22 78 C 22 108, 44 128, 66 150"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
            <path
              className="hv-arrow__head"
              pathLength={1}
              d="M52 147 L 67 152 L 66 136"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}
