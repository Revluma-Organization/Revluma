import icon from "@/assets/revluma-icon.png";
import { ArrowUp, ArrowUpRight, Check, CircleHelp, Lightbulb } from "lucide-react";

/**
 * A miniature of Rev Intelligence for the hero laptop.
 *
 * It is a labelled sample, not live merchant data: it shows how Rev separates
 * what it verified from hypotheses and unknowns, and contains no revenue
 * figures, alerts or metrics (blueprint: no fabricated merchant data).
 */
export function RevScreen() {
  return (
    <div className="rev-screen" aria-hidden="true">
      <div className="rev-screen__bar">
        <span className="rev-screen__brand">
          <img src={icon} alt="" />
          Rev Intelligence
        </span>
        <span className="rev-screen__tag">Sample investigation</span>
      </div>

      <div className="rev-screen__body">
        <p className="rev-screen__question">Why did refunds increase last month?</p>

        <div className="rev-screen__answer">
          <span className="rev-screen__thinking"><i /><i /><i /><em>Investigating</em></span>
          <div className="rev-screen__sources">
            <span>Investigated</span>
            <i>Orders</i>
            <i>Refunds</i>
            <i>Products</i>
          </div>

          <div className="rev-screen__row rev-screen__row--fact">
            <b><Check /> Verified</b>
            <p>Refunds are concentrated in one product collection.</p>
          </div>
          <div className="rev-screen__row rev-screen__row--hypothesis">
            <b><Lightbulb /> Hypothesis</b>
            <p>Sizing information on those products may be unclear.</p>
          </div>
          <div className="rev-screen__row rev-screen__row--unknown">
            <b><CircleHelp /> Unknown</b>
            <p>Return reasons are not recorded for every order.</p>
          </div>

          <div className="rev-screen__next">
            <span>Recommended first step</span>
            <p>
              Review product details in that collection
              <ArrowUpRight />
            </p>
          </div>
        </div>

        <div className="rev-screen__composer">
          <span>Ask Rev about your store…</span>
          <i><ArrowUp /></i>
        </div>
      </div>
    </div>
  );
}
