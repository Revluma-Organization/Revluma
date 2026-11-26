import type { MouseEvent } from "react";
import { FOOTER } from "@/content";
import { useLandingConfig } from "@/config";
import icon from "@/assets/revluma-icon.png";
import { FooterScene } from "./FooterScene";

/**
 * Site footer, after the reference layout: brand, tagline and socials on the
 * left, four link columns on the right with the copyright under them, then a
 * wide illustrated scene (a small e-commerce world with the bold "Revluma"
 * wordmark) watched over by Rev's eye.
 */

type FooterLink = (typeof FOOTER.columns)[number]["links"][number];

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M18.9 2H22l-6.8 7.8L23 22h-6.2l-4.8-6.3L6.4 22H3.3l7.3-8.3L1 2h6.3l4.4 5.8L18.9 2Zm-1.1 18h1.7L6.3 3.9H4.5L17.8 20Z" />
    </svg>
  );
}

export function FooterSection({ id }: { id?: string }) {
  const { signUpHref, signInHref, joinHref, onJoin } = useLandingConfig();

  const resolve = (link: FooterLink): { href: string; onClick?: (e: MouseEvent<HTMLAnchorElement>) => void } => {
    if ("href" in link) return { href: link.href };
    if (link.to === "signUp") return { href: signUpHref };
    if (link.to === "signIn") return { href: signInHref };
    return { href: joinHref, onClick: onJoin };
  };

  return (
    <footer id={id} className="ft">
      <div className="ft-top mx-auto max-w-page px-5 pt-14 sm:px-8 sm:pt-16 lg:pt-20">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.75fr)] lg:gap-12">
          <div>
            <a href="/" className="ft-brand" aria-label="Revluma home">
              <img src={icon} alt="" width={28} height={28} />
              <span>Revluma</span>
            </a>
            <p className="ft-tag">{FOOTER.tagline}</p>
            <ul className="ft-social" aria-label="Revluma on social media">
              {FOOTER.social.map((s) => (
                <li key={s.href}>
                  <a href={s.href} target="_blank" rel="noopener noreferrer" aria-label={s.label}>
                    <XIcon />
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <nav aria-label="Footer" className="ft-cols">
              {FOOTER.columns.map((col) => (
                <div key={col.title}>
                  <h2 className="ft-h">{col.title}</h2>
                  <ul>
                    {col.links.map((link) => {
                      const { href, onClick } = resolve(link);
                      return (
                        <li key={link.label}>
                          <a href={href} onClick={onClick} className="ft-link">
                            {link.label}
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </nav>
            <p className="ft-copy">© {new Date().getFullYear()} Revluma.</p>
          </div>
        </div>
      </div>

      <FooterScene />
    </footer>
  );
}
