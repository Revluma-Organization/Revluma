import { Check, ShieldCheck, Scale } from "lucide-react";
import plant from "@/assets/plant.webp";
import { RevScreen } from "./RevScreen";

/**
 * Hero composition from the approved reference: an accent circle, a laptop
 * on a concrete plinth, two floating cards, a hand-drawn arrow and a plant.
 * Every measurement is in container-query units, so the whole scene scales
 * as one piece from phones to wide desktops.
 */
export function HeroVisual() {
  return (
    <div
      className="hero-visual"
      role="img"
      aria-label="Illustration: Rev Intelligence on a laptop, showing a sample investigation that separates verified facts, hypotheses and unknowns."
    >
      <div className="hero-visual__scene" aria-hidden="true">
        <div className="hv-circle" />
        <img className="hv-plant" src={plant} alt="" width={467} height={996} loading="eager" decoding="async" />

        <div className="hv-plinth">
          <div className="hv-plinth__back" />
          <div className="hv-plinth__front" />
        </div>

        <div className="hv-laptop">
          <div className="hv-laptop__lid">
            <span className="hv-laptop__camera" />
            <div className="hv-laptop__screen">
              <RevScreen />
            </div>
          </div>
          <div className="hv-laptop__base" />
        </div>

        <div className="hv-card hv-card--evidence">
          <span className="hv-card__icon"><ShieldCheck /></span>
          <span className="hv-card__text">
            <strong>Evidence-backed</strong>
            <span>findings</span>
          </span>
          <span className="hv-card__check"><Check /></span>
        </div>

        <div className="hv-card hv-card--facts">
          <span className="hv-card__head">
            <span className="hv-card__icon hv-card__icon--small"><Scale /></span>
            <strong>Facts, not guesses</strong>
          </span>
          <span className="hv-card__legend">
            <i className="is-fact">Verified</i>
            <i className="is-hypothesis">Hypothesis</i>
            <i className="is-unknown">Unknown</i>
          </span>
        </div>

        <svg className="hv-arrow" viewBox="0 0 120 170" fill="none">
          <path
            d="M70 6 C 40 10, 18 34, 30 58 C 40 78, 72 70, 66 50 C 60 30, 22 44, 22 78 C 22 108, 44 128, 66 150"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          <path d="M52 147 L 67 152 L 66 136" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}
