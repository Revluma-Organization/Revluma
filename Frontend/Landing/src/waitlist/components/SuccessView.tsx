import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, Copy, Mail } from "lucide-react";
import type { Application } from "../api";
import { Burst } from "./Burst";

const STATUS: Record<string, { label: string; body: string }> = {
  submitted: {
    label: "Received",
    body: "You're being considered for Founding Merchant access. We review every application ourselves and will contact you by email.",
  },
  reviewed: { label: "In review", body: "Our team has looked at your application. We'll contact you by email about next steps." },
  accepted: { label: "Accepted", body: "Welcome to the Founding Merchants Program. Check your email for how to get started." },
  rejected: { label: "Reviewed", body: "Thanks for applying. We've reviewed your application and sent an update to your email." },
};

/** After submit (and on every later visit): what happens next. No promises, no invented numbers. */
export function SuccessView({ app, justSubmitted }: { app: Application; justSubmitted: boolean }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [copied, setCopied] = useState(false);
  const status = STATUS[app.status] ?? STATUS.submitted;
  const firstName = app.answers.full_name.split(" ")[0];
  const shareUrl = app.referral_code ? `${window.location.origin}/waitlist?ref=${encodeURIComponent(app.referral_code)}` : null;

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  const copy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className={`wl-done${justSubmitted ? " is-fresh" : ""}`}>
      {justSubmitted ? <Burst /> : null}
      <div className="wl-done__badge" aria-hidden="true">
        <svg viewBox="0 0 64 64" width="64" height="64">
          <circle className="wl-done__ring" cx="32" cy="32" r="29" />
          <path className="wl-done__tick" d="M20 33.5l8 8 16-17" />
        </svg>
      </div>
      <p className="wl-done__status">
        <span aria-hidden="true" />
        {status.label}
      </p>
      <h2 ref={heading} tabIndex={-1} className="wl-done__title">
        {app.status === "submitted" ? `Application received${firstName ? `, ${firstName}` : ""}` : "Your application"}
      </h2>
      <p className="wl-done__body">{status.body}</p>

      <div className="wl-done__facts">
        <div className="wl-done__fact">
          <Mail size={16} strokeWidth={2.2} aria-hidden="true" />
          <span>
            We'll write to <strong>{app.answers.work_email}</strong>
            {justSubmitted ? ". A confirmation is on its way." : "."}
          </span>
        </div>
        {app.queue_position ? (
          <div className="wl-done__fact">
            <span className="wl-done__num" aria-hidden="true">
              #{app.queue_position}
            </span>
            <span>
              Your place in the review queue<span className="wl-sr">: number {app.queue_position}</span>. Applications are reviewed in order, and a place is not
              a guarantee of access.
            </span>
          </div>
        ) : null}
      </div>

      {shareUrl ? (
        <div className="wl-share">
          <p className="wl-share__title">Know another Shopify merchant?</p>
          <p className="wl-hint">Share your link. Applications that come through it are credited to you.</p>
          <div className="wl-share__row">
            <input className="wl-input wl-share__url" value={shareUrl} readOnly aria-label="Your referral link" onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="wl-btn wl-btn--secondary" onClick={() => void copy()}>
              {copied ? <Check size={15} strokeWidth={2.6} aria-hidden="true" /> : <Copy size={15} strokeWidth={2.2} aria-hidden="true" />}
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          <p className="wl-sr" aria-live="polite">
            {copied ? "Link copied" : ""}
          </p>
        </div>
      ) : null}

      <a className="wl-btn wl-btn--ghost wl-done__home" href="/">
        Back to Revluma
        <ArrowUpRight size={15} strokeWidth={2.2} aria-hidden="true" />
      </a>
    </div>
  );
}
