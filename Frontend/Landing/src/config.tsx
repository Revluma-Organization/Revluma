import { createContext, useContext } from "react";
import type { MouseEvent } from "react";
import { CTA, NAV_LINKS, SIGN_IN_URL } from "./content";

export type NavLink = { readonly label: string; readonly href: string };

/**
 * Where the hero's links point. The standalone landing app uses the defaults;
 * the embed on the current homepage (src/embed.tsx) only links to sections
 * that exist there and opens the existing waitlist modal for "Join".
 */
export type LandingConfig = {
  navLinks: readonly NavLink[];
  signInHref: string;
  joinHref: string;
  exploreHref: string;
  /** Optional handler for every "Join Founding Merchants" CTA. */
  onJoin?: (event: MouseEvent<HTMLAnchorElement>) => void;
};

export const DEFAULT_CONFIG: LandingConfig = {
  navLinks: NAV_LINKS,
  signInHref: SIGN_IN_URL,
  joinHref: CTA.primary.href,
  exploreHref: CTA.secondary.href,
};

const LandingConfigContext = createContext<LandingConfig>(DEFAULT_CONFIG);

export const LandingConfigProvider = LandingConfigContext.Provider;

export function useLandingConfig() {
  return useContext(LandingConfigContext);
}
