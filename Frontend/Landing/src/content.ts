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
  primary: { label: "Join Waitlist", href: "#founding-merchants" },
  primaryShort: { label: "Join Waitlist", href: "#founding-merchants" },
  secondary: { label: "Sign Up", href: SIGN_UP_URL },
} as const;

export const HERO = {
  headline: { lead: ["Know where", "your store is"], accent: "losing revenue." },
  subline: "Understand why. Know what deserves attention.",
  body:
    "Revluma investigates your Shopify store data to uncover potential revenue leaks, explain the evidence behind them, and help you decide what to address first.",
  // The data hub under the CTAs: what Revluma reads from Shopify. Only data the
  // store sync actually reads (Backend/src/services/shopifySync.js), and no
  // other integrations: Revluma is Shopify only.
  sources: {
    label: "Revluma reads your Shopify orders, products, customers, refunds and abandoned checkouts. Read-only: your store stays unchanged.",
    items: ["Shopify", "Orders", "Products", "Customers", "Refunds", "Abandoned checkouts"],
  },
} as const;
