import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import icon from "@/assets/revluma-icon.png";
import { CTA } from "@/content";
import { useLandingConfig } from "@/config";

/**
 * Floating pill navigation (approved design): a dark capsule holding the
 * logo in a white circle, white text links, and a white pill CTA on the right.
 * The logo circle and CTA fill the capsule's height minus a 5px inset, so the
 * proportions hold whether the capsule is 56px (default) or slightly shorter
 * on low laptop screens.
 *
 * The capsule is pinned to the top of the viewport (position: fixed) so it
 * floats over every landing section while the page scrolls. The <header>
 * itself stays in the document flow at the bar's height, so the hero below
 * keeps its exact one-screen layout. The fixed layer ignores pointer events
 * except on the capsule and menu, so the transparent gutters beside the pill
 * never block clicks on the page underneath.
 */
const PILL = "bg-[#1C1C1C] shadow-[0_18px_36px_-14px_rgba(0,0,0,0.45),0_4px_10px_-4px_rgba(0,0,0,0.18)] ring-1 ring-white/[0.06]";
const ON_DARK_FOCUS = "focus-visible:outline-white";

export function Navbar() {
  const [open, setOpen] = useState(false);
  const { navLinks, signInHref, joinHref, onJoin } = useLandingConfig();
  const textLinks = [...navLinks, { label: "Sign In", href: signInHref }];

  // Close the mobile menu on Escape and when the viewport grows to desktop.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    const media = window.matchMedia("(min-width: 1024px)");
    const onResize = () => media.matches && setOpen(false);
    window.addEventListener("keydown", onKey);
    media.addEventListener("change", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      media.removeEventListener("change", onResize);
    };
  }, [open]);

  return (
    <header className="relative h-20 lg:h-[clamp(4rem,9svh,5rem)]">
      <div className="pointer-events-none fixed inset-x-0 top-0 z-40 px-4 sm:px-8">
        <div className="mx-auto flex h-20 max-w-page items-center justify-center lg:h-[clamp(4rem,9svh,5rem)]">
          <nav
            aria-label="Primary"
            className={`pointer-events-auto flex h-14 w-full items-center justify-between gap-2 rounded-full p-[5px] lg:h-[clamp(3.1rem,6.4svh,3.5rem)] lg:w-auto lg:justify-start ${PILL}`}
          >
            <a
              href="/"
              aria-label="Revluma home"
              className={`grid aspect-square h-full shrink-0 place-items-center rounded-full bg-white transition-transform hover:scale-[1.04] ${ON_DARK_FOCUS}`}
            >
              <img src={icon} alt="" width={24} height={24} className="h-[52%] w-[52%] object-contain" />
            </a>

            <ul className="hidden items-center gap-[1.6rem] px-[1.9rem] lg:flex">
              {textLinks.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className={`whitespace-nowrap rounded-md text-[0.95rem] text-white/90 transition-colors hover:text-white ${ON_DARK_FOCUS}`}
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>

            <div className="flex h-full items-center gap-1">
              <a
                href={joinHref}
                onClick={onJoin}
                className={`inline-flex h-full items-center whitespace-nowrap rounded-full bg-white px-4 text-[0.9rem] font-medium text-[#1C1C1C] transition-colors hover:bg-white/90 sm:px-5 sm:text-[0.95rem] ${ON_DARK_FOCUS}`}
              >
                {CTA.primaryShort.label}
              </a>
              <button
                type="button"
                className={`grid aspect-square h-full place-items-center rounded-full text-white transition-colors hover:bg-white/10 lg:hidden ${ON_DARK_FOCUS}`}
                aria-label={open ? "Close menu" : "Open menu"}
                aria-expanded={open}
                aria-controls="mobile-menu"
                onClick={() => setOpen((value) => !value)}
              >
                {open ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
              </button>
            </div>
          </nav>
        </div>

        {open && (
          <div id="mobile-menu" className={`pointer-events-auto absolute inset-x-4 top-[calc(100%_-_0.25rem)] max-h-[calc(100svh_-_6rem)] overflow-y-auto rounded-[1.75rem] p-2 sm:inset-x-8 lg:hidden ${PILL}`}>
            <ul className="flex flex-col">
              {textLinks.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className={`flex min-h-12 items-center rounded-2xl px-4 text-base text-white/90 transition-colors hover:bg-white/[0.06] hover:text-white ${ON_DARK_FOCUS}`}
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
            <a
              href={joinHref}
              onClick={(event) => {
                setOpen(false);
                onJoin?.(event);
              }}
              className={`mt-2 flex h-12 items-center justify-center rounded-full bg-white text-[0.95rem] font-medium text-[#1C1C1C] ${ON_DARK_FOCUS}`}
            >
              {CTA.primaryShort.label}
            </a>
          </div>
        )}
      </div>
    </header>
  );
}
