// Landing page copy and links, kept in one place so every claim can be
// reviewed against the product. Rules (approved blueprint v1):
//  - Shopify only; describe the MVP as it exists today.
//  - No invented metrics, testimonials, logos, or setup-time claims.
//  - Revluma reads merchant-authorised data; it does not change the store.

export const SIGN_IN_URL = "/login";
export const SIGN_UP_URL = "/auth/signup";

export const NAV_LINKS = [
  { label: "Platform", href: "#platform" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Why Revluma", href: "#why-revluma" },
  { label: "FAQ", href: "#faq" },
] as const;

export const CTA = {
  primary: { label: "Join the Founding Merchants Program", href: "#founding-merchants" },
  primaryShort: { label: "Join Founding Merchants", href: "#founding-merchants" },
  secondary: { label: "Sign Up", href: SIGN_UP_URL },
} as const;

export const HERO = {
  headline: { lead: ["Know where", "your store is"], accent: "losing revenue." },
  subline: "Understand why. Know what deserves attention.",
  body:
    "Revluma investigates your Shopify store data to uncover potential revenue leaks, explain the evidence behind them, and help you decide what to address first.",
  // Replaces the reference design's numeric stats row: these are product
  // facts, not performance figures.
  facts: [
    { title: "Shopify", label: "Built for Shopify stores" },
    { title: "Read-only", label: "Your store stays unchanged" },
    { title: "Evidence", label: "Behind every finding" },
  ],
} as const;
