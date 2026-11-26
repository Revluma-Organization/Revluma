import { useRef, type CSSProperties, type MouseEvent } from "react";
import { FOOTER } from "@/content";
import { useLandingConfig } from "@/config";
import { useReveal } from "@/useReveal";
import icon from "@/assets/revluma-icon.png";
import { FooterScene } from "./FooterScene";

/**
 * Site footer, after the reference layout: brand, tagline and socials on the
 * left, four link columns on the right with the copyright under them, then a
 * wide illustrated scene (a small e-commerce world with the bold "Revluma"
 * wordmark) watched over by Rev's eye.
 */

const vars = (v: Record<string, string | number>) => v as CSSProperties;

type FooterLink = (typeof FOOTER.columns)[number]["links"][number];

const SOCIAL_ICONS: Record<(typeof FOOTER.social)[number]["icon"], JSX.Element> = {
  x: <path d="M18.9 2H22l-6.8 7.8L23 22h-6.2l-4.8-6.3L6.4 22H3.3l7.3-8.3L1 2h6.3l4.4 5.8L18.9 2Zm-1.1 18h1.7L6.3 3.9H4.5L17.8 20Z" />,
  tiktok: <path d="M16.6 2h-3.4v13.4a3 3 0 1 1-3-3c.3 0 .6 0 .9.1V9a6.4 6.4 0 1 0 5.5 6.4V8.6a8 8 0 0 0 4.6 1.5V6.7A4.6 4.6 0 0 1 16.6 2Z" />,
  youtube: (
    <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1c.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8ZM9.6 15.6V8.4l6.2 3.6-6.2 3.6Z" />
  ),
  instagram: (
    <>
      <rect x="2.75" y="2.75" width="18.5" height="18.5" rx="5.25" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="4.25" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="17.5" cy="6.5" r="1.3" />
    </>
  ),
};

function SocialIcon({ name }: { name: keyof typeof SOCIAL_ICONS }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      {SOCIAL_ICONS[name]}
    </svg>
  );
}

export function FooterSection({ id }: { id?: string }) {
  const { signUpHref, signInHref, joinHref, onJoin } = useLandingConfig();
  const top = useRef<HTMLDivElement>(null);
  useReveal(top);

  const resolve = (link: FooterLink): { href: string; onClick?: (e: MouseEvent<HTMLAnchorElement>) => void } => {
    if ("href" in link) return { href: link.href };
    if (link.to === "signUp") return { href: signUpHref };
    if (link.to === "signIn") return { href: signInHref };
    return { href: joinHref, onClick: onJoin };
  };

  return (
    <footer id={id} className="ft">
      <div ref={top} className="ft-top mx-auto max-w-page px-5 pt-14 sm:px-8 sm:pt-16 lg:pt-20">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.75fr)] lg:gap-12">
          <div>
            <a href="/" className="ft-brand fx-up" style={vars({ "--i": 0 })} aria-label="Revluma home">
              <img src={icon} alt="" width={28} height={28} />
              <span>Revluma</span>
            </a>
            <p className="ft-tag fx-up" style={vars({ "--i": 1 })}>
              {FOOTER.tagline}
            </p>
            <ul className="ft-social fx-up" style={vars({ "--i": 2 })} aria-label="Revluma on social media">
              {FOOTER.social.map((s) => (
                <li key={s.href}>
                  <a href={s.href} target="_blank" rel="noopener noreferrer" aria-label={s.label}>
                    <SocialIcon name={s.icon} />
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <nav aria-label="Footer" className="ft-cols">
              {FOOTER.columns.map((col, i) => (
                <div key={col.title} className="fx-up" style={vars({ "--i": i + 1 })}>
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
            <p className="ft-copy fx-up" style={vars({ "--i": 5 })}>
              © {new Date().getFullYear()} Revluma.
            </p>
          </div>
        </div>
      </div>

      <FooterScene />
    </footer>
  );
}
