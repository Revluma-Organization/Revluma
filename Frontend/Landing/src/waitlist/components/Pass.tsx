import { BadgeCheck } from "lucide-react";
import orbStill from "@/assets/rev-orb.png";
import revlumaIcon from "@/assets/revluma-icon.png";

/**
 * The Founding Merchant pass from the homepage's programme section, filled in
 * as the applicant goes: their store and where the application stands.
 */
export function Pass({ store, status, step }: { store: string | null; status: string; step: string }) {
  return (
    <div className="wl-pass" aria-hidden="true">
      <div className="wl-pass__top">
        <span className="wl-pass__brand">
          <img src={revlumaIcon} alt="" width={22} height={22} />
          Revluma
        </span>
        <img className="wl-pass__orb" src={orbStill} alt="" width={36} height={36} />
      </div>
      <p className="wl-pass__label">
        <BadgeCheck size={18} strokeWidth={2} />
        Founding Merchant
      </p>
      <p className="wl-pass__program">Early access application</p>
      <div className="wl-pass__fields">
        <div>
          <span className="wl-pass__k">Store</span>
          <span className={`wl-pass__v${store ? "" : " is-empty"}`}>{store ?? "your-store.myshopify.com"}</span>
        </div>
        <div>
          <span className="wl-pass__k">Step</span>
          <span className="wl-pass__v">{step}</span>
        </div>
        <div>
          <span className="wl-pass__k">Status</span>
          <span className="wl-pass__v">
            <i />
            {status}
          </span>
        </div>
      </div>
    </div>
  );
}
