import { useEffect, useState } from "react";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { CTA } from "@/content";
import { useLandingConfig } from "@/config";
import { Logo } from "./Logo";

export function Navbar() {
  const [open, setOpen] = useState(false);
  const { navLinks, signInHref, joinHref, onJoin } = useLandingConfig();

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
    <header className="relative z-40">
      <nav aria-label="Primary" className="mx-auto flex h-20 lg:h-[clamp(4rem,9svh,5rem)] max-w-page items-center justify-between px-5 sm:px-8">
        <a href="/" aria-label="Revluma home" className="shrink-0">
          <Logo />
        </a>

        <ul className="hidden items-center gap-9 lg:flex">
          {navLinks.map((link) => (
            <li key={link.href}>
              <a href={link.href} className="text-[0.9rem] font-medium text-ink-soft transition-colors hover:text-ink">
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="hidden items-center gap-6 lg:flex">
          <a href={signInHref} className="text-[0.9rem] font-medium text-ink-soft transition-colors hover:text-ink">
            Sign In
          </a>
          <a
            href={joinHref}
            onClick={onJoin}
            className="group inline-flex h-11 items-center gap-3 rounded-full bg-ink pl-5 pr-1.5 text-[0.88rem] font-semibold text-white transition-colors hover:bg-indigo-deep"
          >
            {CTA.primaryShort.label}
            <span className="grid h-8 w-8 place-items-center rounded-full bg-white/15 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5">
              <ArrowUpRight size={16} aria-hidden="true" />
            </span>
          </a>
        </div>

        <button
          type="button"
          className="grid h-11 w-11 place-items-center rounded-full border border-line bg-white text-ink lg:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
        </button>
      </nav>

      {open && (
        <div id="mobile-menu" className="absolute inset-x-0 top-20 border-y border-line bg-canvas px-5 pb-6 pt-2 shadow-float sm:px-8 lg:hidden">
          <ul className="flex flex-col">
            {navLinks.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="flex min-h-12 items-center border-b border-line text-base font-medium text-ink"
                >
                  {link.label}
                </a>
              </li>
            ))}
            <li>
              <a href={signInHref} className="flex min-h-12 items-center text-base font-medium text-ink-soft">
                Sign In
              </a>
            </li>
          </ul>
          <a
            href={joinHref}
            onClick={(event) => {
              setOpen(false);
              onJoin?.(event);
            }}
            className="mt-3 flex h-12 items-center justify-center gap-2 rounded-full bg-ink text-[0.95rem] font-semibold text-white"
          >
            {CTA.primaryShort.label}
            <ArrowUpRight size={17} aria-hidden="true" />
          </a>
        </div>
      )}
    </header>
  );
}
