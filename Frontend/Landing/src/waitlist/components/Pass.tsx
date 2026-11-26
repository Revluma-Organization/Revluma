import { useEffect, useRef, useState } from "react";
import { BadgeCheck, Check } from "lucide-react";
import orbStill from "@/assets/rev-orb.png";
import revlumaIcon from "@/assets/revluma-icon.png";
import { useTilt } from "../motion";

type Props = {
  store: string | null;
  orders: string | null;
  status: string;
  /** Required questions answered so far, and how many there are. */
  answered: number;
  total: number;
  done: boolean;
  queue: number | null;
};

/**
 * The Founding Merchant pass, filled in live as the applicant answers. It
 * tilts toward the pointer (spring physics in useTilt), flashes when a new
 * answer lands, and flips over to the confirmation side once the application
 * is in. Purely decorative: everything on it is also in the form, so it is
 * hidden from assistive tech.
 */
export function Pass({ store, orders, status, answered, total, done, queue }: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const tilt = useRef<HTMLDivElement>(null);
  useTilt(stage, tilt);

  // A brief light sweep each time another required answer is filled in.
  const [flash, setFlash] = useState(0);
  const last = useRef(answered);
  useEffect(() => {
    if (answered > last.current) setFlash((n) => n + 1);
    last.current = answered;
  }, [answered]);

  const pct = Math.round((answered / total) * 100);

  return (
    <div ref={stage} className={`wl-pass-stage${done ? " is-done" : ""}`} aria-hidden="true">
      <div ref={tilt} className="wl-pass-tilt">
        <div className={`wl-pass-flip${done ? " is-flipped" : ""}`}>
          <div className="wl-pass wl-pass--front">
            <span className="wl-pass__bg">
              <span className="wl-pass__grid" />
              <span className="wl-pass__glare" />
              {flash ? <span key={flash} className="wl-pass__flash" /> : null}
            </span>
            <div className="wl-pass__top">
              <span className="wl-pass__brand">
                <img src={revlumaIcon} alt="" width={22} height={22} />
                Revluma
              </span>
              <img className="wl-pass__orb" src={orbStill} alt="" width={40} height={40} />
            </div>
            <div className="wl-pass__lift">
              <p className="wl-pass__label">
                <BadgeCheck size={18} strokeWidth={2.2} />
                Founding Merchant
              </p>
              <p className="wl-pass__program">Early access application</p>
            </div>
            <div className="wl-pass__fields">
              <div className="wl-pass__store">
                <span className="wl-pass__k">Store</span>
                <span className={`wl-pass__v${store ? "" : " is-empty"}`}>{store ?? "your-store.myshopify.com"}</span>
              </div>
              <div>
                <span className="wl-pass__k">Orders / mo</span>
                <span className={`wl-pass__v${orders ? "" : " is-empty"}`}>{orders ?? "Not set"}</span>
              </div>
              <div>
                <span className="wl-pass__k">Status</span>
                <span className="wl-pass__v">
                  <i />
                  {status}
                </span>
              </div>
            </div>
            <div className="wl-pass__meter">
              <span className="wl-pass__meter-track">
                <span className="wl-pass__meter-fill" style={{ transform: `scaleX(${answered / total})` }} />
              </span>
              <span key={answered} className="wl-pass__meter-num">
                {pct}%
              </span>
            </div>
          </div>

          <div className="wl-pass wl-pass--back">
            <span className="wl-pass__bg">
              <span className="wl-pass__grid" />
              <span className="wl-pass__glare" />
            </span>
            <div className="wl-pass__top">
              <span className="wl-pass__brand">
                <img src={revlumaIcon} alt="" width={22} height={22} />
                Revluma
              </span>
              <span className="wl-pass__chip">
                <Check size={12} strokeWidth={3} />
                {status}
              </span>
            </div>
            <div className="wl-pass__back-body">
              {queue ? (
                <>
                  <span className="wl-pass__k">Review queue</span>
                  <span className="wl-pass__queue">#{queue}</span>
                </>
              ) : (
                <span className="wl-pass__seal">
                  <BadgeCheck size={40} strokeWidth={1.8} />
                </span>
              )}
              <p className="wl-pass__label">Application received</p>
              <p className="wl-pass__program">{store ?? "Founding Merchants Program"}</p>
            </div>
          </div>
        </div>
      </div>
      <span className="wl-pass-shadow" />
    </div>
  );
}
