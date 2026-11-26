/**
 * Referral attribution. Existing share links (?ref=RV-XXXXXX, also ?referral=)
 * keep working on the homepage and on /waitlist. The code is remembered for
 * the browser session (first touch wins), sent with the first save, and from
 * then on lives on the application record itself, so it survives every step,
 * refresh and return visit through to the submitted application.
 */
const KEY = "rv_wl_ref";
export const REFERRAL_FORMAT = /^[A-Z0-9-]{4,20}$/;
const FORMAT = /^[A-Za-z0-9-]{4,20}$/;

export function referralFromSearch(search: string): string | null {
  const params = new URLSearchParams(search);
  const code = (params.get("ref") ?? params.get("referral") ?? "").trim().toUpperCase();
  return FORMAT.test(code) ? code : null;
}

/** The code to attribute this application to, remembering one from the URL. */
export function captureReferral(search: string = typeof window === "undefined" ? "" : window.location.search): string | null {
  const fromUrl = referralFromSearch(search);
  try {
    const stored = window.sessionStorage.getItem(KEY);
    if (stored && FORMAT.test(stored)) return stored;
    if (fromUrl) window.sessionStorage.setItem(KEY, fromUrl);
  } catch {
    // Storage disabled: fall back to the URL alone.
  }
  return fromUrl;
}

/** /waitlist, carrying a referral code from the current page's URL. */
export function waitlistHref(search: string = typeof window === "undefined" ? "" : window.location.search): string {
  const code = referralFromSearch(search);
  return code ? `/waitlist?ref=${encodeURIComponent(code)}` : "/waitlist";
}

/** Remember a code typed on the page (or forget it when cleared). */
export function rememberReferral(code: string | null) {
  try {
    if (code && REFERRAL_FORMAT.test(code)) window.sessionStorage.setItem(KEY, code);
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // Storage disabled: the code still goes with the first save.
  }
}
